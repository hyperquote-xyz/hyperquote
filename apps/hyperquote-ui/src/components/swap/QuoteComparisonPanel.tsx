"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, RefreshCw } from "lucide-react";
import {
  type Token,
  type QuoteWithMeta,
  type AMMEstimate,
} from "@/types";
import {
  type VenueComparisonResult,
  type VenueResult,
  type VenuePartial,
  venueFailureText,
} from "@/lib/venueComparison";
import { formatAmount, cn, safeSymbol } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface ComparisonVenueRow {
  id: string;
  label: string;
  sublabel: string;
  venue: VenueResult | null;
}

// ---------------------------------------------------------------------------
// QuoteComparisonPanel
// ---------------------------------------------------------------------------

export function QuoteComparisonPanel({
  venueResult,
  tokenIn,
  tokenOut,
  loading,
  everFetched,
  updatedAt,
  bestQuote,
  hasActiveRFQ,
}: {
  venueResult: VenueComparisonResult | null;
  tokenIn: Token | null;
  tokenOut: Token | null;
  loading: boolean;
  everFetched: boolean;
  updatedAt: number | null;
  bestQuote: QuoteWithMeta | null;
  hasActiveRFQ: boolean;
}) {
  const hasTokenOut = tokenOut != null;
  const sym = hasTokenOut ? safeSymbol(tokenOut) : "";
  const dec = hasTokenOut ? tokenOut.decimals : 0;
  const inSym = tokenIn ? safeSymbol(tokenIn) : "";
  const inDec = tokenIn ? tokenIn.decimals : 0;

  const rows: ComparisonVenueRow[] = [
    { id: "hypercore", label: "HyperCore Spot", sublabel: "order book", venue: venueResult?.hypercore ?? null },
    { id: "evm", label: "HyperEVM DEX", sublabel: "ht.xyz", venue: venueResult?.dex ?? null },
  ];

  // Best maker quote amount (only while RFQ is active)
  const makerAmount = hasActiveRFQ && bestQuote && !bestQuote.isExpired
    ? BigInt(bestQuote.amountOut)
    : null;

  // Format "Updated X ago" timestamp
  const updatedLabel = (() => {
    if (!updatedAt) return null;
    const secsAgo = Math.floor((Date.now() - updatedAt) / 1000);
    if (secsAgo < 5) return "just now";
    if (secsAgo < 60) return `${secsAgo}s ago`;
    return `${Math.floor(secsAgo / 60)}m ago`;
  })();

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-base">Venue Comparison</h3>
        </div>
        <div className="flex items-center gap-2">
          {updatedLabel && (
            <span className="text-[10px] text-muted-foreground">
              Updated {updatedLabel}
            </span>
          )}
          {loading && (
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
          )}
        </div>
      </div>

      {/* Pre-submit hint */}
      {!everFetched && !hasActiveRFQ && !loading && (
        <p className="text-xs text-muted-foreground text-center mb-4">
          Submit an RFQ to see venue comparison
        </p>
      )}

      {/* Venue rows */}
      <div className="space-y-3">
        {rows.map((row) => {
          const isSuccess = row.venue?.ok === true && row.venue.estimate.amountOut > 0n;
          const isPartial = row.venue?.ok === "partial";
          const hasData = isSuccess || isPartial;
          const estimate = isSuccess ? (row.venue as { ok: true; estimate: AMMEstimate }).estimate : null;
          const partial = isPartial ? (row.venue as VenuePartial) : null;
          const isCalculating = loading && !hasData && !everFetched;

          // The display amount: full estimate or partial filledOut
          const displayAmount = isSuccess ? estimate!.amountOut : isPartial ? partial!.filledOut : null;

          // Color: amber for partial, red if maker quote is better, neutral otherwise
          const colorClass = isPartial
            ? "bg-amber-500/10 border-amber-500/20"
            : !isSuccess
              ? "bg-muted/50 border-border"
              : makerAmount !== null && estimate!.amountOut < makerAmount
                ? "bg-destructive/10 border-destructive/20"
                : "bg-muted/50 border-border";

          const amountColor = isPartial
            ? "text-amber-600 dark:text-amber-400"
            : !isSuccess
              ? "text-muted-foreground"
              : makerAmount !== null && estimate!.amountOut < makerAmount
                ? "text-destructive"
                : "text-foreground";

          // Slippage vs maker quote — use venue as denominator so % matches savings banner
          let slippageVsMaker: string | null = null;
          if (isSuccess && makerAmount !== null && makerAmount > 0n && estimate!.amountOut > 0n) {
            const diff = Number(makerAmount - estimate!.amountOut);
            const pct = (diff / Number(estimate!.amountOut)) * 100;
            if (Math.abs(pct) < 0.01) {
              slippageVsMaker = "≈ same as best quote";
            } else if (pct > 0) {
              slippageVsMaker = `-${pct.toFixed(2)}% vs best quote`;
            } else {
              slippageVsMaker = `+${Math.abs(pct).toFixed(2)}% vs best quote`;
            }
          }

          return (
            <div key={row.id} className={cn("p-4 rounded-lg border", colorClass)}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{row.label}</span>
                    {isPartial && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-600 dark:text-amber-400">
                        Partial ({(partial!.filledPct * 100).toFixed(1)}%)
                      </Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{row.sublabel}</span>
                </div>
                {isSuccess ? (
                  <span className={cn("font-mono font-medium text-sm", amountColor)}>
                    {formatAmount(estimate!.amountOut, dec, 2)} {sym}
                  </span>
                ) : isPartial ? (
                  <div className="text-right">
                    <span className={cn("font-mono font-medium text-sm", amountColor)}>
                      {formatAmount(partial!.filledOut, dec, 2)} {sym}
                    </span>
                    <div className="text-[10px] text-muted-foreground">
                      {formatAmount(partial!.remainingIn, inDec, 2)} {inSym} unfilled
                    </div>
                  </div>
                ) : isCalculating || (loading && !everFetched) ? (
                  <span className="text-xs text-muted-foreground italic">Calculating…</span>
                ) : everFetched && row.venue && row.venue.ok === false ? (
                  <span className="text-xs text-muted-foreground italic">
                    {venueFailureText(row.venue.reason, row.id === "hypercore" ? "hypercore" : "dex")}
                  </span>
                ) : loading ? (
                  <span className="text-xs text-muted-foreground italic">Calculating…</span>
                ) : null}
              </div>

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {isCalculating ? (
                  <span className="inline-block w-20 h-3 rounded bg-muted animate-pulse" />
                ) : isSuccess ? (
                  <>
                    {(() => {
                      // Universal benchmark: slippageVsMid from unified service;
                      // fall back to venue's own priceImpact when mid-price is unavailable.
                      const impact = row.venue?.ok === true
                        ? (row.venue.slippageVsMid ?? estimate!.priceImpact)
                        : null;
                      return impact != null ? (
                        <span>Slippage: {impact.toFixed(2)}%</span>
                      ) : null;
                    })()}
                    {slippageVsMaker && (
                      <>
                        <span>•</span>
                        <span className="text-destructive">{slippageVsMaker}</span>
                      </>
                    )}
                  </>
                ) : isPartial ? (
                  <span>
                    Slippage (filled): {partial!.slippagePct.toFixed(2)}%
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* Savings callout — best maker quote vs best venue */}
        <ComparisonSavingsCallout
          venueResult={venueResult}
          tokenOut={tokenOut}
          makerAmount={makerAmount}
        />
      </div>
    </Card>
  );
}

// ── Savings callout: best maker quote vs best venue ──

function ComparisonSavingsCallout({
  venueResult,
  tokenOut,
  makerAmount,
}: {
  venueResult: VenueComparisonResult | null;
  tokenOut: Token | null;
  makerAmount: bigint | null;
}) {
  if (!venueResult || !tokenOut || !makerAmount || makerAmount <= 0n) return null;

  // Collect all successful + partial venue outputs
  const candidates: { label: string; amountOut: bigint }[] = [];
  if (venueResult.hypercore.ok === true && venueResult.hypercore.estimate.amountOut > 0n) {
    candidates.push({ label: "HyperCore Spot", amountOut: venueResult.hypercore.estimate.amountOut });
  } else if (venueResult.hypercore.ok === "partial" && venueResult.hypercore.filledOut > 0n) {
    candidates.push({ label: "HyperCore Spot (partial)", amountOut: venueResult.hypercore.filledOut });
  }
  if (venueResult.dex.ok === true && venueResult.dex.estimate.amountOut > 0n) {
    candidates.push({ label: "HyperEVM DEX", amountOut: venueResult.dex.estimate.amountOut });
  } else if (venueResult.dex.ok === "partial" && venueResult.dex.filledOut > 0n) {
    candidates.push({ label: "HyperEVM DEX (partial)", amountOut: venueResult.dex.filledOut });
  }
  if (candidates.length === 0) return null;

  // Find the best venue (highest output)
  const bestVenue = candidates.reduce((best, c) =>
    c.amountOut > best.amountOut ? c : best,
  );

  const saved = makerAmount - bestVenue.amountOut;
  if (saved <= 0n) return null;

  const pct = (Number(saved) / Number(bestVenue.amountOut)) * 100;

  return (
    <div className="text-center pt-4 border-t border-border/50">
      <div className="flex items-center justify-center gap-2 text-success">
        <TrendingUp className="h-5 w-5" />
        <span className="text-2xl font-bold">
          +{formatAmount(saved, tokenOut.decimals, 2)} {safeSymbol(tokenOut)}
        </span>
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        saved with RFQ vs {bestVenue.label} ({pct.toFixed(2)}% better execution)
      </div>
    </div>
  );
}
