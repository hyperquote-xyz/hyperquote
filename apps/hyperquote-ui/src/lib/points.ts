/**
 * Points Engine v2 — Hardened computation with anti-gaming guards.
 *
 * Points only accrue on FILLED RFQs. Sublinear size scaling prevents
 * wash-trading incentives. Continuous improvement multiplier replaces
 * discrete buckets. Pair-repeat decay penalises suspicious patterns.
 *
 * NFT boost is applied by the caller (league aggregation) — this module
 * does NOT fetch badge data.
 */

export const POINTS_VERSION = "v2";

// ---------------------------------------------------------------------------
// Exported constants (tunable)
// ---------------------------------------------------------------------------

/** Privacy bonus only kicks in above this notional. */
export const PRIVACY_BONUS_MIN_NOTIONAL_USD = 50_000;

/** Multiplier when benchmark/baseline is unavailable. */
export const MISSING_BENCHMARK_PENALTY = 0.9;

/** Self-trade guard: taker === maker → zero points. */
export const SELF_TRADE_MULTIPLIER = 0.0;

/** Global multiplier floor/cap applied to the product of all multipliers. */
export const GLOBAL_MULTIPLIER_FLOOR = 0.5;
export const GLOBAL_MULTIPLIER_CAP = 3.0;

/** Privacy multiplier (points context). */
export const PRIVACY_MULTIPLIER_POINTS = 1.10;

/** Privacy multiplier (league score context — smaller). */
export const PRIVACY_MULTIPLIER_LEAGUE = 1.05;

/** Sublinear exponent for size scaling: pts ∝ (notionalUsd/1000)^0.9 */
export const SIZE_EXPONENT = 0.90;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PointsInput {
  role: "maker" | "taker";
  notionalUsd: number;
  improvementBps: number;
  benchmarkAvailable: boolean;
  isPrivate: boolean;
  maker: string;
  taker: string;
  /** Pair-repeat count in period (same maker↔taker). Default 0. */
  repeatCount?: number;
  /** NFT boost multiplier (from computeBoost). Applied externally. Default 1.0. */
  boostMultiplier?: number;
}

export interface PointsResult {
  points: number;
  base: number;
  multipliers: {
    improvement: number;
    privacy: number;
    repeatDecay: number;
    boost: number;
    /** Clamped product of improvement × privacy × repeatDecay (before boost). */
    combined: number;
  };
  version: string;
}

// ---------------------------------------------------------------------------
// Base points — sublinear in notional
// ---------------------------------------------------------------------------

/**
 * Sublinear base points: pow(notionalUsd / 1000, SIZE_EXPONENT).
 * $1k → 1.0, $10k → 7.94, $100k → 63.1, $1M → 501.
 */
export function basePoints(notionalUsd: number): number {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return 0;
  return Math.pow(notionalUsd / 1000, SIZE_EXPONENT);
}

// ---------------------------------------------------------------------------
// Improvement multiplier — continuous, capped
// ---------------------------------------------------------------------------

/**
 * Maps improvement in bps to a multiplier.
 *   - If benchmark unavailable → MISSING_BENCHMARK_PENALTY (0.9)
 *   - Otherwise: 1 + clamp(bps, -20, +50) / 100
 *     → range [0.8, 1.5], then clamped to [0.8, 1.6]
 */
export function improvementMultiplier(
  improvementBps: number,
  benchmarkAvailable: boolean
): number {
  if (!benchmarkAvailable) return MISSING_BENCHMARK_PENALTY;
  const clamped = Math.max(-20, Math.min(50, improvementBps));
  const m = 1 + clamped / 100;
  return Math.max(0.8, Math.min(1.6, m));
}

// ---------------------------------------------------------------------------
// Privacy multiplier
// ---------------------------------------------------------------------------

/**
 * Privacy bonus for points context.
 * Only applies when isPrivate AND notionalUsd >= PRIVACY_BONUS_MIN_NOTIONAL_USD.
 */
export function privacyMultiplier(
  isPrivate: boolean,
  notionalUsd: number
): number {
  if (isPrivate && notionalUsd >= PRIVACY_BONUS_MIN_NOTIONAL_USD) {
    return PRIVACY_MULTIPLIER_POINTS;
  }
  return 1.0;
}

/**
 * Privacy multiplier for league score context (smaller bonus).
 */
export function privacyMultiplierLeague(
  isPrivate: boolean,
  notionalUsd: number
): number {
  if (isPrivate && notionalUsd >= PRIVACY_BONUS_MIN_NOTIONAL_USD) {
    return PRIVACY_MULTIPLIER_LEAGUE;
  }
  return 1.0;
}

// ---------------------------------------------------------------------------
// Pair-repeat decay (anti-wash)
// ---------------------------------------------------------------------------

/**
 * Decay factor for repeated trades between the same maker↔taker pair
 * within a time period.
 *   < 10 trades  → 1.0 (no penalty)
 *   10–19 trades → 0.5
 *   ≥ 20 trades  → 0.25
 */
export function computeRepeatDecay(repeatCount: number): number {
  if (repeatCount >= 20) return 0.25;
  if (repeatCount >= 10) return 0.5;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Global multiplier clamp
// ---------------------------------------------------------------------------

function clampMultiplier(product: number): number {
  return Math.min(Math.max(product, GLOBAL_MULTIPLIER_FLOOR), GLOBAL_MULTIPLIER_CAP);
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Compute points for a single fill event.
 *
 * Points = basePoints(notional) × clamp(improvement × privacy × repeatDecay) × boostMultiplier
 *
 * Self-trade (maker === taker) → 0 points.
 */
export function computePoints(input: PointsInput): PointsResult {
  const {
    notionalUsd,
    improvementBps,
    benchmarkAvailable,
    isPrivate,
    maker,
    taker,
    repeatCount = 0,
    boostMultiplier = 1.0,
  } = input;

  // Self-trade guard
  if (maker.toLowerCase() === taker.toLowerCase()) {
    return {
      points: 0,
      base: 0,
      multipliers: {
        improvement: 0,
        privacy: 0,
        repeatDecay: 0,
        boost: 0,
        combined: 0,
      },
      version: POINTS_VERSION,
    };
  }

  // Invalid notional guard
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return {
      points: 0,
      base: 0,
      multipliers: {
        improvement: 0,
        privacy: 0,
        repeatDecay: 0,
        boost: 0,
        combined: 0,
      },
      version: POINTS_VERSION,
    };
  }

  const base = basePoints(notionalUsd);
  const improvM = improvementMultiplier(improvementBps, benchmarkAvailable);
  const privM = privacyMultiplier(isPrivate, notionalUsd);
  const decayM = computeRepeatDecay(repeatCount);

  // Clamp the product of multipliers (before NFT boost)
  const combined = clampMultiplier(improvM * privM * decayM);

  const rawPoints = base * combined * boostMultiplier;
  const points = Math.round(rawPoints * 100) / 100;

  return {
    points,
    base: Math.round(base * 100) / 100,
    multipliers: {
      improvement: improvM,
      privacy: privM,
      repeatDecay: decayM,
      boost: boostMultiplier,
      combined,
    },
    version: POINTS_VERSION,
  };
}
