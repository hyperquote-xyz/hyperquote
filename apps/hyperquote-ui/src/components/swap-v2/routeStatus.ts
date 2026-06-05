/**
 * Standardised Route Status Model — Venue Comparison
 *
 * Used by Market Reference UI and route audit reports.
 */

export type RouteStatus =
  | "OK_DIRECT"
  | "OK_ROUTED_USDC"
  | "OK_ROUTED_WHYPE"
  | "PARTIAL_FILL"
  | "HIGH_SLIPPAGE"
  | "NO_ROUTE"
  | "REFERENCE_UNAVAILABLE"
  | "ERROR";

export interface RouteResultDetail {
  venue: "hypercore" | "prjx" | "theoretical";
  status: RouteStatus;
  /** Route symbols, e.g. ["KNTQ", "USDC", "kHYPE"] */
  route: string[];
  /** Human-readable route string, e.g. "KNTQ → USDC → kHYPE" */
  routeLabel: string;
  /** Amount out in human-readable token units */
  amountOut: number;
  /** Price impact / slippage in basis points */
  impactBps: number;
  /** Fill ratio 0.0–1.0 (1.0 = full fill) */
  fillRatio: number;
  /** Machine-readable reason */
  reason: string;
  /** Short user-facing message for UI */
  userMessage: string;
  /** Longer explanation for tooltip */
  userTooltip: string;
}

// ---------------------------------------------------------------------------
// User-facing messages
// ---------------------------------------------------------------------------

const SHORT_MESSAGES: Record<RouteStatus, string> = {
  OK_DIRECT: "Valid direct route",
  OK_ROUTED_USDC: "Routed through USDC",
  OK_ROUTED_WHYPE: "Routed through HYPE",
  PARTIAL_FILL: "Insufficient liquidity",
  HIGH_SLIPPAGE: "Too much slippage",
  NO_ROUTE: "No viable route",
  REFERENCE_UNAVAILABLE: "Reference unavailable",
  ERROR: "Unable to fetch reference",
};

const TOOLTIP_TEMPLATES: Record<RouteStatus, (detail: Partial<RouteResultDetail>) => string> = {
  OK_DIRECT: () => "Direct pool or order book available with acceptable slippage.",
  OK_ROUTED_USDC: () => "No direct route. Best path routes through USDC as an intermediary.",
  OK_ROUTED_WHYPE: () => "No direct route. Best path routes through HYPE as an intermediary.",
  PARTIAL_FILL: (d) => `Only ${((d.fillRatio ?? 0) * 100).toFixed(0)}% of the requested size can be filled at current liquidity levels.`,
  HIGH_SLIPPAGE: (d) => `Route exists but estimated slippage is ${((d.impactBps ?? 0) / 100).toFixed(1)}%, exceeding the 10% threshold.`,
  NO_ROUTE: () => "No pool or order book exists for this pair on this venue.",
  REFERENCE_UNAVAILABLE: () => "Cannot determine a reference price for this pair.",
  ERROR: (d) => `Quote failed: ${d.reason ?? "unknown error"}.`,
};

export function getShortMessage(status: RouteStatus): string {
  return SHORT_MESSAGES[status];
}

export function getTooltip(status: RouteStatus, detail?: Partial<RouteResultDetail>): string {
  return TOOLTIP_TEMPLATES[status](detail ?? {});
}

/**
 * Build a RouteResultDetail from raw venue output.
 */
export function buildRouteResult(
  venue: RouteResultDetail["venue"],
  opts: {
    route: string[];
    amountOut: number;
    slippagePct: number;
    fillRatio?: number;
    reason?: string;
    isRouted?: "usdc" | "whype";
    error?: boolean;
  },
): RouteResultDetail {
  const { route, amountOut, slippagePct, fillRatio = 1.0, reason = "", isRouted, error } = opts;
  const impactBps = Math.round(slippagePct * 100);

  let status: RouteStatus;
  if (error) {
    status = "ERROR";
  } else if (amountOut <= 0 && !reason) {
    status = "NO_ROUTE";
  } else if (amountOut <= 0) {
    status = reason.includes("No") ? "NO_ROUTE" : "REFERENCE_UNAVAILABLE";
  } else if (fillRatio < 0.99) {
    status = "PARTIAL_FILL";
  } else if (slippagePct > 10) {
    status = "HIGH_SLIPPAGE";
  } else if (isRouted === "usdc") {
    status = "OK_ROUTED_USDC";
  } else if (isRouted === "whype") {
    status = "OK_ROUTED_WHYPE";
  } else {
    status = "OK_DIRECT";
  }

  const routeLabel = route.length > 0 ? route.join(" → ") : "—";

  return {
    venue,
    status,
    route,
    routeLabel,
    amountOut,
    impactBps,
    fillRatio,
    reason,
    userMessage: status === "PARTIAL_FILL"
      ? `Insufficient liquidity — partial fill: ${(fillRatio * 100).toFixed(0)}%`
      : getShortMessage(status),
    userTooltip: getTooltip(status, { impactBps, fillRatio, reason }),
  };
}

/** Check if a status is considered "OK" (usable as a reference) */
export function isOk(status: RouteStatus): boolean {
  return status === "OK_DIRECT" || status === "OK_ROUTED_USDC" || status === "OK_ROUTED_WHYPE";
}
