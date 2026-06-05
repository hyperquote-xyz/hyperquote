"use client";

/**
 * useVenueComparison — React hook for the unified venue comparison service.
 *
 * Manages AbortController lifecycle, debouncing, optional polling, and
 * last-known-good preservation so callers get a simple interface:
 *
 *   const { result, loading, everFetched, updatedAt, refresh } =
 *     useVenueComparison({ tokenIn, tokenOut, amountIn, pollIntervalMs: 30_000 });
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Token } from "@/types";
import { parseAmount } from "@/lib/utils";
import {
  estimateVenues,
  type VenueComparisonResult,
} from "@/lib/venueComparison";

// ---------------------------------------------------------------------------
// Options & return types
// ---------------------------------------------------------------------------

export interface UseVenueComparisonOptions {
  tokenIn: Token | null;
  tokenOut: Token | null;
  amountIn: string;
  /** Optional amountOut for exact-out benchmark reference */
  amountOut?: string;
  /** Optional RFQ ID — when this changes, results are cleared immediately. */
  rfqId?: string | null;
  /** Polling interval in ms. 0 = no polling. Default 0. */
  pollIntervalMs?: number;
  /** Whether to fetch at all. Defaults to true. */
  enabled?: boolean;
}

export interface UseVenueComparisonReturn {
  result: VenueComparisonResult | null;
  loading: boolean;
  everFetched: boolean;
  updatedAt: number | null;
  /** Trigger an immediate re-fetch (ignores debounce). */
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 1_200; // match existing 1.2s debounce across the app

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVenueComparison(
  opts: UseVenueComparisonOptions,
): UseVenueComparisonReturn {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    rfqId,
    pollIntervalMs = 0,
    enabled = true,
  } = opts;

  const [result, setResult] = useState<VenueComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [everFetched, setEverFetched] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Core fetch logic
  // ------------------------------------------------------------------
  const fetchEstimates = useCallback(
    async (silent = false) => {
      if (!tokenIn || !tokenOut || !amountIn || !enabled) return;

      let parsedIn: bigint;
      try {
        parsedIn = parseAmount(amountIn, tokenIn.decimals);
      } catch {
        return;
      }
      if (parsedIn <= 0n) return;

      let parsedOut: bigint | undefined;
      if (amountOut && tokenOut) {
        try {
          parsedOut = parseAmount(amountOut, tokenOut.decimals);
          if (parsedOut <= 0n) parsedOut = undefined;
        } catch {
          /* ignore */
        }
      }

      // Abort previous in-flight request
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      if (!silent) setLoading(true);

      try {
        const res = await estimateVenues({
          tokenIn,
          tokenOut,
          amountIn: parsedIn,
          amountOut: parsedOut,
          signal: controller.signal,
        });

        // Stale — a newer request has replaced this controller
        if (controller.signal.aborted) return;

        // Merge with last-known-good: overwrite on success or partial (definitive answers).
        // Preserve previous value ONLY on transient_failure.
        setResult((prev) => {
          if (!prev) return res;
          return {
            hypercore:
              res.hypercore.ok === false && res.hypercore.reason === "transient_failure"
                ? (prev.hypercore ?? res.hypercore)
                : res.hypercore,
            dex:
              res.dex.ok === false && res.dex.reason === "transient_failure"
                ? (prev.dex ?? res.dex)
                : res.dex,
            ht:
              res.ht.ok === false && res.ht.reason === "transient_failure"
                ? (prev.ht ?? res.ht)
                : res.ht,
            midRef: res.midRef ?? prev.midRef,
            timingMs: res.timingMs,
          };
        });
        setUpdatedAt(Date.now());
      } catch {
        // Silently handle — abort errors or unexpected failures
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setEverFetched(true);
        }
      }
    },
    [tokenIn, tokenOut, amountIn, amountOut, enabled],
  );

  // ------------------------------------------------------------------
  // Debounced trigger on input changes
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!tokenIn || !tokenOut || !amountIn || !enabled) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchEstimates(false), DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tokenIn, tokenOut, amountIn, enabled, fetchEstimates]);

  // ------------------------------------------------------------------
  // Clear results when tokens change (prevents stale pair data)
  // ------------------------------------------------------------------
  const prevTokensRef = useRef<string>("");
  useEffect(() => {
    const key = `${tokenIn?.address ?? ""}-${tokenOut?.address ?? ""}`;
    if (prevTokensRef.current && prevTokensRef.current !== key) {
      setResult(null);
      setEverFetched(false);
      setUpdatedAt(null);
    }
    prevTokensRef.current = key;
  }, [tokenIn?.address, tokenOut?.address]);

  // ------------------------------------------------------------------
  // Clear results when selected RFQ changes (prevents stale cross-RFQ data)
  // ------------------------------------------------------------------
  const prevRfqIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevRfqIdRef.current !== undefined && prevRfqIdRef.current !== rfqId) {
      // Abort any in-flight request from the old RFQ
      controllerRef.current?.abort();
      setResult(null);
      setEverFetched(false);
      setUpdatedAt(null);
      setLoading(false);
    }
    prevRfqIdRef.current = rfqId;
  }, [rfqId]);

  // ------------------------------------------------------------------
  // Polling — silent background refresh at pollIntervalMs
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    if (!tokenIn || !tokenOut || !amountIn || !enabled) return;

    const interval = setInterval(() => {
      fetchEstimates(true);
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [pollIntervalMs, tokenIn, tokenOut, amountIn, enabled, fetchEstimates]);

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ------------------------------------------------------------------
  // Manual refresh (bypasses debounce)
  // ------------------------------------------------------------------
  const refresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchEstimates(false);
  }, [fetchEstimates]);

  return { result, loading, everFetched, updatedAt, refresh };
}
