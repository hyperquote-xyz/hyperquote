"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getUsdPrice } from "@/lib/hyperliquid";
import type { Token } from "@/types";

const HYPE_TOKEN: Token = {
  address: "0x0000000000000000000000000000000000000000",
  symbol: "HYPE",
  name: "HYPE",
  decimals: 18,
};

/**
 * Polls Hyperliquid for HYPE mid-price every 15s.
 * Returns `{ spot, updatedAt }` — both null until first successful fetch.
 * Retains last good price on transient failures.
 */
export function useHypeSpot() {
  const [price, setPrice] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const lastGoodRef = useRef<number | null>(null);

  const fetchPrice = useCallback(async () => {
    try {
      const p = await getUsdPrice(HYPE_TOKEN);
      if (p !== null) {
        lastGoodRef.current = p;
        setPrice(p);
        setUpdatedAt(new Date());
      }
      // On null: keep showing lastGoodRef.current (no state change)
    } catch {
      // Network error — keep last good price
    }
  }, []);

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 15_000);
    return () => clearInterval(id);
  }, [fetchPrice]);

  return {
    spot: price,
    updatedAt,
  };
}
