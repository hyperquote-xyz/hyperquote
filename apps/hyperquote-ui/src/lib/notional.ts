/**
 * Server-side USD notional resolution.
 *
 * Client-provided USD values are NEVER trusted. This module derives the USD
 * notional of a fill from server-controlled sources only, following a strict
 * manipulation-resistant hierarchy:
 *
 *   A) rfq_baseline   — server-captured reference price stored at RFQ creation
 *                       (RfqBaseline.referenceUsdPrice; written server-side, not
 *                       by the client).
 *   B) stable         — if either leg is a known USD stablecoin, the notional is
 *                       the stable-side human amount (deterministic, no oracle).
 *   C) hypercore      — HyperCore L2 mid price for tokenIn (then tokenOut),
 *                       fetched server-side.
 *   —) unavailable    — no trusted price; notional is null and the fill earns
 *                       zero points (no inflation possible).
 *
 * The returned { source, timestamp } is persisted alongside the fill as a
 * per-record pricing audit trail.
 */

import { getTokenByAddress } from "@/config/tokens";
import { getUsdPrice, USD_STABLES } from "@/lib/hyperliquid";
import { prisma } from "@/lib/db";

export type PricingSource =
  | "rfq_baseline"
  | "stable"
  | "stable_out"
  | "hypercore"
  | "hypercore_out"
  | "unavailable";

export interface NotionalResult {
  usd: number | null;
  source: PricingSource;
  timestamp: Date;
}

function human(raw: string, decimals: number): number {
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

export interface ResolveArgs {
  rfqId?: string | null;
  tokenInAddr: string;
  tokenOutAddr: string;
  amountInRaw: string;
  amountOutRaw: string;
}

export async function resolveVerifiedNotionalUsd(
  args: ResolveArgs
): Promise<NotionalResult> {
  const timestamp = new Date();
  const tokenIn = getTokenByAddress(args.tokenInAddr);
  const tokenOut = getTokenByAddress(args.tokenOutAddr);

  // ── A) Server-captured reference price stored at RFQ creation ─────────────
  if (args.rfqId && tokenIn) {
    try {
      const b = await prisma.rfqBaseline.findUnique({
        where: { rfqId: args.rfqId },
        select: { referenceUsdPrice: true },
      });
      const refPrice = b?.referenceUsdPrice ?? null;
      if (refPrice && refPrice > 0) {
        const usd = human(args.amountInRaw, tokenIn.decimals) * refPrice;
        if (usd > 0) return { usd, source: "rfq_baseline", timestamp };
      }
    } catch {
      // fall through to live pricing
    }
  }

  // ── B) Stablecoin identity (deterministic, no oracle) ─────────────────────
  if (tokenIn && USD_STABLES.has(tokenIn.symbol)) {
    return { usd: human(args.amountInRaw, tokenIn.decimals), source: "stable", timestamp };
  }
  if (tokenOut && USD_STABLES.has(tokenOut.symbol)) {
    return { usd: human(args.amountOutRaw, tokenOut.decimals), source: "stable_out", timestamp };
  }

  // ── C) HyperCore L2 mid price (server-side), tokenIn then tokenOut ────────
  if (tokenIn) {
    const p = await getUsdPrice(tokenIn);
    if (p && p > 0) {
      return { usd: human(args.amountInRaw, tokenIn.decimals) * p, source: "hypercore", timestamp };
    }
  }
  if (tokenOut) {
    const p = await getUsdPrice(tokenOut);
    if (p && p > 0) {
      return { usd: human(args.amountOutRaw, tokenOut.decimals) * p, source: "hypercore_out", timestamp };
    }
  }

  return { usd: null, source: "unavailable", timestamp };
}

/** Emit a structured pricing-audit log line for a resolved notional. */
export function logNotionalAudit(
  context: string,
  rfqId: string | null | undefined,
  txHash: string,
  result: NotionalResult
): void {
  console.log(
    `[notional-audit] ctx=${context} rfqId=${rfqId ?? "-"} tx=${txHash} ` +
      `usd=${result.usd ?? "null"} source=${result.source} ts=${result.timestamp.toISOString()}`
  );
}
