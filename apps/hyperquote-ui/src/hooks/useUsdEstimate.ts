"use client";

import { useState, useEffect, useRef } from "react";
import { Token } from "@/types";
import { getUsdPrice } from "@/lib/hyperliquid";

/**
 * useUsdEstimate — reusable hook for USD value estimation.
 *
 * Pricing assumptions:
 *  • Stablecoins (USDC, USD₮0, USDH, USDT, DAI) → $1.00
 *  • All others → Hyperliquid spot mid-price (best bid + best ask / 2),
 *    fetched from the L2 book endpoint with a 20-second client-side cache.
 *  • If the Hyperliquid API is unreachable or the token has no book,
 *    the hook returns null (UI shows nothing rather than a wrong number).
 *
 * @param token   The token whose USD rate we need (null clears the estimate).
 * @param amount  Human-readable amount string typed by the user (e.g. "1.5").
 * @returns       `{ usdValue, usdPrice, loading }`
 *                - usdValue: amount × price  (null if unavailable)
 *                - usdPrice: per-unit price   (null if unavailable)
 *                - loading:  true while the first fetch is in-flight
 */
export function useUsdEstimate(
  token: Token | null | undefined,
  amount: string
) {
  const [usdPrice, setUsdPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  // Track last-fetched symbol so we don't show stale data during transition
  const lastSymbolRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setUsdPrice(null);
      lastSymbolRef.current = null;
      return;
    }

    const sym = token.symbol;
    // Don't re-fetch if symbol hasn't changed
    if (sym === lastSymbolRef.current) return;

    lastSymbolRef.current = sym;
    let cancelled = false;

    setLoading(true);
    getUsdPrice(token)
      .then((p) => {
        if (!cancelled) setUsdPrice(p);
      })
      .catch(() => {
        if (!cancelled) setUsdPrice(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Also refresh every 20s while mounted (piggybacks on the cache TTL)
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      getUsdPrice(token)
        .then(setUsdPrice)
        .catch(() => setUsdPrice(null));
    }, 20_000);
    return () => clearInterval(id);
  }, [token]);

  // Derive USD value from the amount string and unit price
  const parsed = parseFloat(amount);
  const usdValue =
    usdPrice != null && !isNaN(parsed) && parsed > 0
      ? parsed * usdPrice
      : null;

  return { usdValue, usdPrice, loading } as const;
}
