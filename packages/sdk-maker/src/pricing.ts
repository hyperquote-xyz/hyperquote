import { RFQ } from "./types.js";

// ---------------------------------------------------------------
// Pricing Engine Interface + Stub Implementation
// ---------------------------------------------------------------

/**
 * Market data snapshot used for pricing.
 */
export interface MarketData {
  /** Current spot price of the underlying (1e18 = $1) */
  spotPrice: bigint;
  /** Implied volatility (annualized, as a decimal fraction * 1e4, e.g., 8000 = 80%) */
  ivBps: number;
  /** Risk-free rate (annualized, bps, e.g., 500 = 5%) */
  riskFreeRateBps: number;
}

/**
 * Pricing result for a single RFQ.
 */
export interface PricingResult {
  /** Premium in collateral base units (10^cDec) */
  premium: bigint;
  /** Estimated delta (BSM delta as a fraction, e.g., 0.45) */
  delta: number;
  /** Theoretical fair value in collateral base units */
  fairValue: bigint;
  /** Implied vol used for the quote */
  ivUsed: number;
}

/**
 * Interface for pluggable pricing engines.
 */
export interface PricingEngine {
  price(rfq: RFQ, market: MarketData, cDec: number): PricingResult;
}

// ---------------------------------------------------------------
// Stub pricing engine: simple Black-Scholes approximation
// ---------------------------------------------------------------

/**
 * Simple vol surface parameters for the stub.
 */
export interface VolSurfaceParams {
  /** Base ATM implied vol (bps, e.g., 8000 = 80%) */
  atmVolBps: number;
  /** Skew per 1% OTM (bps, e.g., 50 = 0.5% vol per 1% moneyness) */
  skewBpsPerPctOtm: number;
  /** Spread to add to fair value (bps of notional, e.g., 100 = 1%) */
  spreadBps: number;
}

const DEFAULT_VOL_SURFACE: VolSurfaceParams = {
  atmVolBps: 8000, // 80% IV
  skewBpsPerPctOtm: 50, // 0.5% per 1% OTM
  spreadBps: 200, // 2% spread over fair
};

/**
 * Cumulative normal distribution approximation (Abramowitz & Stegun).
 */
function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Black-Scholes option price.
 */
function blackScholes(
  spot: number,
  strike: number,
  timeToExpiry: number,
  vol: number,
  riskFreeRate: number,
  isCall: boolean,
): { price: number; delta: number } {
  if (timeToExpiry <= 0 || vol <= 0) {
    // Expired or zero vol: intrinsic value
    const intrinsic = isCall
      ? Math.max(spot - strike, 0)
      : Math.max(strike - spot, 0);
    const delta = isCall
      ? (spot > strike ? 1 : 0)
      : (spot < strike ? -1 : 0);
    return { price: intrinsic, delta };
  }

  const sqrtT = Math.sqrt(timeToExpiry);
  const d1 =
    (Math.log(spot / strike) + (riskFreeRate + (vol * vol) / 2) * timeToExpiry) /
    (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;

  const discount = Math.exp(-riskFreeRate * timeToExpiry);

  if (isCall) {
    const price = spot * normCdf(d1) - strike * discount * normCdf(d2);
    return { price, delta: normCdf(d1) };
  } else {
    const price = strike * discount * normCdf(-d2) - spot * normCdf(-d1);
    return { price, delta: normCdf(d1) - 1 };
  }
}

/**
 * Stub pricing engine using simplified Black-Scholes with a vol surface.
 */
export class StubPricingEngine implements PricingEngine {
  constructor(private readonly volSurface: VolSurfaceParams = DEFAULT_VOL_SURFACE) {}

  price(rfq: RFQ, market: MarketData, cDec: number): PricingResult {
    // Convert to floating point for BSM
    const spot = Number(market.spotPrice) / 1e18;
    const strike = Number(rfq.strike) / 1e18;
    const now = Math.floor(Date.now() / 1000);
    const timeToExpiry = (Number(rfq.expiry) - now) / (365.25 * 24 * 3600); // years

    // Compute moneyness for vol surface
    const moneyness = spot > 0 ? (strike - spot) / spot : 0;
    const otmPct = Math.abs(moneyness) * 100;

    // Skew-adjusted vol
    const atmVol = this.volSurface.atmVolBps / 10000;
    const skewAdj = (this.volSurface.skewBpsPerPctOtm * otmPct) / 10000;
    const iv = atmVol + skewAdj;

    const rfRate = market.riskFreeRateBps / 10000;

    // BSM price (in USD terms, per unit of underlying)
    const { price: fairPricePerUnit, delta } = blackScholes(
      spot,
      strike,
      timeToExpiry,
      iv,
      rfRate,
      rfq.isCall,
    );

    // Convert to collateral units:
    // fairValue = fairPricePerUnit * quantity_in_units * 10^cDec
    // quantity is in underlying base units (10^uDec where uDec=18 for WHYPE)
    const qtyUnits = Number(rfq.quantity) / 1e18;
    const fairValueUsd = fairPricePerUnit * qtyUnits;

    // Add spread (maker charges more for puts, less for calls doesn't matter — just add spread)
    const spreadAdj = (this.volSurface.spreadBps / 10000) * (strike * qtyUnits);
    const premiumUsd = fairValueUsd + spreadAdj;

    // Convert to collateral base units
    const collateralMultiplier = 10 ** cDec;
    const fairValueCollateral = BigInt(Math.ceil(fairValueUsd * collateralMultiplier));
    let premiumCollateral = BigInt(Math.ceil(premiumUsd * collateralMultiplier));

    // Floor at 1 unit
    if (premiumCollateral <= 0n) premiumCollateral = 1n;

    return {
      premium: premiumCollateral,
      delta,
      fairValue: fairValueCollateral,
      ivUsed: iv,
    };
  }
}
