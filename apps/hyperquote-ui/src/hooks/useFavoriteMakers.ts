"use client";

import { useState, useCallback, useEffect } from "react";
import { getAddress } from "viem";

const STORAGE_KEY = "hq:favorite-makers";

/**
 * Safely checksum-normalize an Ethereum address.
 * Returns null on invalid input.
 */
function normalize(addr: string): `0x${string}` | null {
  try {
    return getAddress(addr) as `0x${string}`;
  } catch {
    return null;
  }
}

/**
 * Hook for managing a list of favorite maker addresses, persisted to localStorage.
 *
 * Addresses are stored as EIP-55 checksummed strings.
 * Deduplication is enforced on every mutation and on load.
 *
 * @returns `{ favorites, addFavorite, removeFavorite, addMultiple, loaded }`
 */
export function useFavoriteMakers() {
  const [favorites, setFavorites] = useState<`0x${string}`[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: string[] = JSON.parse(raw);
        // Re-normalize and deduplicate on load
        const seen = new Set<string>();
        const clean: `0x${string}`[] = [];
        for (const addr of parsed) {
          const norm = normalize(addr);
          if (norm && !seen.has(norm)) {
            seen.add(norm);
            clean.push(norm);
          }
        }
        setFavorites(clean);
      }
    } catch {
      // Ignore parse errors — start with empty list
    }
    setLoaded(true);
  }, []);

  /** Persist current list to localStorage. */
  const persist = useCallback((list: `0x${string}`[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Storage full or unavailable
    }
  }, []);

  /** Add a single address to favorites. Normalizes + deduplicates. */
  const addFavorite = useCallback(
    (addr: string) => {
      const norm = normalize(addr);
      if (!norm) return;
      setFavorites((prev) => {
        if (prev.includes(norm)) return prev;
        const next = [...prev, norm];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  /** Remove a single address from favorites. */
  const removeFavorite = useCallback(
    (addr: string) => {
      const norm = normalize(addr);
      if (!norm) return;
      setFavorites((prev) => {
        const next = prev.filter((a) => a !== norm);
        if (next.length === prev.length) return prev; // no change
        persist(next);
        return next;
      });
    },
    [persist]
  );

  /** Bulk-add addresses (e.g. "save current recipients to favorites"). */
  const addMultiple = useCallback(
    (addrs: string[]) => {
      setFavorites((prev) => {
        const set = new Set<string>(prev);
        let changed = false;
        for (const addr of addrs) {
          const norm = normalize(addr);
          if (norm && !set.has(norm)) {
            set.add(norm);
            changed = true;
          }
        }
        if (!changed) return prev;
        const next = Array.from(set) as `0x${string}`[];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  return { favorites, addFavorite, removeFavorite, addMultiple, loaded };
}
