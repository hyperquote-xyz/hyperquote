"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount, useWalletClient, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import {
  QuoteKind,
  RFQRequest,
  RFQQuote,
  RFQRequestJSON,
  RFQQuoteJSON,
  RFQVisibility,
  Token,
  TransactionState,
  requestToJSON,
  requestFromJSON,
  quoteToJSON,
  quoteFromJSON,
} from "@/types";
import {
  RFQ_CONTRACT_ADDRESS,
  RFQ_ABI,
  ERC20_ABI,
  RFQ_EIP712_DOMAIN,
  RFQ_QUOTE_TYPES,
} from "@/config/contracts";
import {
  generateRequestId,
  calculateExpiry,
  getErrorMessage,
} from "@/lib/utils";

// ── RFQ Lifecycle Types ──

export type RFQStatus = "active" | "cancelled" | "expired" | "filled";

export interface TrackedRFQ {
  request: RFQRequest;
  status: RFQStatus;
  quoteCount: number;
  createdAt: number;
  cancelledAt?: number;
  filledAt?: number;
}

// ── localStorage persistence for tracked RFQs ──

const TRACKED_RFQS_KEY = "hyperquote:tracked-rfqs";
const TRACKED_RFQS_MAX_AGE_SECS = 24 * 60 * 60; // Keep for 24h max

/** Serializable form of TrackedRFQ (bigints → strings) */
interface TrackedRFQSerialized {
  request: RFQRequestJSON;
  status: RFQStatus;
  quoteCount: number;
  createdAt: number;
  cancelledAt?: number;
  filledAt?: number;
}

function serializeTracked(t: TrackedRFQ): TrackedRFQSerialized {
  return {
    request: requestToJSON(t.request),
    status: t.status,
    quoteCount: t.quoteCount,
    createdAt: t.createdAt,
    cancelledAt: t.cancelledAt,
    filledAt: t.filledAt,
  };
}

function deserializeTracked(s: TrackedRFQSerialized): TrackedRFQ {
  return {
    request: requestFromJSON(s.request),
    status: s.status,
    quoteCount: s.quoteCount,
    createdAt: s.createdAt,
    cancelledAt: s.cancelledAt,
    filledAt: s.filledAt,
  };
}

function loadTrackedRFQs(): TrackedRFQ[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRACKED_RFQS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackedRFQSerialized[];
    const now = Math.floor(Date.now() / 1000);
    return parsed
      .filter((s) => now - s.createdAt < TRACKED_RFQS_MAX_AGE_SECS)
      .map(deserializeTracked)
      .map((t) => {
        // Mark as expired if past expiry and still active
        if (t.status === "active" && t.request.expiry <= now) {
          return { ...t, status: "expired" as const };
        }
        return t;
      });
  } catch {
    return [];
  }
}

function saveTrackedRFQs(tracked: TrackedRFQ[]): void {
  if (typeof window === "undefined") return;
  try {
    const now = Math.floor(Date.now() / 1000);
    // Only persist entries from the last 24h
    const recent = tracked.filter(
      (t) => now - t.createdAt < TRACKED_RFQS_MAX_AGE_SECS
    );
    localStorage.setItem(
      TRACKED_RFQS_KEY,
      JSON.stringify(recent.map(serializeTracked))
    );
  } catch {
    // localStorage may be full or unavailable — non-critical
  }
}

/**
 * Hook for taker RFQ operations
 */
export function useTakerRFQ() {
  const { address } = useAccount();
  const [currentRequest, setCurrentRequest] = useState<RFQRequest | null>(null);
  const [receivedQuotes, setReceivedQuotes] = useState<RFQQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<RFQQuote | null>(null);
  const [txState, setTxState] = useState<TransactionState>({ status: "idle" });

  // ── Lifecycle tracking — hydrate from localStorage ──
  const [trackedRequests, setTrackedRequests] = useState<TrackedRFQ[]>(() =>
    loadTrackedRFQs()
  );

  // Contract reads
  const { data: feePips } = useReadContract({
    address: RFQ_CONTRACT_ADDRESS,
    abi: RFQ_ABI,
    functionName: "feePips",
  });

  // Contract writes
  const { writeContractAsync } = useWriteContract();

  // ── Persist to localStorage on every change ──
  useEffect(() => {
    saveTrackedRFQs(trackedRequests);
  }, [trackedRequests]);

  // ── Expiry ticker — marks active requests as expired once past their expiry ──
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setTrackedRequests((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          if (t.status === "active" && t.request.expiry <= now) {
            changed = true;
            return { ...t, status: "expired" as const };
          }
          return t;
        });
        return changed ? next : prev;
      });
    }, 1_000);
    return () => clearInterval(interval);
  }, []);

  // ── Update quote counts on tracked requests when receivedQuotes changes ──
  useEffect(() => {
    if (!currentRequest) return;
    const count = receivedQuotes.length;
    setTrackedRequests((prev) =>
      prev.map((t) =>
        t.request.id === currentRequest.id && t.quoteCount !== count
          ? { ...t, quoteCount: count }
          : t
      )
    );
  }, [receivedQuotes, currentRequest]);

  /**
   * Create a new RFQ request.
   *
   * If `baseline` is provided (from the useAMMBaseline hook), it will be
   * persisted to /api/v1/rfq/baseline for performance tracking. This is
   * fire-and-forget — baseline persistence failure does not block RFQ creation.
   */
  const createRequest = useCallback(
    (params: {
      id?: string; // Optional: use server-assigned ID if available
      kind: QuoteKind;
      tokenIn: Token;
      tokenOut: Token;
      amountIn?: bigint;
      amountOut?: bigint;
      minOut?: bigint;
      maxIn?: bigint;
      ttlSeconds: number;
      visibility?: RFQVisibility;
      allowedMakers?: `0x${string}`[];
      baseline?: {
        amountOut: string;
        effectivePrice: number;
        priceImpactBps: number;
        blockNumber: string;
        timestamp: string;
        routes: { protocol: string; poolType: string; fractionPct: string }[];
      } | null;
    }): RFQRequest | null => {
      if (!address) return null;

      const request: RFQRequest = {
        id: params.id ?? generateRequestId(),
        kind: params.kind,
        taker: address,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: params.amountOut,
        minOut: params.minOut,
        maxIn: params.maxIn,
        expiry: calculateExpiry(params.ttlSeconds),
        createdAt: Math.floor(Date.now() / 1000),
        visibility: params.visibility ?? "public",
        allowedMakers: params.allowedMakers,
      };

      setCurrentRequest(request);
      setReceivedQuotes([]);
      setSelectedQuote(null);

      // Track this request
      setTrackedRequests((prev) => [
        {
          request,
          status: "active",
          quoteCount: 0,
          createdAt: request.createdAt,
        },
        ...prev,
      ]);

      // Persist baseline (fire-and-forget)
      if (params.baseline && params.amountIn) {
        fetch("/api/v1/rfq/baseline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rfqId: request.id,
            tokenIn: params.tokenIn.address,
            tokenOut: params.tokenOut.address,
            amountIn: params.amountIn.toString(),
            baselineAmountOut: params.baseline.amountOut,
            baselineEffectivePrice: params.baseline.effectivePrice,
            baselinePriceImpactBps: params.baseline.priceImpactBps,
            baselineBlockNumber: params.baseline.blockNumber,
            baselineTimestamp: params.baseline.timestamp,
            baselineRouteSummary: params.baseline.routes,
          }),
        }).catch((err) =>
          console.warn("[HyperQuote] Failed to persist baseline:", err)
        );
      }

      return request;
    },
    [address]
  );

  /**
   * Export request as JSON for sharing
   */
  const exportRequestJSON = useCallback((): string | null => {
    if (!currentRequest) return null;
    return JSON.stringify(requestToJSON(currentRequest), null, 2);
  }, [currentRequest]);

  /**
   * Cancel an RFQ by request ID.
   * - Marks the tracked request as cancelled
   * - If it's the currentRequest, clears current state
   * - Prevents future quotes from being accepted for this RFQ
   */
  const cancelRFQ = useCallback(
    async (requestId: string) => {
      const now = Math.floor(Date.now() / 1000);
      setTrackedRequests((prev) =>
        prev.map((t) =>
          t.request.id === requestId && t.status === "active"
            ? { ...t, status: "cancelled" as const, cancelledAt: now }
            : t
        )
      );

      // If this is the current request, clear it and all associated state
      if (currentRequest?.id === requestId) {
        setCurrentRequest(null);
        setReceivedQuotes([]);
        setSelectedQuote(null);
        setTxState({ status: "idle" });
      }

      // Notify server of cancellation — requires a taker wallet signature.
      // The server recovers the signer and requires it to equal the RFQ taker.
      try {
        const { wagmiConfig } = await import("@/lib/wagmi");
        const { signMessage } = await import("wagmi/actions");
        const signature = await signMessage(wagmiConfig, {
          message: `HyperQuote: cancel RFQ ${requestId}`,
        });
        await fetch(`/api/v1/rfqs/${requestId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature }),
        });
      } catch (err) {
        console.warn("[HyperQuote] Failed to notify feed of cancel:", err);
      }
    },
    [currentRequest]
  );

  /**
   * Import a quote from JSON
   */
  const importQuoteJSON = useCallback(
    (jsonString: string): RFQQuote | null => {
      try {
        const json = JSON.parse(jsonString) as RFQQuoteJSON;
        const quote = quoteFromJSON(json);

        // Reject quotes addressed to a different taker
        if (address && quote.taker.toLowerCase() !== address.toLowerCase()) {
          console.warn(`[HyperQuote] Ignoring quote addressed to ${quote.taker} (connected wallet: ${address})`);
          return null;
        }

        // Reject quotes for cancelled/expired tracked requests
        const tracked = trackedRequests.find(
          (t) => t.request.id === quote.requestId
        );
        if (tracked && tracked.status !== "active") {
          console.warn(`[HyperQuote] Ignoring quote for ${tracked.status} RFQ ${quote.requestId}`);
          return null;
        }

        // Add to received quotes if not duplicate
        setReceivedQuotes((prev) => {
          const exists = prev.some(
            (q) => q.signature === quote.signature
          );
          if (exists) return prev;
          return [...prev, quote];
        });

        return quote;
      } catch {
        console.error("Failed to parse quote JSON");
        return null;
      }
    },
    [address, trackedRequests]
  );

  /**
   * Check token allowance
   */
  const checkAllowance = useCallback(
    async (tokenAddress: `0x${string}`, amount: bigint): Promise<boolean> => {
      if (!address) return false;

      try {
        const { readContract } = await import("wagmi/actions");
        const { wagmiConfig } = await import("@/lib/wagmi");
        
        const allowance = await readContract(wagmiConfig, {
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, RFQ_CONTRACT_ADDRESS],
        });

        return allowance >= amount;
      } catch {
        return false;
      }
    },
    [address]
  );

  /**
   * Approve token
   */
  const approveToken = useCallback(
    async (tokenAddress: `0x${string}`, amount: bigint): Promise<boolean> => {
      if (!address) return false;

      try {
        setTxState({ status: "approving" });

        const hash = await writeContractAsync({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [RFQ_CONTRACT_ADDRESS, amount],
        });

        setTxState({ status: "approving", approvalTxHash: hash });

        // Wait for confirmation
        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { wagmiConfig } = await import("@/lib/wagmi");
        
        await waitForTransactionReceipt(wagmiConfig, { hash });

        setTxState({ status: "approved", approvalTxHash: hash });
        return true;
      } catch (error) {
        setTxState({ status: "error", error: getErrorMessage(error) });
        return false;
      }
    },
    [address, writeContractAsync]
  );

  /**
   * Fill a quote
   */
  const fillQuote = useCallback(
    async (quote: RFQQuote, constraint: bigint, opts?: { amountInUsd?: number; visibility?: string }): Promise<boolean> => {
      if (!address) return false;

      try {
        setTxState({ status: "filling" });

        const quoteStruct = {
          kind: quote.kind,
          maker: quote.maker,
          taker: quote.taker,
          tokenIn: quote.tokenIn,
          tokenOut: quote.tokenOut,
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          expiry: BigInt(quote.expiry),
          nonce: quote.nonce,
        };

        let hash: `0x${string}`;

        if (quote.kind === QuoteKind.EXACT_IN) {
          hash = await writeContractAsync({
            address: RFQ_CONTRACT_ADDRESS,
            abi: RFQ_ABI,
            functionName: "fillExactIn",
            args: [quoteStruct, quote.signature, constraint],
          });
        } else {
          hash = await writeContractAsync({
            address: RFQ_CONTRACT_ADDRESS,
            abi: RFQ_ABI,
            functionName: "fillExactOut",
            args: [quoteStruct, quote.signature, constraint],
          });
        }

        setTxState({ status: "filling", fillTxHash: hash });

        // Wait for confirmation
        const { waitForTransactionReceipt } = await import("wagmi/actions");
        const { wagmiConfig } = await import("@/lib/wagmi");
        
        await waitForTransactionReceipt(wagmiConfig, { hash });

        setTxState({ status: "success", fillTxHash: hash });

        // Mark tracked request as filled
        if (quote.requestId) {
          const now = Math.floor(Date.now() / 1000);
          setTrackedRequests((prev) =>
            prev.map((t) =>
              t.request.id === quote.requestId && t.status === "active"
                ? { ...t, status: "filled" as const, filledAt: now }
                : t
            )
          );

          // Persist performance record (fire-and-forget)
          fetch("/api/v1/rfq/performance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rfqId: quote.requestId,
              makerId: quote.maker,
              makerAmountOut: quote.amountOut.toString(),
              won: true,
            }),
          }).catch((err) =>
            console.warn("[HyperQuote] Failed to persist performance:", err)
          );
        }

        // Persist fill for points program (fire-and-forget)
        fetch("/api/v1/fills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash: hash,
            rfqId: quote.requestId ?? null,
            taker: quote.taker,
            maker: quote.maker,
            tokenIn: quote.tokenIn,
            tokenOut: quote.tokenOut,
            amountIn: quote.amountIn.toString(),
            amountOut: quote.amountOut.toString(),
            amountInUsd: opts?.amountInUsd ?? 0,
            visibility: opts?.visibility ?? "public",
          }),
        }).catch((err) =>
          console.warn("[HyperQuote] Failed to persist fill:", err)
        );

        // Notify feed of fill (fire-and-forget)
        if (quote.requestId) {
          fetch(`/api/v1/rfqs/${quote.requestId}/fill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash: hash }),
          }).catch((err) =>
            console.warn("[HyperQuote] Failed to notify feed of fill:", err)
          );
        }

        return true;
      } catch (error) {
        setTxState({ status: "error", error: getErrorMessage(error) });
        return false;
      }
    },
    [address, writeContractAsync]
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setCurrentRequest(null);
    setReceivedQuotes([]);
    setSelectedQuote(null);
    setTxState({ status: "idle" });
  }, []);

  return {
    // State
    currentRequest,
    receivedQuotes,
    selectedQuote,
    txState,
    feePips: feePips ?? 250,
    trackedRequests,

    // Actions
    createRequest,
    exportRequestJSON,
    importQuoteJSON,
    setSelectedQuote,
    checkAllowance,
    approveToken,
    fillQuote,
    cancelRFQ,
    reset,
  };
}

/**
 * Hook for maker RFQ operations
 *
 * SIGNING: Uses EIP-712 signTypedData — the standard approach.
 *   The contract verifies via ECDSA.recover(eip712Hash, sig), so the maker
 *   must sign using signTypedData with the same domain and types.
 */
export function useMakerRFQ() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [pendingRequests, setPendingRequests] = useState<RFQRequest[]>([]);

  // Get maker's current nonce
  const { data: makerNonce, refetch: refetchNonce } = useReadContract({
    address: RFQ_CONTRACT_ADDRESS,
    abi: RFQ_ABI,
    functionName: "makerNonce",
    args: address ? [address] : undefined,
  });

  // Read feePips from contract (avoid hardcoding)
  const { data: feePips } = useReadContract({
    address: RFQ_CONTRACT_ADDRESS,
    abi: RFQ_ABI,
    functionName: "feePips",
  });

  // Contract write for cancellation
  const { writeContractAsync } = useWriteContract();

  /**
   * Import a request from JSON
   */
  const importRequestJSON = useCallback((jsonString: string): RFQRequest | null => {
    try {
      const json = JSON.parse(jsonString) as RFQRequestJSON;
      const request = requestFromJSON(json);

      // Add to pending requests if not duplicate
      setPendingRequests((prev) => {
        const exists = prev.some((r) => r.id === request.id);
        if (exists) return prev;
        return [...prev, request];
      });

      return request;
    } catch {
      console.error("Failed to parse request JSON");
      return null;
    }
  }, []);

  /**
   * Create and sign a quote for a request.
   *
   * Signing flow:
   *   1. Build the quote struct (same field order as contract)
   *   2. Sign via EIP-712 signTypedData with the HyperQuote domain
   *   3. Contract verifies via ECDSA.recover(_hashTypedDataV4(structHash), sig)
   */
  const createQuote = useCallback(
    async (
      request: RFQRequest,
      quotedAmount: bigint
    ): Promise<RFQQuote | null> => {
      if (!address || makerNonce === undefined || !walletClient) return null;

      try {
        const refetchResult = await refetchNonce();
        const currentNonce = refetchResult.data ?? makerNonce;

        // Determine amountIn and amountOut based on quote kind
        let amountIn: bigint;
        let amountOut: bigint;

        if (request.kind === QuoteKind.EXACT_IN) {
          // Taker specifies amountIn, maker quotes amountOut
          amountIn = request.amountIn!;
          amountOut = quotedAmount;
        } else {
          // Taker specifies amountOut, maker quotes amountIn
          amountIn = quotedAmount;
          amountOut = request.amountOut!;
        }

        // Build quote struct — field order MUST match the contract's Quote struct exactly
        const quoteStruct = {
          kind: request.kind,
          maker: address,
          taker: request.taker,
          tokenIn: request.tokenIn.address,
          tokenOut: request.tokenOut.address,
          amountIn,
          amountOut,
          expiry: BigInt(request.expiry),
          nonce: currentNonce,
        };

        // Sign via EIP-712 signTypedData — matches contract's ECDSA.recover(eip712Hash, sig)
        const signature = await walletClient.signTypedData({
          domain: {
            ...RFQ_EIP712_DOMAIN,
            chainId,
            verifyingContract: RFQ_CONTRACT_ADDRESS,
          },
          types: RFQ_QUOTE_TYPES,
          primaryType: "Quote" as const,
          message: {
            kind: quoteStruct.kind,
            maker: quoteStruct.maker,
            taker: quoteStruct.taker,
            tokenIn: quoteStruct.tokenIn,
            tokenOut: quoteStruct.tokenOut,
            amountIn: quoteStruct.amountIn,
            amountOut: quoteStruct.amountOut,
            expiry: quoteStruct.expiry,
            nonce: quoteStruct.nonce,
          },
        });

        const quote: RFQQuote = {
          kind: request.kind,
          maker: address,
          taker: request.taker,
          tokenIn: request.tokenIn.address,
          tokenOut: request.tokenOut.address,
          amountIn,
          amountOut,
          expiry: request.expiry,
          nonce: currentNonce,
          requestId: request.id,
          signature,
          createdAt: Math.floor(Date.now() / 1000),
        };

        return quote;
      } catch (error) {
        console.error("Failed to create quote:", error);
        return null;
      }
    },
    [address, chainId, makerNonce, walletClient, refetchNonce]
  );

  /**
   * Export quote as JSON for sharing
   */
  const exportQuoteJSON = useCallback((quote: RFQQuote): string => {
    return JSON.stringify(quoteToJSON(quote), null, 2);
  }, []);

  /**
   * Cancel all outstanding quotes
   */
  const cancelAllQuotes = useCallback(async (): Promise<boolean> => {
    if (!address) return false;

    try {
      const hash = await writeContractAsync({
        address: RFQ_CONTRACT_ADDRESS,
        abi: RFQ_ABI,
        functionName: "cancelAllQuotes",
      });

      const { waitForTransactionReceipt } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      
      await waitForTransactionReceipt(wagmiConfig, { hash });

      await refetchNonce();
      return true;
    } catch {
      return false;
    }
  }, [address, writeContractAsync, refetchNonce]);

  /**
   * Remove a request from pending
   */
  const removeRequest = useCallback((requestId: string) => {
    setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  return {
    // State
    pendingRequests,
    makerNonce,
    feePips: (feePips as number | undefined) ?? 250,

    // Actions
    importRequestJSON,
    createQuote,
    exportQuoteJSON,
    cancelAllQuotes,
    removeRequest,
    refetchNonce,
  };
}
