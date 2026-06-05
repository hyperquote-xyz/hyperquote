"use client";

import { useMemo } from "react";
import { useVenueComparison } from "@/hooks/useVenueComparison";
import { QuoteKind, RFQRequest } from "@/types";
import { toDecimalStr, safeSymbol } from "@/lib/utils";
import { isSameTokenPair } from "@/lib/pairValidation";
import { selectPublicBestRoute, computeTheoretical, type PublicBestRoute, type TheoreticalRef, type VenueCandidate } from "@/lib/reference-engine";
import type { BenchmarkData } from "@/hooks/useBenchmark";

/**
 * Hook that provides venue references for the maker ResponseDrawer.
 * Wraps useVenueComparison with the same logic as the swap page,
 * but also exports a BenchmarkData-compatible shape for QuoteBuilder.
 */
export function useMakerReferences(request: RFQRequest | null) {
  const tokenIn = request?.tokenIn ?? null;
  const tokenOut = request?.tokenOut ?? null;
  const amountIn = request?.amountIn != null && tokenIn
    ? toDecimalStr(request.amountIn, tokenIn.decimals)
    : "";

  const enabled = request != null
    && request.kind === QuoteKind.EXACT_IN
    && !!request.amountIn
    && !isSameTokenPair(tokenIn, tokenOut);

  const { result, loading } = useVenueComparison({
    tokenIn,
    tokenOut,
    amountIn,
    enabled,
  });

  return useMemo(() => {
    const decOut = tokenOut?.decimals ?? 18;
    const parsedIn = parseFloat(amountIn) || 0;

    // Build venue candidates
    const candidates: VenueCandidate[] = [];
    let hcHumanOut = 0;
    let prjxHumanOut = 0;
    let htHumanOut = 0;

    if (result) {
      const hc = result.hypercore;
      if (hc.ok === true) {
        hcHumanOut = Number(hc.estimate.amountOut) / 10 ** decOut;
        candidates.push({ source: "HyperCore", amountOut: hcHumanOut, route: hc.estimate.route ?? [], status: "OK_DIRECT", fillRatio: 1.0, slippagePct: hc.slippageVsMid ?? 0 });
      }

      const dex = result.dex;
      if (dex.ok === true) {
        prjxHumanOut = Number(dex.estimate.amountOut) / 10 ** decOut;
        candidates.push({ source: "PRJX DEX", amountOut: prjxHumanOut, route: dex.estimate.route ?? [], status: "OK_DIRECT", fillRatio: 1.0, slippagePct: dex.slippageVsMid ?? 0 });
      }

      const ht = result.ht;
      if (ht.ok === true) {
        htHumanOut = Number(ht.estimate.amountOut) / 10 ** decOut;
        candidates.push({ source: "HT Aggregator", amountOut: htHumanOut, route: ht.estimate.route ?? [], status: "OK_DIRECT", fillRatio: 1.0, slippagePct: ht.slippageVsMid ?? 0 });
      }
    }

    const bestRoute = selectPublicBestRoute(candidates);

    const theoretical = computeTheoretical({
      amountIn: parsedIn,
      midRef: result?.midRef ?? null,
      htPriceIn: null,
      htPriceOut: null,
      prjxAmountOut: prjxHumanOut > 0 ? prjxHumanOut : null,
    });

    // Build BenchmarkData-compatible shape for QuoteBuilder
    const bestAmountOut = bestRoute?.amountOut ?? hcHumanOut ?? 0;
    const benchmarkCompat: BenchmarkData = {
      ammOutput: bestAmountOut > 0 && tokenOut
        ? BigInt(Math.floor(bestAmountOut * 10 ** decOut)).toString()
        : null,
      ammPrice: parsedIn > 0 && bestAmountOut > 0 ? bestAmountOut / parsedIn : null,
      ammImpactBps: null,
      htOutput: htHumanOut > 0 && tokenOut
        ? BigInt(Math.floor(htHumanOut * 10 ** decOut)).toString()
        : null,
      loading,
      error: !loading && candidates.length === 0 && result ? "No venue references available" : null,
    };

    return {
      bestRoute,
      theoretical,
      hcHumanOut,
      prjxHumanOut,
      htHumanOut,
      benchmark: benchmarkCompat,
      loading,
      midRef: result?.midRef ?? null,
    };
  }, [result, loading, tokenOut, amountIn]);
}
