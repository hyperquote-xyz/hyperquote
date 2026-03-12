"use client";

/**
 * useAMMBaseline — Debounced SOR Quote Hook
 *
 * Fetches the AMM baseline quote from GET /api/v1/sor/quote whenever
 * the user's trade inputs (tokenIn, tokenOut, amountIn) change.
 *
 * Features:
 *   - 1.2s debounce on input changes
 *   - 4s cache TTL (matches venue estimate cache)
 *   - Loading / error / stale states
 *   - Auto-clears on token swap or invalid input
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Token } from "@/types";
import { parseAmount } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SOR Quote response shape (matches ExplainedQuote from /api/v1/sor/quote)
// ---------------------------------------------------------------------------

export interface SORRouteHop {
  poolAddress: string;
  protocol: string;
  poolType: string;
  tokenIn: string;
  tokenInSymbol?: string;
  tokenOut: string;
  tokenOutSymbol?: string;
  amountIn: string;
  amountOut: string;
  fee: string;
  priceImpactBps: number;
}

export interface SORRouteAllocation {
  fraction: number;
  fractionPct: string;
  amountIn: string;
  amountOut: string;
  hops: SORRouteHop[];
  pathLabel: string;
  priceImpactBps: number;
}

export interface SORAlternative {
  pathLabel: string;
  amountOut: string;
  diffBps: number;
  diffPct: string;
  reason: string;
}

export interface SORQuoteResponse {
  meta: {
    timestamp: string;
    asOfBlock: string;
    computeTimeMs: number;
    candidatesConsidered: number;
    viableRoutes: number;
    isSplit: boolean;
  };
  summary: {
    tokenIn: string;
    tokenInSymbol: string;
    tokenInDecimals: number;
    tokenOut: string;
    tokenOutSymbol: string;
    tokenOutDecimals: number;
    amountIn: string;
    amountOut: string;
    amountInFormatted: string;
    amountOutFormatted: string;
    effectivePrice: number;
    midPrice: number;
    priceImpactBps: number;
    priceImpactPct: string;
  };
  routes: SORRouteAllocation[];
  alternatives: SORAlternative[];
  warnings: string[];
  fees: { token: string; amount: string; symbol?: string }[];
  splitInfo?: {
    routeCount: number;
    bestSingleRouteOutput: string;
    improvementBps: number;
    improvementPct: string;
  };
  // Safety layer additions
  confidenceLevel?: string;
  safetyWarnings?: string[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 1_200;
const CACHE_TTL_MS = 4_000;

interface BaselineState {
  /** The SOR quote data */
  data: SORQuoteResponse | null;
  /** Loading state */
  loading: boolean;
  /** Error message (if any) */
  error: string | null;
  /** Timestamp when data was last fetched */
  fetchedAt: number | null;
}

export function useAMMBaseline(
  tokenIn: Token | null,
  tokenOut: Token | null,
  amountIn: string
): BaselineState & { refetch: () => void } {
  const [state, setState] = useState<BaselineState>({
    data: null,
    loading: false,
    error: null,
    fetchedAt: null,
  });

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const cacheRef = useRef<{
    key: string;
    data: SORQuoteResponse;
    at: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBaseline = useCallback(async () => {
    if (!tokenIn || !tokenOut || !amountIn) {
      setState({ data: null, loading: false, error: null, fetchedAt: null });
      return;
    }

    // Same-pair guard
    if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
      setState({ data: null, loading: false, error: null, fetchedAt: null });
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

    const cacheKey = `${tokenIn.address}-${tokenOut.address}-${parsedIn.toString()}`;

    // Check cache
    const now = Date.now();
    if (
      cacheRef.current &&
      cacheRef.current.key === cacheKey &&
      now - cacheRef.current.at < CACHE_TTL_MS
    ) {
      setState({
        data: cacheRef.current.data,
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

    try {
      const params = new URLSearchParams({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: parsedIn.toString(),
      });

      const res = await fetch(`/api/v1/sor/quote?${params}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data: SORQuoteResponse = await res.json();
      const fetchedAt = Date.now();

      cacheRef.current = { key: cacheKey, data, at: fetchedAt };
      setState({ data, loading: false, error: null, fetchedAt });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch baseline",
      }));
    }
  }, [tokenIn, tokenOut, amountIn]);

  // Debounced fetch on input changes
  useEffect(() => {
    if (!amountIn || !tokenIn || !tokenOut) {
      setState({ data: null, loading: false, error: null, fetchedAt: null });
      return;
    }

    if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchBaseline, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [amountIn, tokenIn, tokenOut, fetchBaseline]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { ...state, refetch: fetchBaseline };
}
