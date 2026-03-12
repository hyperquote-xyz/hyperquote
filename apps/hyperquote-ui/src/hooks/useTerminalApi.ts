/**
 * useTerminalApi — React hooks for the HYPE Options Terminal API
 *
 * Fetches from terminal-api (default http://localhost:4200):
 *   GET /options/tape
 *   GET /options/ladder
 *   GET /options/venues
 *
 * Uses polling with configurable intervals.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  TapeResponse,
  LadderResponse,
  VenueResponse,
  StrikeDetail,
  LiquidityFilter,
  VenueFilter,
} from "@/types/terminal";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_TERMINAL_API_URL || "http://localhost:4200";

// ---------------------------------------------------------------------------
// Generic fetcher
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Terminal API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// useTape — unified trade tape
// ---------------------------------------------------------------------------

export function useTape(opts: {
  underlying?: string;
  limit?: number;
  liquidityGuess?: LiquidityFilter;
  venue?: VenueFilter;
  pollMs?: number;
}) {
  const {
    underlying = "ETH",
    limit = 50,
    liquidityGuess = "all",
    venue = "all",
    pollMs = 5000,
  } = opts;

  const [data, setData] = useState<TapeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchTape = useCallback(async () => {
    try {
      const result = await apiFetch<TapeResponse>("/options/tape", {
        underlying,
        limit: String(limit),
        liquidityGuess,
        venue,
      });
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [underlying, limit, liquidityGuess, venue]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    void fetchTape();
    const timer = setInterval(() => void fetchTape(), pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchTape, pollMs]);

  return { data, loading, error, refetch: fetchTape };
}

// ---------------------------------------------------------------------------
// useLadder — strike ladder for a single expiry
// ---------------------------------------------------------------------------

export function useLadder(opts: {
  underlying?: string;
  expiry?: string; // YYYYMMDD
  pollMs?: number;
}) {
  const { underlying = "ETH", expiry, pollMs = 5000 } = opts;

  const [data, setData] = useState<LadderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchLadder = useCallback(async () => {
    if (!expiry) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const result = await apiFetch<LadderResponse>("/options/ladder", {
        underlying,
        expiry,
      });
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [underlying, expiry]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    void fetchLadder();
    const timer = setInterval(() => void fetchLadder(), pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchLadder, pollMs]);

  return { data, loading, error, refetch: fetchLadder };
}

// ---------------------------------------------------------------------------
// useVenues — venue/expiry overview
// ---------------------------------------------------------------------------

export function useVenues(opts: {
  underlying?: string;
  pollMs?: number;
}) {
  const { underlying = "ETH", pollMs = 10000 } = opts;

  const [data, setData] = useState<VenueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchVenues = useCallback(async () => {
    try {
      const result = await apiFetch<VenueResponse>("/options/venues", {
        underlying,
      });
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [underlying]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    void fetchVenues();
    const timer = setInterval(() => void fetchVenues(), pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchVenues, pollMs]);

  return { data, loading, error, refetch: fetchVenues };
}

// ---------------------------------------------------------------------------
// useStrikeDetail — pricing detail for a single strike
// ---------------------------------------------------------------------------

export function useStrikeDetail(opts: {
  underlying?: string;
  expiry?: string; // YYYYMMDD
  strike?: number;
  isCall?: boolean;
}) {
  const { underlying, expiry, strike, isCall } = opts;

  const [data, setData] = useState<StrikeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchDetail = useCallback(async () => {
    if (!underlying || !expiry || strike == null || isCall == null) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await apiFetch<StrikeDetail>("/options/strike-detail", {
        underlying,
        expiry,
        strike: String(strike),
        isCall: String(isCall),
      });
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [underlying, expiry, strike, isCall]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchDetail();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchDetail]);

  return { data, loading, error, refetch: fetchDetail };
}
