"use client";

/**
 * usePositions — fetches HyperQuote Options positions for the connected wallet.
 *
 * Strategy:
 *   1. Read positionCount() from OptionsEngine.
 *   2. Batch read getPosition(id) via multicall for IDs 1..count.
 *   3. Filter to positions where seller == wallet OR buyer == wallet.
 *   4. Fetch spot from terminal-api /options/venues (reuses existing infra).
 *   5. Enrich each position with display values via positions-utils.
 *   6. Poll on configurable interval (default 12s) + manual refetch.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, usePublicClient } from "wagmi";
import {
  OPTIONS_ENGINE_ABI,
  enrichPosition,
  type RawPosition,
  type EnrichedPosition,
} from "@/lib/positions-utils";
import type { Address } from "viem";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPTIONS_ENGINE_ADDRESS = (process.env.NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS ??
  "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address;

const TERMINAL_API =
  process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:4200";

const DEFAULT_POLL_MS = 12_000;

// ---------------------------------------------------------------------------
// Spot fetcher (reuses terminal-api venues endpoint)
// ---------------------------------------------------------------------------

async function fetchSpot(underlying: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${TERMINAL_API}/options/venues?underlying=${encodeURIComponent(underlying)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const firstExpiry = data?.expiries?.[0];
    return firstExpiry?.spot ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePositionsResult {
  positions: EnrichedPosition[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastUpdated: Date | null;
}

export function usePositions(opts?: {
  pollMs?: number;
}): UsePositionsResult {
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [positions, setPositions] = useState<EnrichedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchPositions = useCallback(async () => {
    if (!isConnected || !address || !publicClient) {
      setPositions([]);
      setLoading(false);
      return;
    }

    try {
      // 1. Read position count
      const count = await publicClient.readContract({
        address: OPTIONS_ENGINE_ADDRESS,
        abi: OPTIONS_ENGINE_ABI,
        functionName: "positionCount",
      });

      const totalCount = Number(count);
      if (totalCount === 0) {
        if (mountedRef.current) {
          setPositions([]);
          setError(null);
          setLoading(false);
          setLastUpdated(new Date());
        }
        return;
      }

      // 2. Batch read positions via multicall.
      // We only scan the most recent 300 positions to prevent RPC blowups at scale.
      // Older positions belonging to this wallet will not appear until we add
      // server-side indexing or subgraph support.
      const MAX_SCAN_WINDOW = 300;
      const fromId = Math.max(1, totalCount - MAX_SCAN_WINDOW + 1);
      const scanCount = totalCount - fromId + 1;

      const calls = Array.from({ length: scanCount }, (_, i) => ({
        address: OPTIONS_ENGINE_ADDRESS,
        abi: OPTIONS_ENGINE_ABI,
        functionName: "getPosition" as const,
        args: [BigInt(fromId + i)] as const,
      }));

      const results = await publicClient.multicall({
        contracts: calls,
        allowFailure: true,
      });

      // 3. Filter to wallet positions and collect unique underlyings
      const walletLower = address.toLowerCase();
      const walletPositions: { id: number; raw: RawPosition }[] = [];
      const underlyings = new Set<string>();

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status !== "success" || !result.result) continue;

        const pos = result.result as unknown as RawPosition;
        const positionId = fromId + i; // Map back to actual on-chain ID
        if (
          pos.seller.toLowerCase() === walletLower ||
          pos.buyer.toLowerCase() === walletLower
        ) {
          walletPositions.push({ id: positionId, raw: pos });
          underlyings.add(pos.underlying.toLowerCase());
        }
      }

      // 4. Fetch spot prices for all underlyings
      const spotMap = new Map<string, number | null>();
      // Use HYPE as default — most positions will be HYPE underlying
      const hypeSpot = await fetchSpot("HYPE");
      spotMap.set("hype", hypeSpot);

      // Also fetch ETH/BTC if positions use those underlyings
      for (const addr of underlyings) {
        if (!spotMap.has(addr)) {
          // For now, all underlyings map to HYPE spot context
          // (expandable when multiple underlyings are supported)
          spotMap.set(addr, hypeSpot);
        }
      }

      // 5. Enrich positions
      const enriched = walletPositions.map(({ id, raw }) => {
        const spot = spotMap.get(raw.underlying.toLowerCase()) ?? hypeSpot;
        return enrichPosition(id, raw, address, spot);
      });

      // Sort: active/pending_expiry first (by expiry ASC), then expired/settled (by expiry DESC)
      const isActiveBucket = (l: string) =>
        l === "active" || l === "pending_expiry";

      enriched.sort((a, b) => {
        const aActive = isActiveBucket(a.lifecycle);
        const bActive = isActiveBucket(b.lifecycle);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        if (aActive) return a.expiryTs - b.expiryTs; // soonest first
        return b.expiryTs - a.expiryTs; // most recent first
      });

      if (mountedRef.current) {
        setPositions(enriched);
        setError(null);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [address, isConnected, publicClient]);

  // Initial fetch + polling
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    void fetchPositions();

    const timer = setInterval(() => void fetchPositions(), pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchPositions, pollMs]);

  return {
    positions,
    loading,
    error,
    refetch: fetchPositions,
    lastUpdated,
  };
}
