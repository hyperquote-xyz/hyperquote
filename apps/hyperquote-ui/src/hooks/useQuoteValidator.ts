"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { recoverAddress, hexToBytes } from "viem";
import {
  QuoteKind,
  RFQRequest,
  RFQQuote,
  QuoteValidationResult,
  QuoteValidationStatus,
} from "@/types";
import {
  RFQ_CONTRACT_ADDRESS,
  RFQ_ABI,
  ERC20_ABI,
} from "@/config/contracts";
import { secondsUntilExpiry } from "@/lib/utils";

/**
 * Taker-side quote validation hook.
 *
 * For every quote, runs the full 7-step validation pipeline:
 *   1. Structural validation (local, cheap)
 *   2. Recompute quote hash via getQuoteHash on-chain
 *   3. Recover signer from raw hash + signature
 *   4. Verify recovered signer === quote.maker
 *   5. Check freshness / expiry
 *   6. Check taker token allowance
 *   7. Return validation result with UX state
 *
 * CRITICAL: The hash comes from the contract. The signature is verified
 * via recoverAddress on the raw hash. No EIP-712 typed data, no re-hashing.
 */
export function useQuoteValidator(
  request: RFQRequest | null,
  quote: RFQQuote | null
) {
  const { address } = useAccount();
  const [result, setResult] = useState<QuoteValidationResult>({ status: "validating" });
  const abortRef = useRef<AbortController | null>(null);

  const validate = useCallback(async () => {
    if (!quote || !request || !address) {
      setResult({ status: "validating" });
      return;
    }

    // Abort any in-flight validation
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResult({ status: "validating" });

    try {
      // ── Step 1: Structural validation (cheap, local) ──

      // Token pair must match
      if (quote.tokenIn.toLowerCase() !== request.tokenIn.address.toLowerCase()) {
        setResult({ status: "structural_mismatch", message: "tokenIn does not match request" });
        return;
      }
      if (quote.tokenOut.toLowerCase() !== request.tokenOut.address.toLowerCase()) {
        setResult({ status: "structural_mismatch", message: "tokenOut does not match request" });
        return;
      }

      // Mode must match
      if (quote.kind !== request.kind) {
        setResult({ status: "structural_mismatch", message: "Quote kind does not match request" });
        return;
      }

      // Fixed amount must match
      if (request.kind === QuoteKind.EXACT_IN && request.amountIn !== undefined) {
        if (quote.amountIn !== request.amountIn) {
          setResult({ status: "structural_mismatch", message: "amountIn does not match (Exact-In)" });
          return;
        }
      }
      if (request.kind === QuoteKind.EXACT_OUT && request.amountOut !== undefined) {
        if (quote.amountOut !== request.amountOut) {
          setResult({ status: "structural_mismatch", message: "amountOut does not match (Exact-Out)" });
          return;
        }
      }

      // Taker restriction
      if (
        quote.taker !== "0x0000000000000000000000000000000000000000" &&
        quote.taker.toLowerCase() !== address.toLowerCase()
      ) {
        setResult({ status: "structural_mismatch", message: "Quote restricted to a different taker" });
        return;
      }

      // Signature present
      if (!quote.signature || quote.signature.length < 130) {
        setResult({ status: "invalid_signature", message: "Signature missing or malformed" });
        return;
      }

      // Expiry check (quick, before RPC calls)
      const secsLeft = secondsUntilExpiry(quote.expiry);
      if (secsLeft <= 0) {
        setResult({ status: "expired", message: "Quote has expired", secondsLeft: 0 });
        return;
      }

      if (controller.signal.aborted) return;

      // ── Step 2: Recompute quote hash via contract ──

      const { readContract } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");

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

      const quoteHash = await readContract(wagmiConfig, {
        address: RFQ_CONTRACT_ADDRESS,
        abi: RFQ_ABI,
        functionName: "getQuoteHash",
        args: [quoteStruct],
      }) as `0x${string}`;

      if (controller.signal.aborted) return;

      // ── Step 3: Recover signer from raw hash ──
      // The maker signed the raw hash bytes with signMessage({ raw: hexToBytes(hash) }).
      // recoverAddress with the hash and signature will recover the correct signer.

      let recoveredSigner: `0x${string}`;
      try {
        recoveredSigner = await recoverAddress({
          hash: quoteHash,
          signature: quote.signature,
        });
      } catch {
        setResult({
          status: "invalid_signature",
          message: "Could not recover signer from signature",
          quoteHash,
        });
        return;
      }

      if (controller.signal.aborted) return;

      // ── Step 4: Verify signer === maker ──

      if (recoveredSigner.toLowerCase() !== quote.maker.toLowerCase()) {
        setResult({
          status: "invalid_signature",
          message: `Signature does not match maker. Recovered: ${recoveredSigner.slice(0, 10)}…`,
          quoteHash,
          recoveredSigner,
        });
        return;
      }

      // ── Step 5: Freshness check ──

      const secsLeftNow = secondsUntilExpiry(quote.expiry);
      if (secsLeftNow <= 0) {
        setResult({ status: "expired", message: "Quote expired during validation", secondsLeft: 0, quoteHash, recoveredSigner });
        return;
      }

      if (controller.signal.aborted) return;

      // ── Step 6: Allowance check ──

      try {
        const allowance = await readContract(wagmiConfig, {
          address: quote.tokenIn as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, RFQ_CONTRACT_ADDRESS],
        });

        if (allowance < quote.amountIn) {
          setResult({
            status: "needs_approval",
            message: `Approve ${quote.tokenIn.slice(0, 10)}… before filling`,
            quoteHash,
            recoveredSigner,
            secondsLeft: secsLeftNow,
          });
          return;
        }
      } catch {
        // Allowance check failed — don't block, just warn
        // The fill tx will revert if allowance is insufficient
      }

      if (controller.signal.aborted) return;

      // ── Step 7: Return final status ──

      if (secsLeftNow <= 10) {
        setResult({
          status: "expiring_soon",
          message: `Quote expires in ${secsLeftNow}s`,
          quoteHash,
          recoveredSigner,
          secondsLeft: secsLeftNow,
        });
      } else {
        setResult({
          status: "valid",
          message: "Signature verified ✓",
          quoteHash,
          recoveredSigner,
          secondsLeft: secsLeftNow,
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setResult({
        status: "error",
        message: err instanceof Error ? err.message : "Validation failed",
      });
    }
  }, [quote, request, address]);

  // Re-run validation when quote changes
  useEffect(() => {
    validate();
    return () => {
      abortRef.current?.abort();
    };
  }, [validate]);

  // Tick expiry every second for live freshness
  useEffect(() => {
    if (!quote || result.status === "invalid_signature" || result.status === "structural_mismatch" || result.status === "error") {
      return;
    }

    const interval = setInterval(() => {
      const secsLeft = secondsUntilExpiry(quote.expiry);
      if (secsLeft <= 0 && result.status !== "expired") {
        setResult((prev) => ({ ...prev, status: "expired", message: "Quote has expired", secondsLeft: 0 }));
      } else if (secsLeft <= 10 && result.status === "valid") {
        setResult((prev) => ({ ...prev, status: "expiring_soon", message: `Quote expires in ${secsLeft}s`, secondsLeft: secsLeft }));
      } else if (result.secondsLeft !== undefined) {
        setResult((prev) => ({ ...prev, secondsLeft: secsLeft }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [quote, result.status]);

  /** Re-validate (e.g. after approval) */
  const revalidate = useCallback(() => {
    validate();
  }, [validate]);

  return { ...result, revalidate };
}

/**
 * Batch validator — validates multiple quotes at once.
 * Returns a Map of signature → QuoteValidationResult.
 */
export function useQuoteValidatorBatch(
  request: RFQRequest | null,
  quotes: RFQQuote[]
) {
  const { address } = useAccount();
  const [results, setResults] = useState<Map<string, QuoteValidationResult>>(new Map());

  useEffect(() => {
    if (!request || !address || quotes.length === 0) {
      setResults(new Map());
      return;
    }

    let cancelled = false;

    async function validateAll() {
      const { readContract } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      const newResults = new Map<string, QuoteValidationResult>();

      for (const quote of quotes) {
        if (cancelled) return;

        try {
          // Step 1: Quick structural checks
          const structError = getStructuralError(quote, request!, address!);
          if (structError) {
            newResults.set(quote.signature, structError);
            continue;
          }

          const secsLeft = secondsUntilExpiry(quote.expiry);
          if (secsLeft <= 0) {
            newResults.set(quote.signature, { status: "expired", message: "Quote has expired", secondsLeft: 0 });
            continue;
          }

          // Step 2: Get hash from contract
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

          const quoteHash = await readContract(wagmiConfig, {
            address: RFQ_CONTRACT_ADDRESS,
            abi: RFQ_ABI,
            functionName: "getQuoteHash",
            args: [quoteStruct],
          }) as `0x${string}`;

          // Step 3: Recover signer
          let recoveredSigner: `0x${string}`;
          try {
            recoveredSigner = await recoverAddress({
              hash: quoteHash,
              signature: quote.signature,
            });
          } catch {
            newResults.set(quote.signature, {
              status: "invalid_signature",
              message: "Could not recover signer",
              quoteHash,
            });
            continue;
          }

          // Step 4: Verify signer
          if (recoveredSigner.toLowerCase() !== quote.maker.toLowerCase()) {
            newResults.set(quote.signature, {
              status: "invalid_signature",
              message: "Signature does not match maker",
              quoteHash,
              recoveredSigner,
            });
            continue;
          }

          // Step 5: Freshness
          const secsLeftNow = secondsUntilExpiry(quote.expiry);

          // Step 6: Allowance
          let needsApproval = false;
          try {
            const allowance = await readContract(wagmiConfig, {
              address: quote.tokenIn as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [address!, RFQ_CONTRACT_ADDRESS],
            });
            needsApproval = allowance < quote.amountIn;
          } catch {
            // Don't block on allowance check failure
          }

          if (needsApproval) {
            newResults.set(quote.signature, {
              status: "needs_approval",
              message: "Token approval required",
              quoteHash,
              recoveredSigner,
              secondsLeft: secsLeftNow,
            });
          } else if (secsLeftNow <= 10) {
            newResults.set(quote.signature, {
              status: "expiring_soon",
              message: `Expires in ${secsLeftNow}s`,
              quoteHash,
              recoveredSigner,
              secondsLeft: secsLeftNow,
            });
          } else {
            newResults.set(quote.signature, {
              status: "valid",
              message: "Signature verified ✓",
              quoteHash,
              recoveredSigner,
              secondsLeft: secsLeftNow,
            });
          }
        } catch (err) {
          newResults.set(quote.signature, {
            status: "error",
            message: err instanceof Error ? err.message : "Validation failed",
          });
        }
      }

      if (!cancelled) {
        setResults(newResults);
      }
    }

    validateAll();

    return () => {
      cancelled = true;
    };
  }, [request, quotes, address]);

  // Tick expiry
  useEffect(() => {
    if (quotes.length === 0) return;
    const interval = setInterval(() => {
      setResults((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const quote of quotes) {
          const r = next.get(quote.signature);
          if (!r || r.status === "invalid_signature" || r.status === "structural_mismatch" || r.status === "error") continue;
          const secsLeft = secondsUntilExpiry(quote.expiry);
          if (secsLeft <= 0 && r.status !== "expired") {
            next.set(quote.signature, { ...r, status: "expired", message: "Quote has expired", secondsLeft: 0 });
            changed = true;
          } else if (secsLeft <= 10 && r.status === "valid") {
            next.set(quote.signature, { ...r, status: "expiring_soon", message: `Expires in ${secsLeft}s`, secondsLeft: secsLeft });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [quotes]);

  return results;
}

// ── Helper ──

function getStructuralError(
  quote: RFQQuote,
  request: RFQRequest,
  takerAddress: string
): QuoteValidationResult | null {
  if (quote.tokenIn.toLowerCase() !== request.tokenIn.address.toLowerCase()) {
    return { status: "structural_mismatch", message: "tokenIn mismatch" };
  }
  if (quote.tokenOut.toLowerCase() !== request.tokenOut.address.toLowerCase()) {
    return { status: "structural_mismatch", message: "tokenOut mismatch" };
  }
  if (quote.kind !== request.kind) {
    return { status: "structural_mismatch", message: "Quote kind mismatch" };
  }
  if (request.kind === QuoteKind.EXACT_IN && request.amountIn !== undefined && quote.amountIn !== request.amountIn) {
    return { status: "structural_mismatch", message: "amountIn mismatch (Exact-In)" };
  }
  if (request.kind === QuoteKind.EXACT_OUT && request.amountOut !== undefined && quote.amountOut !== request.amountOut) {
    return { status: "structural_mismatch", message: "amountOut mismatch (Exact-Out)" };
  }
  if (
    quote.taker !== "0x0000000000000000000000000000000000000000" &&
    quote.taker.toLowerCase() !== takerAddress.toLowerCase()
  ) {
    return { status: "structural_mismatch", message: "Restricted to different taker" };
  }
  if (!quote.signature || quote.signature.length < 130) {
    return { status: "invalid_signature", message: "Signature missing or malformed" };
  }
  return null;
}
