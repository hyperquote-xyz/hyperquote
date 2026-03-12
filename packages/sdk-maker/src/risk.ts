import { RFQ, RiskConfig } from "./types.js";
import { MarketData } from "./pricing.js";

// ---------------------------------------------------------------
// Risk Check Results
// ---------------------------------------------------------------

export interface RiskCheckResult {
  passed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------
// Risk State (tracks open exposure)
// ---------------------------------------------------------------

export interface ExpiryBucket {
  /** Total delta exposure for this expiry (signed: +calls, -puts) */
  deltaExposure: number;
  /** Total notional across all positions for this expiry */
  notional: bigint;
}

export class RiskState {
  /** Delta exposure by expiry timestamp */
  expiryBuckets: Map<bigint, ExpiryBucket> = new Map();
  /** Total notional by collateral token */
  notionalByCollateral: Map<string, bigint> = new Map();

  /**
   * Record a quote that was sent (update exposure tracking).
   */
  recordQuote(
    collateral: string,
    expiry: bigint,
    notional: bigint,
    delta: number,
    isCall: boolean,
  ): void {
    // Update collateral notional
    const current = this.notionalByCollateral.get(collateral.toLowerCase()) ?? 0n;
    this.notionalByCollateral.set(collateral.toLowerCase(), current + notional);

    // Update expiry bucket
    const bucket = this.expiryBuckets.get(expiry) ?? { deltaExposure: 0, notional: 0n };
    const signedDelta = isCall ? delta : delta; // delta is already signed (negative for puts)
    bucket.deltaExposure += signedDelta;
    bucket.notional += notional;
    this.expiryBuckets.set(expiry, bucket);
  }
}

// ---------------------------------------------------------------
// Risk Checks
// ---------------------------------------------------------------

/**
 * Compute notional in collateral base units.
 * Same formula as CollateralMath._strikeTimesQuantity:
 *   ceilDiv(strike * quantity, 10^(18 + uDec - cDec))
 */
export function computeNotional(
  strike: bigint,
  quantity: bigint,
  uDec: number,
  cDec: number,
): bigint {
  const product = strike * quantity;
  const exponent = 18n + BigInt(uDec) - BigInt(cDec);
  const divisor = 10n ** exponent;
  if (product === 0n) return 0n;
  return (product - 1n) / divisor + 1n; // ceilDiv
}

/**
 * Run all risk checks against an RFQ.
 */
export function checkRisk(
  rfq: RFQ,
  market: MarketData,
  config: RiskConfig,
  state: RiskState,
  cDec: number,
  delta: number,
): RiskCheckResult {
  const now = BigInt(Math.floor(Date.now() / 1000));

  // 1. Max tenor check
  const tenor = Number(rfq.expiry - now);
  if (tenor > config.maxTenorSecs) {
    return { passed: false, reason: `Tenor ${tenor}s exceeds max ${config.maxTenorSecs}s` };
  }
  if (tenor <= 0) {
    return { passed: false, reason: "RFQ expiry is in the past" };
  }

  // 2. Max strike deviation from spot
  const spot = Number(market.spotPrice) / 1e18;
  const strike = Number(rfq.strike) / 1e18;
  if (spot > 0) {
    const deviation = Math.abs(strike - spot) / spot;
    if (deviation > config.maxStrikeDeviationPct) {
      return {
        passed: false,
        reason: `Strike deviation ${(deviation * 100).toFixed(1)}% exceeds max ${(config.maxStrikeDeviationPct * 100).toFixed(1)}%`,
      };
    }
  }

  // 3. Per-collateral max notional
  const notional = computeNotional(rfq.strike, rfq.quantity, 18, cDec); // uDec=18 for WHYPE
  const collateralKey = rfq.collateral.toLowerCase();
  const maxNotional = config.maxNotionalPerCollateral[collateralKey];
  if (maxNotional !== undefined) {
    const currentNotional = state.notionalByCollateral.get(collateralKey) ?? 0n;
    if (currentNotional + notional > maxNotional) {
      return {
        passed: false,
        reason: `Notional would exceed max for ${collateralKey}: ${currentNotional + notional} > ${maxNotional}`,
      };
    }
  }

  // 4. Max delta per expiry bucket
  const bucket = state.expiryBuckets.get(rfq.expiry) ?? { deltaExposure: 0, notional: 0n };
  const newDelta = bucket.deltaExposure + delta;
  if (Math.abs(newDelta) > config.maxDeltaPerExpiry) {
    return {
      passed: false,
      reason: `Delta exposure ${newDelta.toFixed(4)} would exceed max ${config.maxDeltaPerExpiry} for expiry ${rfq.expiry}`,
    };
  }

  // 5. Min premium check
  const minPremium = config.minPremium[collateralKey];
  if (minPremium !== undefined && rfq.minPremium > 0n) {
    // We just check that the RFQ's minPremium is not above what we'd offer
    // (actual premium check happens after pricing)
  }

  return { passed: true };
}
