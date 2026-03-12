"use client";

/**
 * useCoverage — Protocol Coverage Awareness Hook
 *
 * Fetches GET /api/v1/sor/coverage on mount (once) and exposes:
 *   - Coverage data per protocol
 *   - Warnings about protocols that are MANUAL_REQUIRED or have zero pools
 *   - Summary stats
 *
 * Caches for 60s to avoid redundant fetches.
 */

import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageProtocol {
  slug: string;
  name: string;
  status: string;
  hasConnector: boolean;
  discoveryMethod: string | null;
  poolsDiscoveredCount: number;
  poolsWithStateCount: number;
  lastScanBlock: number | null;
  supportedPoolTypes: string[];
}

export interface CoverageSummary {
  totalProtocols: number;
  activeProtocols: number;
  withConnector: number;
  withoutConnector: number;
  totalPools: number;
  totalPoolsWithState: number;
}

export interface CoverageData {
  protocols: CoverageProtocol[];
  summary: CoverageSummary;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000; // 60s

let globalCache: { data: CoverageData; at: number } | null = null;

export function useCoverage() {
  const [data, setData] = useState<CoverageData | null>(globalCache?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    // Check global cache
    if (globalCache && Date.now() - globalCache.at < CACHE_TTL_MS) {
      setData(globalCache.data);
      return;
    }

    if (fetchedRef.current) return;
    fetchedRef.current = true;

    setLoading(true);
    fetch("/api/v1/sor/coverage")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result: CoverageData) => {
        globalCache = { data: result, at: Date.now() };
        setData(result);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to fetch coverage");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Derive warnings
  const warnings: string[] = [];
  if (data) {
    const manualRequired = data.protocols.filter(
      (p) => p.status === "ACTIVE" && p.discoveryMethod === "MANUAL_REQUIRED"
    );
    const noPools = data.protocols.filter(
      (p) => p.status === "ACTIVE" && p.hasConnector && p.poolsDiscoveredCount === 0
    );
    const noState = data.protocols.filter(
      (p) => p.status === "ACTIVE" && p.poolsDiscoveredCount > 0 && p.poolsWithStateCount === 0
    );

    if (manualRequired.length > 0) {
      warnings.push(
        `${manualRequired.map((p) => p.name).join(", ")}: requires manual connector (not included in baseline)`
      );
    }
    if (noPools.length > 0) {
      warnings.push(
        `${noPools.map((p) => p.name).join(", ")}: no pools discovered yet`
      );
    }
    if (noState.length > 0) {
      warnings.push(
        `${noState.map((p) => p.name).join(", ")}: pools found but no state data`
      );
    }
  }

  return { data, loading, error, warnings };
}
