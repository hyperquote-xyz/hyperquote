"use client";

/**
 * useAggregatorBench — External Aggregator Benchmark Hook
 *
 * Fetches benchmark pricing from HT.xyz and HyperBloom aggregators
 * in parallel when enabled. Follows the same debounce + cache + abort
 * pattern as useAMMBaseline.
 *
 * Features:
 *   - Lazy-enabled: only fires when `enabled` is true (modal open)
 *   - 1.5s debounce on input changes
 *   - 8s cache TTL (longer than useAMMBaseline for external APIs)
 *   - Promise.allSettled for independent parallel fetches
 *   - AbortController for cancellation on input change / unmount
 *   - No polling — fetched once on demand, user clicks "Refresh" for new data
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Token } from "@/types";
import { parseAmount } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Exported types (shared with AggregatorBenchModal)
// ---------------------------------------------------------------------------

export interface BenchRouteSplit {
  dex: string;
  portion: number;
  poolAddress: string;
  fee: number;
}

export interface HTBenchResult {
  source: "ht.xyz";
  outputAmount: string | null;
  route: BenchRouteSplit[];
  computeTimeMs: number;
  error: string | null;
}

export interface HyperBloomBenchResult {
  source: "hyperbloom";
  enabled: boolean;
  outputAmount: string | null;
  route: BenchRouteSplit[];
  computeTimeMs: number;
  error: string | null;
}

export interface AggregatorBenchState {
  ht: HTBenchResult | null;
  hyperbloom: HyperBloomBenchResult | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 1_500;
const CACHE_TTL_MS = 8_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAggregatorBench(
  tokenIn: Token | null,
  tokenOut: Token | null,
  amountIn: string,
  /** Only fetch when explicitly enabled (e.g. modal is open) */
  enabled: boolean
): AggregatorBenchState & { refetch: () => void } {
  const [state, setState] = useState<AggregatorBenchState>({
    ht: null,
    hyperbloom: null,
    loading: false,
    error: null,
    fetchedAt: null,
  });

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const cacheRef = useRef<{
    key: string;
    ht: HTBenchResult | null;
    hyperbloom: HyperBloomBenchResult | null;
    at: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBenchmarks = useCallback(async () => {
    if (!enabled || !tokenIn || !tokenOut || !amountIn) {
      setState({
        ht: null,
        hyperbloom: null,
        loading: false,
        error: null,
        fetchedAt: null,
      });
      return;
    }

    // Same-pair guard
    if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
      return;
    }

    // Parse amount
    let parsedIn: bigint;
    try {
      parsedIn = parseAmount(amountIn, tokenIn.decimals);
    } catch {
      return;
    }
    if (parsedIn <= 0n) return;

    const cacheKey = `bench-${tokenIn.address}-${tokenOut.address}-${parsedIn.toString()}`;

    // Check cache
    const now = Date.now();
    if (
      cacheRef.current &&
      cacheRef.current.key === cacheKey &&
      now - cacheRef.current.at < CACHE_TTL_MS
    ) {
      setState({
        ht: cacheRef.current.ht,
        hyperbloom: cacheRef.current.hyperbloom,
        loading: false,
        error: null,
        fetchedAt: cacheRef.current.at,
      });
      return;
    }

    // Abort previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const params = new URLSearchParams({
      sellToken: tokenIn.address,
      buyToken: tokenOut.address,
      sellAmount: parsedIn.toString(),
    });

    try {
      // Fire both in parallel — one failing doesn't block the other
      const [htResult, hbResult] = await Promise.allSettled([
        fetch(`/api/v1/bench/ht/price?${params}`, {
          signal: controller.signal,
        }).then((r) => r.json() as Promise<HTBenchResult>),
        fetch(`/api/v1/bench/hyperbloom/price?${params}`, {
          signal: controller.signal,
        }).then((r) => r.json() as Promise<HyperBloomBenchResult>),
      ]);

      // Don't update state if this request was aborted
      if (controller.signal.aborted) return;

      const ht =
        htResult.status === "fulfilled" ? htResult.value : null;
      const hyperbloom =
        hbResult.status === "fulfilled" ? hbResult.value : null;
      const fetchedAt = Date.now();

      cacheRef.current = { key: cacheKey, ht, hyperbloom, at: fetchedAt };
      setState({ ht, hyperbloom, loading: false, error: null, fetchedAt });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error:
          err instanceof Error ? err.message : "Benchmark fetch failed",
      }));
    }
  }, [tokenIn, tokenOut, amountIn, enabled]);

  // Debounced fetch — only fires when enabled
  useEffect(() => {
    if (!enabled || !amountIn || !tokenIn || !tokenOut) {
      return;
    }

    if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchBenchmarks, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [amountIn, tokenIn, tokenOut, enabled, fetchBenchmarks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { ...state, refetch: fetchBenchmarks };
}
