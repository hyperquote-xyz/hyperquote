/**
 * Public Best Route — selects the best executable public route
 * from all venue results (HyperCore, PRJX, HT R1).
 *
 * Users see ONE clean "Public Best Route" — no venue jargon.
 * Venue breakdown is available in the detail modal.
 */

import type { RouteStatus } from "@/components/swap-v2/routeStatus";

export interface VenueCandidate {
  source: string;
  amountOut: number;
  route: string[];
  status: RouteStatus;
  fillRatio: number;
  slippagePct: number;
}

export interface PublicBestRoute {
  amountOut: number;
  source: string;
  route: string[];
  routeLabel: string;
  status: RouteStatus;
  userMessage: string;
  /** 0–100 confidence score */
  confidence: number;
  confidenceLabel: string;
}

const OK_STATUSES = new Set<RouteStatus>(["OK_DIRECT", "OK_ROUTED_USDC", "OK_ROUTED_WHYPE"]);

/**
 * Compute a confidence score (0–100) for a venue result.
 *
 * Factors:
 * - Status (OK = high, partial/high_slippage = medium, fail = 0)
 * - Fill ratio (1.0 = full confidence, <1.0 scales down)
 * - Slippage (lower = higher confidence)
 * - Source reliability (on-chain > aggregator)
 */
function computeConfidence(candidate: VenueCandidate): number {
  if (!OK_STATUSES.has(candidate.status)) {
    if (candidate.status === "PARTIAL_FILL") return Math.round(candidate.fillRatio * 40);
    if (candidate.status === "HIGH_SLIPPAGE") return 20;
    return 0;
  }

  let score = 80; // base for OK status

  // Fill ratio bonus (full fill = +10)
  score += Math.round(candidate.fillRatio * 10);

  // Low slippage bonus (< 0.5% = +10, < 2% = +5)
  if (candidate.slippagePct < 0.5) score += 10;
  else if (candidate.slippagePct < 2) score += 5;

  // Slight penalty for high slippage even within OK threshold
  if (candidate.slippagePct > 5) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function confidenceLabel(score: number): string {
  if (score >= 90) return "High";
  if (score >= 70) return "Good";
  if (score >= 50) return "Moderate";
  if (score >= 30) return "Low";
  return "Very Low";
}

function routeStatusMessage(status: RouteStatus, route: string[]): string {
  const isRouted = route.length > 2;
  if (status === "OK_DIRECT") return "Valid direct route";
  if (status === "OK_ROUTED_USDC") return "Routed through USDC";
  if (status === "OK_ROUTED_WHYPE") return "Routed through HYPE";
  if (status === "PARTIAL_FILL") return "Insufficient liquidity";
  if (status === "HIGH_SLIPPAGE") return "Too much slippage";
  if (status === "NO_ROUTE") return "No viable route";
  if (status === "ERROR") return "Unable to fetch reference";
  return "Reference unavailable";
}

/**
 * Select the best public route from all venue candidates.
 *
 * Ranking:
 * 1. Executable output amount (highest wins)
 * 2. Fill completeness (full fill preferred)
 * 3. Lower slippage preferred
 *
 * Excludes: NO_ROUTE, REFERENCE_UNAVAILABLE, ERROR
 */
export function selectPublicBestRoute(
  candidates: VenueCandidate[],
): PublicBestRoute | null {
  // Filter to executable candidates
  const executable = candidates.filter(c =>
    OK_STATUSES.has(c.status) || c.status === "PARTIAL_FILL" || c.status === "HIGH_SLIPPAGE"
  );

  if (executable.length === 0) return null;

  // Sort: OK statuses first, then by amountOut descending
  executable.sort((a, b) => {
    const aOk = OK_STATUSES.has(a.status) ? 1 : 0;
    const bOk = OK_STATUSES.has(b.status) ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk; // OK statuses first
    return b.amountOut - a.amountOut; // then by output amount
  });

  const winner = executable[0];
  const confidence = computeConfidence(winner);

  return {
    amountOut: winner.amountOut,
    source: winner.source,
    route: winner.route,
    routeLabel: winner.route.join(" → "),
    status: winner.status,
    userMessage: routeStatusMessage(winner.status, winner.route),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
  };
}
