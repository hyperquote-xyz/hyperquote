"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getAddress } from "viem";
import type { BadgeResult } from "@/lib/badges";

/**
 * Client-side hook that fetches badge data for multiple addresses.
 *
 * - Normalizes addresses with getAddress() (checksum) for consistent cache keys.
 * - Batches lookups to avoid redundant fetches.
 * - Caches results in a local Map (persists across renders).
 * - Never blocks UI — returns empty result if fetch is pending or failed.
 */

const localCache = new Map<string, BadgeResult>();

const EMPTY: BadgeResult = {
  hasHypio: false,
  hasHypurr: false,
  boostMultiplier: 1.0,
};

/** Safely normalize address — returns null on invalid input. */
function normalize(addr: string): string | null {
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

/** In-flight promise dedup — avoids duplicate fetches for same address */
const inflight = new Map<string, Promise<BadgeResult>>();

async function fetchBadge(address: string): Promise<BadgeResult> {
  const key = normalize(address);
  if (!key) return EMPTY;

  // Already cached locally
  const cached = localCache.get(key);
  if (cached) return cached;

  // Already in-flight — reuse promise
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = fetch(`/api/v1/badges/${key}`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<BadgeResult>;
    })
    .then((result) => {
      localCache.set(key, result);
      inflight.delete(key);
      return result;
    })
    .catch(() => {
      inflight.delete(key);
      return EMPTY;
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * useBadges — fetch badge data for a list of addresses.
 *
 * Returns a Map<checksumAddress, BadgeResult> that updates as fetches complete.
 * Addresses not yet loaded return EMPTY (no badges).
 */
export function useBadges(addresses: string[]): Map<string, BadgeResult> {
  const [badges, setBadges] = useState<Map<string, BadgeResult>>(new Map());
  const prevAddressesRef = useRef<string>("");

  const loadBadges = useCallback(async (addrs: string[]) => {
    // Normalize + dedupe
    const unique = [
      ...new Set(
        addrs.map(normalize).filter((a): a is string => a !== null)
      ),
    ];
    const toFetch = unique.filter((a) => !localCache.has(a));

    // If everything is cached, just return from cache
    if (toFetch.length === 0) {
      const map = new Map<string, BadgeResult>();
      for (const addr of unique) {
        map.set(addr, localCache.get(addr) ?? EMPTY);
      }
      setBadges(map);
      return;
    }

    // Start fetches for uncached (limit concurrency to 5)
    const batches: string[][] = [];
    for (let i = 0; i < toFetch.length; i += 5) {
      batches.push(toFetch.slice(i, i + 5));
    }

    for (const batch of batches) {
      await Promise.all(batch.map(fetchBadge));
    }

    // Build final map
    const map = new Map<string, BadgeResult>();
    for (const addr of unique) {
      map.set(addr, localCache.get(addr) ?? EMPTY);
    }
    setBadges(map);
  }, []);

  useEffect(() => {
    const normalized = addresses
      .map(normalize)
      .filter((a): a is string => a !== null)
      .sort();
    const key = normalized.join(",");

    if (key === prevAddressesRef.current) return;
    prevAddressesRef.current = key;

    if (normalized.length === 0) {
      setBadges(new Map());
      return;
    }

    loadBadges(addresses);
  }, [addresses, loadBadges]);

  return badges;
}

/**
 * useBadge — fetch badge for a single address. Convenience wrapper.
 */
export function useBadge(address: string | undefined): BadgeResult {
  const [badge, setBadge] = useState<BadgeResult>(EMPTY);

  useEffect(() => {
    if (!address) return;

    let cancelled = false;
    fetchBadge(address).then((result) => {
      if (!cancelled) setBadge(result);
    });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return badge;
}
