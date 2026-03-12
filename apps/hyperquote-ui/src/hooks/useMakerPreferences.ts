"use client";

import { useState, useCallback, useEffect } from "react";

/**
 * Maker dashboard preferences, persisted to localStorage.
 */
export interface MakerPreferences {
  /** Minimum RFQ size (USD) to display. null = no minimum. */
  minSizeUsd: number | null;
  /** Token symbols to highlight / watch. */
  tokenWatchlist: string[];
  /** Whether to show the private RFQ import area. */
  allowPrivate: boolean;
  /** Placeholder for future webhook URL. */
  notificationWebhook: string;
}

const STORAGE_KEY = "hq:maker-prefs";

const DEFAULTS: MakerPreferences = {
  minSizeUsd: null,
  tokenWatchlist: [],
  allowPrivate: true,
  notificationWebhook: "",
};

/**
 * Hook for maker dashboard preferences, backed by localStorage.
 *
 * @returns `{ prefs, updatePrefs, resetPrefs, loaded }`
 */
export function useMakerPreferences() {
  const [prefs, setPrefs] = useState<MakerPreferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setPrefs({ ...DEFAULTS, ...parsed });
      }
    } catch {
      // Ignore parse errors — use defaults
    }
    setLoaded(true);
  }, []);

  // Persist on change
  const updatePrefs = useCallback(
    (partial: Partial<MakerPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...partial };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Storage full or unavailable
        }
        return next;
      });
    },
    []
  );

  const resetPrefs = useCallback(() => {
    setPrefs(DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  return { prefs, updatePrefs, resetPrefs, loaded };
}
