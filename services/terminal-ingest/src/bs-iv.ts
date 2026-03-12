/**
 * Black-Scholes Implied Volatility Solver
 *
 * Solves for σ given:
 *   spot (S), strike (K), time-to-expiry (T in years),
 *   option price (C or P), isCall flag, risk-free rate (r)
 *
 * Uses Brenner-Subrahmanyam seed + Newton-Raphson iteration.
 *
 * Reference:
 *   C = S·N(d1) − K·e^(−rT)·N(d2)     (call)
 *   P = K·e^(−rT)·N(−d2) − S·N(−d1)    (put)
 *
 *   d1 = [ln(S/K) + (r + σ²/2)T] / (σ√T)
 *   d2 = d1 − σ√T
 */

// ---------------------------------------------------------------------------
// Standard normal CDF (Abramowitz & Stegun approximation 26.2.17)
// ---------------------------------------------------------------------------

function normCdf(x: number): number {
  if (x > 10) return 1;
  if (x < -10) return 0;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

// ---------------------------------------------------------------------------
// Standard normal PDF
// ---------------------------------------------------------------------------

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ---------------------------------------------------------------------------
// Black-Scholes price
// ---------------------------------------------------------------------------

function bsPrice(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  isCall: boolean,
): number {
  if (T <= 0 || sigma <= 0) return Math.max(0, isCall ? S - K : K - S);

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discountK = K * Math.exp(-r * T);

  if (isCall) {
    return S * normCdf(d1) - discountK * normCdf(d2);
  }
  return discountK * normCdf(-d2) - S * normCdf(-d1);
}

// ---------------------------------------------------------------------------
// Vega (∂C/∂σ) — same for call and put
// ---------------------------------------------------------------------------

function bsVega(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
): number {
  if (T <= 0 || sigma <= 0) return 0;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return S * normPdf(d1) * sqrtT;
}

// ---------------------------------------------------------------------------
// Implied Volatility — Newton-Raphson solver
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 100;
const PRECISION = 1e-8;
const MIN_VOL = 0.001;   // 0.1%
const MAX_VOL = 20.0;    // 2000%

/**
 * Solve for implied volatility given an observed option price.
 *
 * @param spot       - underlying price (S)
 * @param strike     - option strike price (K)
 * @param T          - time to expiry in years (>0)
 * @param optionPrice - observed market price of the option (per unit of underlying)
 * @param isCall     - true for call, false for put
 * @param r          - risk-free rate (annualized, default 0.05)
 * @returns implied volatility (annualized), or null if solver fails
 */
export function solveIV(
  spot: number,
  strike: number,
  T: number,
  optionPrice: number,
  isCall: boolean,
  r: number = 0.05,
): number | null {
  // Sanity guards
  if (spot <= 0 || strike <= 0 || T <= 0 || optionPrice <= 0) return null;

  // Intrinsic value check — option price below intrinsic means no IV
  const intrinsic = Math.max(0, isCall ? spot - strike * Math.exp(-r * T) : strike * Math.exp(-r * T) - spot);
  if (optionPrice < intrinsic - 1e-10) return null;

  // Brenner-Subrahmanyam initial guess: σ ≈ √(2π/T) * (C/S)
  let sigma = Math.sqrt(2 * Math.PI / T) * (optionPrice / spot);
  sigma = Math.max(MIN_VOL, Math.min(MAX_VOL, sigma));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const price = bsPrice(spot, strike, T, sigma, r, isCall);
    const diff = price - optionPrice;

    if (Math.abs(diff) < PRECISION) {
      return sigma;
    }

    const vega = bsVega(spot, strike, T, sigma, r);
    if (Math.abs(vega) < 1e-14) {
      // Vega too small — try bisection fallback
      break;
    }

    const newSigma = sigma - diff / vega;

    // Clamp to valid range
    if (newSigma <= MIN_VOL) sigma = sigma / 2;
    else if (newSigma >= MAX_VOL) sigma = (sigma + MAX_VOL) / 2;
    else sigma = newSigma;
  }

  // Bisection fallback if Newton failed
  let lo = MIN_VOL;
  let hi = MAX_VOL;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice(spot, strike, T, mid, r, isCall);
    const diff = price - optionPrice;

    if (Math.abs(diff) < PRECISION) {
      return mid;
    }

    if (diff > 0) {
      hi = mid;
    } else {
      lo = mid;
    }

    if (hi - lo < PRECISION) {
      return mid;
    }
  }

  return null; // solver failed
}
