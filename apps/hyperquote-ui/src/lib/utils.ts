import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Token, QuoteKind, RFQQuote, QuoteWithMeta } from "@/types";

/**
 * Merge Tailwind classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Token display helpers ────────────────────────────────────────────

/** Strip control characters (U+0000–U+001F, U+007F) and trim whitespace. */
export function stripControls(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

/** Safe token symbol: always returns a non-empty string. */
export function safeSymbol(
  token: Pick<Token, "symbol"> | null | undefined
): string {
  const raw = stripControls(token?.symbol ?? "");
  return raw.length > 0 ? raw : "UNKNOWN";
}

/** Safe token name: falls back to symbol, then "Unknown". */
export function safeName(
  token: Pick<Token, "name" | "symbol"> | null | undefined
): string {
  const raw = stripControls(token?.name ?? "");
  if (raw.length > 0) return raw;
  const sym = stripControls(token?.symbol ?? "");
  return sym.length > 0 ? sym : "Unknown";
}

/**
 * Format a bigint amount with decimals for display
 */
export function formatAmount(
  amount: bigint,
  decimals: number,
  maxDecimals: number = 6
): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;

  if (remainder === 0n) {
    return whole.toLocaleString();
  }

  // Pad remainder with leading zeros
  const remainderStr = remainder.toString().padStart(decimals, "0");
  // Trim trailing zeros and limit decimal places
  const trimmed = remainderStr.slice(0, maxDecimals).replace(/0+$/, "");

  if (trimmed === "") {
    return whole.toLocaleString();
  }

  return `${whole.toLocaleString()}.${trimmed}`;
}

/**
 * Parse a decimal string to bigint with the given decimals
 */
export function parseAmount(amountStr: string, decimals: number): bigint {
  const [whole, fraction = ""] = amountStr.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const combined = whole + paddedFraction;
  return BigInt(combined);
}

/**
 * Convert a bigint amount to a plain decimal string (no locale formatting).
 * Inverse of parseAmount — guarantees parseAmount(toDecimalStr(x, d), d) === x.
 */
export function toDecimalStr(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Format address for display (0x1234...5678)
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Calculate fee amount
 * fee = amountIn * feePips / 1_000_000
 */
export function calculateFee(amountIn: bigint, feePips: number = 250): bigint {
  return (amountIn * BigInt(feePips)) / 1_000_000n;
}

/**
 * Calculate net amount maker receives
 */
export function calculateNetAmount(amountIn: bigint, feePips: number = 250): bigint {
  const fee = calculateFee(amountIn, feePips);
  return amountIn - fee;
}

/**
 * Format fee in basis points for display
 */
export function formatFeeBps(feePips: number): string {
  return `${(feePips / 100).toFixed(2)} bps`;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Calculate expiry timestamp
 */
export function calculateExpiry(ttlSeconds: number): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds;
}

/**
 * Check if timestamp has expired
 */
export function isExpired(expiryTimestamp: number): boolean {
  return Math.floor(Date.now() / 1000) > expiryTimestamp;
}

/**
 * Get seconds until expiry
 */
export function secondsUntilExpiry(expiryTimestamp: number): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, expiryTimestamp - now);
}

/**
 * Format countdown timer
 */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
  return `${secs}s`;
}

/**
 * Calculate price from amounts
 */
export function calculatePrice(
  amountIn: bigint,
  amountOut: bigint,
  decimalsIn: number,
  decimalsOut: number
): number {
  // Normalize to common precision
  const normalizedIn = Number(amountIn) / 10 ** decimalsIn;
  const normalizedOut = Number(amountOut) / 10 ** decimalsOut;
  return normalizedOut / normalizedIn;
}

/**
 * Enrich a quote with computed metadata
 */
export function enrichQuote(
  quote: RFQQuote,
  tokenIn: Token,
  tokenOut: Token,
  feePips: number = 250
): QuoteWithMeta {
  const feeAmount = calculateFee(quote.amountIn, feePips);
  const netAmountIn = quote.amountIn - feeAmount;
  const expiresIn = secondsUntilExpiry(quote.expiry);

  return {
    ...quote,
    price: calculatePrice(
      quote.amountIn,
      quote.amountOut,
      tokenIn.decimals,
      tokenOut.decimals
    ),
    priceInverse: calculatePrice(
      quote.amountOut,
      quote.amountIn,
      tokenOut.decimals,
      tokenIn.decimals
    ),
    feeAmount,
    netAmountIn,
    expiresIn,
    isExpired: expiresIn <= 0,
    tokenInDecimals: tokenIn.decimals,
    tokenOutDecimals: tokenOut.decimals,
  };
}

/**
 * Validate quote matches request parameters
 */
export function validateQuoteMatchesRequest(
  quote: RFQQuote,
  request: {
    kind: QuoteKind;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amountIn?: bigint;
    amountOut?: bigint;
    taker: `0x${string}`;
  }
): { valid: boolean; error?: string } {
  if (quote.kind !== request.kind) {
    return { valid: false, error: "Quote kind does not match request" };
  }

  if (quote.tokenIn.toLowerCase() !== request.tokenIn.toLowerCase()) {
    return { valid: false, error: "Token in does not match" };
  }

  if (quote.tokenOut.toLowerCase() !== request.tokenOut.toLowerCase()) {
    return { valid: false, error: "Token out does not match" };
  }

  // For EXACT_IN, amountIn must match
  if (request.kind === QuoteKind.EXACT_IN && request.amountIn !== undefined) {
    if (quote.amountIn !== request.amountIn) {
      return { valid: false, error: "Amount in does not match request" };
    }
  }

  // For EXACT_OUT, amountOut must match
  if (request.kind === QuoteKind.EXACT_OUT && request.amountOut !== undefined) {
    if (quote.amountOut !== request.amountOut) {
      return { valid: false, error: "Amount out does not match request" };
    }
  }

  // Check taker restriction
  if (
    quote.taker !== "0x0000000000000000000000000000000000000000" &&
    quote.taker.toLowerCase() !== request.taker.toLowerCase()
  ) {
    return { valid: false, error: "Quote is restricted to a different taker" };
  }

  return { valid: true };
}

/**
 * Format a number as USD for display.
 * Returns "—" for null/NaN/zero inputs.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || isNaN(value) || value === 0) return "—";
  if (value < 0.01) return "<$0.01";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a number as compact USD notation.
 * Returns "—" for non-finite / NaN. Uses B / M / K suffixes.
 */
export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value > 0) return "<$0.01";
  return "$0";
}

/**
 * Safely format a raw BigInt token amount for display.
 * Never returns scientific notation. Returns "—" on any parse failure.
 */
export function safeFormatTokenAmount(
  rawAmount: string | null,
  decimals: number,
  maxDec: number = 4,
): string {
  if (!rawAmount?.trim()) return "—";
  try {
    return formatAmount(BigInt(rawAmount), decimals, maxDec);
  } catch {
    return "—";
  }
}

/**
 * Convert a floating-point number to a bigint with the given decimals.
 * Avoids scientific notation issues — toFixed() always returns decimal notation,
 * unlike Number.toString() which produces "2.5e+22" for large values.
 *
 * Example: safeBigIntFromFloat(100000.5, 18) → 100000500000000000000000n
 */
export function safeBigIntFromFloat(value: number, decimals: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const [whole, frac = ""] = value.toFixed(decimals).split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

/**
 * Get user-friendly error message from contract revert
 */
export function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Map known contract errors to friendly messages
  const errorMap: Record<string, string> = {
    InvalidMaker: "Invalid maker address",
    InvalidTokenIn: "Invalid input token",
    InvalidTokenOut: "Invalid output token",
    InvalidAmountIn: "Invalid input amount",
    InvalidAmountOut: "Invalid output amount",
    QuoteExpired: "Quote has expired",
    InvalidNonce: "Maker has cancelled this quote",
    QuoteAlreadyUsed: "Quote has already been filled",
    InvalidSignature: "Invalid quote signature",
    TakerNotAllowed: "You are not authorized to fill this quote",
    TokenDeniedError: "One of the tokens is not allowed",
    MinOutNotMet: "Output amount is below your minimum",
    MaxInExceeded: "Input amount exceeds your maximum",
    InsufficientAllowance: "Please approve the token first",
    InsufficientBalance: "Insufficient token balance",
  };

  for (const [key, friendlyMessage] of Object.entries(errorMap)) {
    if (message.includes(key)) {
      return friendlyMessage;
    }
  }

  // User rejected
  if (message.includes("User rejected") || message.includes("user rejected")) {
    return "Transaction was rejected";
  }

  return "Transaction failed. Please try again.";
}
