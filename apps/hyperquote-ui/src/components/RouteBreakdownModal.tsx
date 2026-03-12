"use client";

/**
 * RouteBreakdownModal — Full Route Detail View
 *
 * Opens when user clicks "View route breakdown" on the AMMBaselinePanel.
 *
 * Shows:
 *   - Execution legs: route name, pool(s), type badges (V2/V3/Stable),
 *     % allocation, amountIn, amountOut, per-leg price impact
 *   - Alternatives: other routes considered with relative difference
 *   - Warnings: aggregated from adapters + business rules
 *   - As-of block + timestamp
 *   - Split info (if applicable)
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SORQuoteResponse } from "@/hooks/useAMMBaseline";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  AlertTriangle,
  Info,
  Layers,
  Clock,
  TrendingDown,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RouteBreakdownModalProps {
  open: boolean;
  onClose: () => void;
  data: SORQuoteResponse | null;
  tokenOutSymbol: string;
}

// ---------------------------------------------------------------------------
// Pool type badge colors
// ---------------------------------------------------------------------------

function poolTypeBadge(poolType: string) {
  switch (poolType.toUpperCase()) {
    case "V2":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-500 border-blue-500/20">
          V2
        </Badge>
      );
    case "V3":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-purple-500/10 text-purple-500 border-purple-500/20">
          V3
        </Badge>
      );
    case "STABLE":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-teal-500/10 text-teal-500 border-teal-500/20">
          Stable
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {poolType}
        </Badge>
      );
  }
}

function impactColor(bps: number): string {
  if (bps > 500) return "text-red-500";
  if (bps > 100) return "text-amber-500";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RouteBreakdownModal({
  open,
  onClose,
  data,
  tokenOutSymbol,
}: RouteBreakdownModalProps) {
  if (!data) return null;

  const { meta, summary, routes, alternatives, warnings, fees, splitInfo } = data;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Route Breakdown
          </DialogTitle>
          <DialogDescription>
            {summary.tokenInSymbol} → {summary.tokenOutSymbol} · {summary.amountInFormatted} →{" "}
            {summary.amountOutFormatted} {tokenOutSymbol}
          </DialogDescription>
        </DialogHeader>

        {/* ── Summary Bar ── */}
        <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Effective Rate</span>
              <span className="font-mono font-medium">
                {summary.effectivePrice.toFixed(6)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Mid Price</span>
              <span className="font-mono font-medium">
                {summary.midPrice.toFixed(6)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Price Impact</span>
              <span className={cn("font-mono font-medium", impactColor(summary.priceImpactBps))}>
                {summary.priceImpactPct}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">As-of Block</span>
              <span className="font-mono font-medium">{meta.asOfBlock}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground border-t border-border/30 pt-2">
            <Clock className="h-3 w-3" />
            <span>{meta.timestamp}</span>
            <span>·</span>
            <span>{meta.computeTimeMs}ms compute</span>
            <span>·</span>
            <span>{meta.candidatesConsidered} candidates → {meta.viableRoutes} viable</span>
          </div>
        </div>

        {/* ── Split Info ── */}
        {splitInfo && meta.isSplit && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span>
              Split across <strong>{splitInfo.routeCount} routes</strong> for{" "}
              <strong className="text-primary">+{splitInfo.improvementPct}</strong> improvement
              over best single route
            </span>
          </div>
        )}

        {/* ── Execution Legs ── */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-primary" />
            Execution Legs
          </h4>

          {routes.map((route, ri) => (
            <div
              key={ri}
              className="rounded-lg border border-border/40 bg-card/50 overflow-hidden"
            >
              {/* Route header */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border/30">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{route.pathLabel}</span>
                  {routes.length > 1 && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {route.fractionPct}
                    </Badge>
                  )}
                </div>
                <span className={cn("text-xs font-mono", impactColor(route.priceImpactBps))}>
                  {route.priceImpactBps > 0
                    ? `${(route.priceImpactBps / 100).toFixed(2)}% impact`
                    : "0% impact"}
                </span>
              </div>

              {/* Hops */}
              <div className="divide-y divide-border/20">
                {route.hops.map((hop, hi) => (
                  <div
                    key={hi}
                    className="px-4 py-2.5 flex items-start gap-3 text-xs"
                  >
                    {/* Hop number */}
                    <div className="flex items-center justify-center h-5 w-5 rounded-full bg-muted/50 text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">
                      {hi + 1}
                    </div>

                    {/* Hop details */}
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono">
                          {hop.tokenInSymbol ?? hop.tokenIn.slice(0, 8)}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono">
                          {hop.tokenOutSymbol ?? hop.tokenOut.slice(0, 8)}
                        </span>
                        {poolTypeBadge(hop.poolType)}
                        <span className="text-muted-foreground">{hop.protocol}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>In: {hop.amountIn}</span>
                        <span>→</span>
                        <span>Out: {hop.amountOut}</span>
                        {hop.fee !== "0" && (
                          <span className="text-amber-500/70">Fee: {hop.fee}</span>
                        )}
                        <span className={impactColor(hop.priceImpactBps)}>
                          {hop.priceImpactBps > 0
                            ? `${(hop.priceImpactBps / 100).toFixed(2)}% impact`
                            : ""}
                        </span>
                      </div>
                    </div>

                    {/* Pool address */}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            {hop.poolAddress.slice(0, 6)}…{hop.poolAddress.slice(-4)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-mono text-xs">{hop.poolAddress}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Fees ── */}
        {fees.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Fees</h4>
            <div className="flex flex-wrap gap-2">
              {fees.map((fee, i) => (
                <Badge key={i} variant="outline" className="text-xs font-mono">
                  {fee.amount} {fee.symbol ?? fee.token.slice(0, 8)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Alternatives ── */}
        {alternatives.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
              <TrendingDown className="h-4 w-4" />
              Alternatives Considered
            </h4>
            <div className="space-y-1.5">
              {alternatives.map((alt, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-border/30 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{alt.pathLabel}</span>
                    <span className="text-muted-foreground italic">
                      {alt.reason}
                    </span>
                  </div>
                  <span className="font-mono text-muted-foreground">
                    {alt.diffPct}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Warnings ── */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-4 w-4" />
              Warnings
            </h4>
            <div className="space-y-1">
              {warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
                >
                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
