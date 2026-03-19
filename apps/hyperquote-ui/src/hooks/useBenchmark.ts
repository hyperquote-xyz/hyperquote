"use client";

import { useState, useEffect } from "react";
import { QuoteKind, RFQRequest } from "@/types";
import { safeSymbol } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkData {
  /** AMM/SOR baseline output (or input for exact-out) */
  ammOutput: string | null;
  /** AMM effective price */
  ammPrice: number | null;
  /** AMM price impact in BPS */
  ammImpactBps: number | null;
  /** HT.xyz simulated output */
  htOutput: string | null;
  /** Whether data is still loading */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
}

/**
 * Compute BPS improvement of maker quote vs benchmark.
 * Positive = maker is offering MORE output (better for taker).
 * Works for exact-in: (makerOut - benchmarkOut) / benchmarkOut * 10000
 */
export function computeBps(
  makerAmount: bigint,
  benchmarkAmount: bigint | null,
): number | null {
  if (!benchmarkAmount || benchmarkAmount <= 0n) return null;
  const diff = Number(makerAmount - benchmarkAmount);
  const base = Number(benchmarkAmount);
  return Math.round((diff / base) * 10000);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch AMM/SOR benchmark for an RFQ.
 * Non-blocking — returns loading/error state.
 * Uses the existing /api/v1/sor/quote endpoint.
 */
export function useBenchmark(request: RFQRequest | null): BenchmarkData {
  const [data, setData] = useState<BenchmarkData>({
    ammOutput: null,
    ammPrice: null,
    ammImpactBps: null,
    htOutput: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!request) return;

    const isExactIn = request.kind === QuoteKind.EXACT_IN;

    // Only fetch for exact-in with amountIn (most common case)
    if (!isExactIn || !request.amountIn) {
      setData((prev) => ({ ...prev, loading: false }));
      return;
    }

    let cancelled = false;
    setData((prev) => ({ ...prev, loading: true, error: null }));

    const params = new URLSearchParams({
      tokenIn: request.tokenIn.address,
      tokenOut: request.tokenOut.address,
      amountIn: request.amountIn!.toString(),
      maxRoutes: "3",
      explain: "true",
    });

    fetch(`/api/v1/sor/quote?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`SOR ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        // Extract from ExplainedQuote shape
        const summary = json.summary;
        const ammOutput = summary?.totalAmountOut ?? null;
        const ammPrice = summary?.effectivePrice ?? null;
        const ammImpactBps = summary?.priceImpactBps ?? null;

        setData({
          ammOutput,
          ammPrice,
          ammImpactBps,
          htOutput: null, // HT.xyz integration TBD
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setData({
          ammOutput: null,
          ammPrice: null,
          ammImpactBps: null,
          htOutput: null,
          loading: false,
          error: err instanceof Error ? err.message : "Benchmark unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return data;
}
