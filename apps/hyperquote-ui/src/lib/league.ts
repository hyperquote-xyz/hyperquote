/**
 * League Score Math — separate from per-fill points.
 *
 * League scores rank participants by *executed notional* weighted by
 * execution quality, reliability, and privacy.
 *
 * Maker:
 *   score = filledNotionalUsd × (1 + avgImprovementBps/100) × reliabilityFactor × privacyFactor
 *   reliabilityFactor = clamp(1.1 − cancelRate × 1.5, 0.5, 1.1)
 *
 * Taker:
 *   score = filledNotionalUsd × (1 + avgImprovementBps/120) × privacyFactor
 *
 * privacyFactor = 1 + min(privateShare, 0.5) × 0.1
 *
 * repeatDecay is applied per maker↔taker pair before aggregating.
 */

import { computeRepeatDecay } from "@/lib/points";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeagueInput {
  /** Total filled notional after repeat-decay adjustment (USD). */
  filledNotionalUsd: number;
  /** Average improvement over benchmark in bps (0 if no benchmark). */
  avgImprovementBps: number;
  /** Fraction of fills that were private (0-1). */
  privateShare: number;
  /** For makers only: cancel rate 0-1. Default 0 for takers. */
  cancelRate?: number;
}

export interface LeagueScoreResult {
  score: number;
  factors: {
    improvement: number;
    reliability: number;
    privacy: number;
  };
}

// ---------------------------------------------------------------------------
// Factor functions
// ---------------------------------------------------------------------------

/**
 * Maker reliability factor based on cancel/kill rate.
 *   reliabilityFactor = clamp(1.1 − cancelRate × 1.5, 0.5, 1.1)
 */
export function reliabilityFactor(cancelRate: number): number {
  const raw = 1.1 - cancelRate * 1.5;
  return Math.max(0.5, Math.min(1.1, raw));
}

/**
 * Privacy factor for league scoring.
 *   privacyFactor = 1 + min(privateShare, 0.5) × 0.1
 *   Range: [1.0, 1.05]
 */
export function privacyFactor(privateShare: number): number {
  return 1 + Math.min(privateShare, 0.5) * 0.1;
}

// ---------------------------------------------------------------------------
// Composite league scores
// ---------------------------------------------------------------------------

export function makerLeagueScore(input: LeagueInput): LeagueScoreResult {
  const improvM = 1 + (input.avgImprovementBps ?? 0) / 100;
  const reliabM = reliabilityFactor(input.cancelRate ?? 0);
  const privM = privacyFactor(input.privateShare);

  const score = input.filledNotionalUsd * improvM * reliabM * privM;

  return {
    score: Math.round(score * 100) / 100,
    factors: {
      improvement: Math.round(improvM * 1000) / 1000,
      reliability: Math.round(reliabM * 1000) / 1000,
      privacy: Math.round(privM * 1000) / 1000,
    },
  };
}

export function takerLeagueScore(input: LeagueInput): LeagueScoreResult {
  const improvM = 1 + (input.avgImprovementBps ?? 0) / 120;
  const privM = privacyFactor(input.privateShare);

  const score = input.filledNotionalUsd * improvM * privM;

  return {
    score: Math.round(score * 100) / 100,
    factors: {
      improvement: Math.round(improvM * 1000) / 1000,
      reliability: 1.0,
      privacy: Math.round(privM * 1000) / 1000,
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate helper — apply repeat-decay per pair, compute weighted avg
// ---------------------------------------------------------------------------

export interface FillRow {
  maker: string;
  taker: string;
  notionalUsd: number;
  improvementBps: number;
  isPrivate: boolean;
  benchmarkAvailable: boolean;
}

/**
 * Aggregate raw FeedFill rows into per-address league inputs.
 *
 * @param rows  - FeedFill rows for a given period (already filtered by date / minUsd)
 * @param role  - "maker" | "taker" — the column we group by
 * @returns Map from address → aggregated LeagueInput
 */
export function aggregateForLeague(
  rows: FillRow[],
  role: "maker" | "taker"
): Map<string, LeagueInput & { fills: number; rawNotional: number }> {
  const addrField = role; // "maker" or "taker"
  const pairField = role === "maker" ? "taker" : "maker";

  // Step 1: Group rows by address
  const byAddress = new Map<string, FillRow[]>();
  for (const row of rows) {
    const addr = row[addrField];
    let list = byAddress.get(addr);
    if (!list) {
      list = [];
      byAddress.set(addr, list);
    }
    list.push(row);
  }

  // Step 2: For each address, count pair-repeats and apply decay
  const result = new Map<string, LeagueInput & { fills: number; rawNotional: number }>();

  for (const [addr, fills] of byAddress) {
    // Count fills per pair
    const pairCounts = new Map<string, number>();
    for (const f of fills) {
      const pair = f[pairField];
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }

    // Track running index per pair for progressive decay
    const pairIndex = new Map<string, number>();

    let decayedNotional = 0;
    let improvSum = 0;
    let improvCount = 0;
    let privateFills = 0;

    for (const f of fills) {
      const pair = f[pairField];
      const totalForPair = pairCounts.get(pair) ?? 0;
      const idx = pairIndex.get(pair) ?? 0;
      pairIndex.set(pair, idx + 1);

      // Apply pair-repeat decay using total count for this pair
      const decay = computeRepeatDecay(totalForPair);
      decayedNotional += f.notionalUsd * decay;

      if (f.benchmarkAvailable) {
        improvSum += f.improvementBps;
        improvCount += 1;
      }
      if (f.isPrivate) privateFills += 1;
    }

    const rawNotional = fills.reduce((sum, f) => sum + f.notionalUsd, 0);
    const avgImprov = improvCount > 0 ? Math.round(improvSum / improvCount) : 0;
    const privateShare = fills.length > 0 ? privateFills / fills.length : 0;

    result.set(addr, {
      filledNotionalUsd: decayedNotional,
      avgImprovementBps: avgImprov,
      privateShare,
      fills: fills.length,
      rawNotional,
    });
  }

  return result;
}
