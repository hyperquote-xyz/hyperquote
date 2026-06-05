"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RFQQuoteJSON } from "@/types";

// ── Public interface ────────────────────────────────────────────

export interface UseQuotePollingOptions {
  rfqId: string | null;
  enabled: boolean;
  intervalMs?: number;
  onNewQuote?: (quote: RFQQuoteJSON) => void;
}

export interface UseQuotePollingResult {
  quotes: RFQQuoteJSON[];
  loading: boolean;
  error: string | null;
  lastPollAt: number | null;
}

// Terminal RFQ statuses — stop polling when the RFQ reaches one of these.
const TERMINAL_STATUSES = new Set(["FILLED", "EXPIRED", "KILLED", "CANCELLED"]);

// ── Hook ────────────────────────────────────────────────────────

export function useQuotePolling(
  options: UseQuotePollingOptions
): UseQuotePollingResult {
  const { rfqId, enabled, intervalMs = 3000, onNewQuote } = options;

  const [quotes, setQuotes] = useState<RFQQuoteJSON[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);

  // Track seen signatures across renders without triggering re-renders.
  const seenSigsRef = useRef<Set<string>>(new Set());

  // Keep a stable ref to the latest onNewQuote so the interval closure
  // always calls the current callback without re-creating the effect.
  const onNewQuoteRef = useRef(onNewQuote);
  useEffect(() => {
    onNewQuoteRef.current = onNewQuote;
  }, [onNewQuote]);

  // Reset state when rfqId changes.
  useEffect(() => {
    setQuotes([]);
    setError(null);
    setLastPollAt(null);
    seenSigsRef.current = new Set();
  }, [rfqId]);

  const poll = useCallback(async () => {
    if (!rfqId) return false; // nothing to poll

    setLoading(true);
    try {
      const res = await fetch(`/api/v1/rfqs/${encodeURIComponent(rfqId)}`);
      if (!res.ok) {
        throw new Error(`Poll failed: ${res.status} ${res.statusText}`);
      }

      const data: {
        rfq: unknown;
        quotes: RFQQuoteJSON[];
        status?: string;
      } = await res.json();

      // Merge incoming quotes, detect new arrivals.
      const incoming = data.quotes ?? [];
      const newQuotes: RFQQuoteJSON[] = [];

      for (const q of incoming) {
        if (!seenSigsRef.current.has(q.signature)) {
          seenSigsRef.current.add(q.signature);
          newQuotes.push(q);
        }
      }

      if (newQuotes.length > 0) {
        setQuotes((prev) => [...prev, ...newQuotes]);
        for (const q of newQuotes) {
          onNewQuoteRef.current?.(q);
        }
      }

      setError(null);
      setLastPollAt(Date.now());

      // Signal whether the RFQ has reached a terminal status.
      const status = data.status ?? "";
      if (TERMINAL_STATUSES.has(status)) {
        return true; // stop polling
      }

      return false; // keep polling
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown polling error";
      console.error("[useQuotePolling]", message);
      setError(message);
      return false; // keep polling despite error
    } finally {
      setLoading(false);
    }
  }, [rfqId]);

  useEffect(() => {
    if (!enabled || !rfqId) return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    // Fire an immediate poll, then start the interval.
    const start = async () => {
      const shouldStop = await poll();
      if (shouldStop || stopped) return;

      timer = setInterval(async () => {
        const shouldStop = await poll();
        if (shouldStop) {
          if (timer) clearInterval(timer);
          timer = null;
        }
      }, intervalMs);
    };

    start();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, rfqId, intervalMs, poll]);

  return { quotes, loading, error, lastPollAt };
}
