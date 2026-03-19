/**
 * Pair Validation — Launch RFQ Pair Rules
 *
 * Centralized pair validation for the RFQ creation flow.
 * Lightweight, static, no backend dependencies.
 *
 * Launch rules:
 *   1. Both tokens must be in the approved token registry.
 *   2. tokenIn !== tokenOut (same-token pairs blocked).
 *   3. All approved cross-token pairs are allowed (no pair matrix restriction).
 *
 * Post-launch: add pair restrictions here if needed (e.g. block exotic/exotic).
 */

import { Token } from "@/types";
import { isApprovedToken, APPROVED_STABLE_SYMBOLS } from "@/config/approvedTokens";
import { resolveSettlementToken } from "@/lib/native-wrap";
import { safeSymbol } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Check if two tokens resolve to the same settlement address.
 * Handles native HYPE ↔ WHYPE equivalence.
 */
export function isSameTokenPair(
  a: Token | null,
  b: Token | null
): boolean {
  if (!a || !b) return false;
  const addrA = resolveSettlementToken(a).address.toLowerCase();
  const addrB = resolveSettlementToken(b).address.toLowerCase();
  return addrA === addrB;
}

/**
 * Check if a token is in the approved launch set.
 */
export function isApprovedForRfq(token: Token | null): boolean {
  if (!token) return false;
  return isApprovedToken(token.address) || isApprovedToken(safeSymbol(token));
}

/**
 * Check if both tokens in a pair are stable assets.
 */
export function isStableStablePair(
  a: Token | null,
  b: Token | null
): boolean {
  if (!a || !b) return false;
  return (
    APPROVED_STABLE_SYMBOLS.has(safeSymbol(a).toUpperCase()) &&
    APPROVED_STABLE_SYMBOLS.has(safeSymbol(b).toUpperCase())
  );
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface PairValidation {
  /** Whether the pair is valid for RFQ creation. */
  valid: boolean;
  /** User-facing message if invalid. null if valid. */
  message: string | null;
  /** Severity: "error" blocks submission, "warning" shows but allows. */
  severity: "error" | "warning" | null;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validate a token pair for RFQ creation.
 * Returns validation state with a user-facing message.
 */
export function validateLaunchPair(
  tokenIn: Token | null,
  tokenOut: Token | null
): PairValidation {
  // Both must be selected
  if (!tokenIn || !tokenOut) {
    return {
      valid: false,
      message: "Select two different tokens",
      severity: "error",
    };
  }

  // Same-token check (including HYPE/WHYPE equivalence)
  if (isSameTokenPair(tokenIn, tokenOut)) {
    return {
      valid: false,
      message: "Select two different tokens",
      severity: "error",
    };
  }

  // Both must be approved
  if (!isApprovedForRfq(tokenIn)) {
    return {
      valid: false,
      message: `${safeSymbol(tokenIn)} is not a supported launch token`,
      severity: "error",
    };
  }

  if (!isApprovedForRfq(tokenOut)) {
    return {
      valid: false,
      message: `${safeSymbol(tokenOut)} is not a supported launch token`,
      severity: "error",
    };
  }

  // Stable↔stable: allowed but show advisory
  if (isStableStablePair(tokenIn, tokenOut)) {
    return {
      valid: true,
      message: null,
      severity: null,
    };
  }

  // All other approved pairs: valid
  return {
    valid: true,
    message: null,
    severity: null,
  };
}

/**
 * Short-form check: is this pair valid for submission?
 */
export function isValidLaunchPair(
  tokenIn: Token | null,
  tokenOut: Token | null
): boolean {
  return validateLaunchPair(tokenIn, tokenOut).valid;
}
