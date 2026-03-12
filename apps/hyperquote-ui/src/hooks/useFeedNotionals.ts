"use client";

import { useState, useEffect, useRef } from "react";
import type { FeedRfqItem } from "@/hooks/useFeedStream";
import { getUsdPrice } from "@/lib/hyperliquid";
import type { Token } from "@/types";

/**
 * Batch-compute USD notional values for a list of feed items.
 *
 * Returns Map<rfqId, usdNotional | null>.
 *
 * Uses getUsdPrice() which has a 20s cache, so repeated calls are cheap.
 * Re-computes when items change and refreshes every 20s.
 */
export function useFeedNotionals(
  items: FeedRfqItem[]
): Map<string, number | null> {
  const [notionals, setNotionals] = useState<Map<string, number | null>>(
    new Map()
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function compute() {
      // Collect unique token symbols that need pricing
      const priceMap = new Map<string, number | null>();
      const tokensToPrice: Array<{
        address: string;
        symbol: string;
        decimals: number;
      }> = [];

      for (const item of items) {
        // For EXACT_IN (kind===0) price the input token amount.
        // For EXACT_OUT (kind===1) price the output token amount.
        const token = item.kind === 0 ? item.tokenIn : item.tokenOut;
        if (token && !priceMap.has(token.symbol)) {
          priceMap.set(token.symbol, null);
          tokensToPrice.push(token);
        }
      }

      // Batch-fetch prices (getUsdPrice has internal 20s cache)
      await Promise.all(
        tokensToPrice.map(async (t) => {
          const price = await getUsdPrice(t as Token).catch(() => null);
          priceMap.set(t.symbol, price);
        })
      );

      if (cancelled) return;

      // Compute per-item notionals
      const result = new Map<string, number | null>();
      for (const item of items) {
        const isExactIn = item.kind === 0;
        const token = isExactIn ? item.tokenIn : item.tokenOut;
        const rawAmount = isExactIn ? item.amountIn : item.amountOut;

        if (!token || !rawAmount) {
          result.set(item.id, null);
          continue;
        }

        const price = priceMap.get(token.symbol);
        if (price == null) {
          result.set(item.id, null);
          continue;
        }

        try {
          const humanAmount =
            Number(BigInt(rawAmount)) / 10 ** token.decimals;
          result.set(item.id, humanAmount * price);
        } catch {
          result.set(item.id, null);
        }
      }

      setNotionals(result);
    }

    compute();

    // Refresh every 20s to match getUsdPrice cache TTL
    intervalRef.current = setInterval(compute, 20_000);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [items]);

  return notionals;
}
