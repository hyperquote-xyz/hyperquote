"use client";

/**
 * AMMBaselinePanel — Compact SOR Baseline Display
 *
 * Shows the expected AMM output from the Smart Order Router directly
 * under the trade inputs on the RFQ spot page.
 *
 * Compact 4-5 line panel showing:
 *   - Expected output amount
 *   - Effective price
 *   - Price impact (bps)
 *   - As-of block
 *   - "View route breakdown" link → opens RouteBreakdownModal
 *
 * States:
 *   - Loading: skeleton shimmer
 *   - Error: "Baseline unavailable" with subtle warning
 *   - Data: compact info panel
 *   - No data (no routes): "No AMM routes found"
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RouteBreakdownModal } from "./RouteBreakdownModal";
import type { SORQuoteResponse } from "@/hooks/useAMMBaseline";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  AlertTriangle,
  ExternalLink,
  Info,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AMMBaselinePanelProps {
  data: SORQuoteResponse | null;
  loading: boolean;
  error: string | null;
  /** Symbol of the output token for display */
  tokenOutSymbol: string;
  /** Coverage warnings (protocols with issues) */
  coverageWarnings?: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AMMBaselinePanel({
  data,
  loading,
  error,
  tokenOutSymbol,
  coverageWarnings,
}: AMMBaselinePanelProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // ── Loading skeleton ──
  if (loading && !data) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-2 animate-pulse">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="text-xs font-medium text-muted-foreground/50">
            AMM Baseline
          </span>
          <Loader2 className="h-3 w-3 text-muted-foreground/50 animate-spin ml-auto" />
        </div>
        <div className="h-3 w-3/4 rounded bg-muted-foreground/10" />
        <div className="h-3 w-1/2 rounded bg-muted-foreground/10" />
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500/70" />
          <span className="font-medium">AMM Baseline</span>
          <span className="ml-auto italic">SOR baseline could not be computed.</span>
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-1 pl-5">
          {error}
        </p>
      </div>
    );
  }

  // ── No data yet (inputs not filled) ──
  if (!data) return null;

  // ── No routes found ──
  const hasRoutes = data.routes.length > 0 && data.summary.amountOut !== "0";
  if (!hasRoutes) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="font-medium">AMM Baseline</span>
          <span className="ml-auto italic">No routes found</span>
        </div>
        {data.warnings.length > 0 && (
          <p className="text-[11px] text-muted-foreground/70 mt-1 pl-5">
            {data.warnings[0]}
          </p>
        )}
      </div>
    );
  }

  // ── Data display ──
  const { summary, meta, warnings } = data;
  const hasWarnings = warnings.length > 0 || (coverageWarnings && coverageWarnings.length > 0);
  const impactColor =
    summary.priceImpactBps > 500
      ? "text-red-500"
      : summary.priceImpactBps > 100
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <>
      <div
        className={cn(
          "rounded-lg border px-4 py-3 space-y-1.5 transition-colors",
          loading
            ? "border-border/30 bg-muted/10"
            : "border-primary/20 bg-primary/[0.03]"
        )}
      >
        {/* Header row */}
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-primary/70" />
          <span className="text-xs font-medium text-primary/80">
            AMM Baseline (Info)
          </span>
          {loading && (
            <Loader2 className="h-3 w-3 text-muted-foreground/50 animate-spin" />
          )}
          {hasWarnings && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <AlertTriangle className="h-3 w-3 text-amber-500/70" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1 text-xs">
                    {warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                    {coverageWarnings?.map((w, i) => (
                      <p key={`cov-${i}`}>{w}</p>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Badge
            variant="secondary"
            className="ml-auto text-[10px] font-mono px-1.5 py-0"
          >
            Block {meta.asOfBlock}
          </Badge>
        </div>

        {/* Expected output */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground text-xs">Expected Output</span>
          <span className="font-medium font-mono">
            {summary.amountOutFormatted} {tokenOutSymbol}
          </span>
        </div>

        {/* Price + Impact row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Rate: {summary.effectivePrice.toFixed(6)}
          </span>
          <span className={impactColor}>
            Impact: {summary.priceImpactPct}
          </span>
        </div>

        {/* Route info + View breakdown link */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {meta.isSplit
              ? `Split across ${data.routes.length} routes`
              : data.routes[0]?.pathLabel ?? "Direct route"}
          </span>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors"
          >
            View route breakdown
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Route Breakdown Modal */}
      <RouteBreakdownModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        data={data}
        tokenOutSymbol={tokenOutSymbol}
      />
    </>
  );
}
