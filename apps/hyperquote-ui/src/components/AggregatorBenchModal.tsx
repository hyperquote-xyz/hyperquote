"use client";

/**
 * AggregatorBenchModal — External Aggregator Benchmark Display
 *
 * Opens when user clicks "Compare vs Aggregators" below the AMMBaselinePanel.
 *
 * Shows info-only benchmark pricing from:
 *   - HT.xyz (always available — no API key required)
 *   - HyperBloom (only if HYPERBLOOM_API_KEY is configured)
 *
 * Each section displays:
 *   - Output amount (formatted)
 *   - vs-SOR-baseline comparison (% better/worse)
 *   - Route breakdown (dex, portion%, pool address)
 *   - Compute time
 *   - Error state (if upstream failed)
 *
 * NOT executable — purely informational.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatAmount } from "@/lib/utils";
import type { Token } from "@/types";
import type {
  HTBenchResult,
  HyperBloomBenchResult,
  BenchRouteSplit,
} from "@/hooks/useAggregatorBench";
import {
  BarChart3,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AggregatorBenchModalProps {
  open: boolean;
  onClose: () => void;
  ht: HTBenchResult | null;
  hyperbloom: HyperBloomBenchResult | null;
  loading: boolean;
  error: string | null;
  tokenOut: Token | null;
  /** SOR baseline amountOut for comparison (raw BigInt string) */
  baselineAmountOut: string | null;
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the percentage difference between an aggregator output and the
 * SOR baseline. Positive = aggregator is better.
 */
function computeDeltaPct(
  aggOutput: string | null,
  baselineOutput: string | null
): number | null {
  if (!aggOutput || !baselineOutput) return null;
  try {
    const agg = BigInt(aggOutput);
    const base = BigInt(baselineOutput);
    if (base === 0n) return null;
    return Number(((agg - base) * 10000n) / base) / 100;
  } catch {
    // If outputs are decimal strings, try float math
    const a = parseFloat(aggOutput);
    const b = parseFloat(baselineOutput);
    if (!a || !b || b === 0) return null;
    return ((a - b) / b) * 100;
  }
}

function formatOutputAmount(
  amount: string | null,
  tokenOut: Token | null
): string {
  if (!amount || !tokenOut) return "—";
  try {
    return formatAmount(BigInt(amount), tokenOut.decimals);
  } catch {
    // Amount might be a decimal string from HT.xyz
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    return num.toFixed(6);
  }
}

function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct == null) return null;

  const isPositive = deltaPct > 0.01;
  const isNegative = deltaPct < -0.01;

  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const colorClass = isPositive
    ? "bg-green-500/10 text-green-500 border-green-500/20"
    : isNegative
      ? "bg-red-500/10 text-red-500 border-red-500/20"
      : "bg-muted text-muted-foreground border-border/40";

  return (
    <Badge
      variant="secondary"
      className={cn("text-[10px] font-mono px-1.5 py-0 gap-1", colorClass)}
    >
      <Icon className="h-2.5 w-2.5" />
      {deltaPct > 0 ? "+" : ""}
      {deltaPct.toFixed(2)}% vs SOR
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BenchSection({
  label,
  linkUrl,
  outputAmount,
  route,
  computeTimeMs,
  error,
  tokenOut,
  baselineAmountOut,
}: {
  label: string;
  linkUrl?: string;
  outputAmount: string | null;
  route: BenchRouteSplit[];
  computeTimeMs: number;
  error: string | null;
  tokenOut: Token | null;
  baselineAmountOut: string | null;
}) {
  const deltaPct = computeDeltaPct(outputAmount, baselineAmountOut);

  // ── Error state ──
  if (error) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          <Badge
            variant="secondary"
            className="text-[10px] font-mono px-1.5 py-0 ml-auto"
          >
            {computeTimeMs}ms
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  // ── No data ──
  if (!outputAmount) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-xs text-muted-foreground ml-auto italic">
            No data
          </span>
        </div>
      </div>
    );
  }

  // ── Data display ──
  return (
    <div className="rounded-lg border border-border/40 bg-card/50 px-4 py-3 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{label}</span>
        {linkUrl && (
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          <DeltaBadge deltaPct={deltaPct} />
          <Badge
            variant="secondary"
            className="text-[10px] font-mono px-1.5 py-0"
          >
            <Clock className="h-2.5 w-2.5 mr-0.5" />
            {computeTimeMs}ms
          </Badge>
        </div>
      </div>

      {/* Output amount */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Output</span>
        <span className="font-medium font-mono text-sm">
          {formatOutputAmount(outputAmount, tokenOut)}{" "}
          <span className="text-xs text-muted-foreground">
            {tokenOut?.symbol ?? ""}
          </span>
        </span>
      </div>

      {/* Route breakdown */}
      {route.length > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Route</span>
          <div className="space-y-0.5">
            {route.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-[11px] rounded bg-muted/30 px-2 py-1"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.dex}</span>
                  {r.poolAddress && (
                    <span className="font-mono text-muted-foreground/60">
                      {r.poolAddress.slice(0, 6)}...{r.poolAddress.slice(-4)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono">
                    {(r.portion * 100).toFixed(0)}%
                  </span>
                  {r.fee > 0 && (
                    <span className="text-[10px]">
                      ({r.fee > 100 ? `${(r.fee / 10000).toFixed(2)}%` : `${r.fee}bps`} fee)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AggregatorBenchModal({
  open,
  onClose,
  ht,
  hyperbloom,
  loading,
  error,
  tokenOut,
  baselineAmountOut,
  onRefresh,
}: AggregatorBenchModalProps) {
  const hasAnyData = !!ht || !!hyperbloom;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Aggregator Benchmarks
          </DialogTitle>
          <DialogDescription>
            External aggregator pricing (info-only, not executable)
          </DialogDescription>
        </DialogHeader>

        {/* ── Loading state ── */}
        {loading && !hasAnyData && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Fetching benchmarks...
            </span>
          </div>
        )}

        {/* ── Error state (hook-level) ── */}
        {error && !hasAnyData && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── HT.xyz section ── */}
        {ht && (
          <BenchSection
            label="HT.xyz"
            linkUrl="https://ht.xyz"
            outputAmount={ht.outputAmount}
            route={ht.route}
            computeTimeMs={ht.computeTimeMs}
            error={ht.error}
            tokenOut={tokenOut}
            baselineAmountOut={baselineAmountOut}
          />
        )}

        {/* ── HyperBloom section (only if enabled) ── */}
        {hyperbloom && hyperbloom.enabled && (
          <BenchSection
            label="HyperBloom"
            linkUrl="https://www.hyperbloom.xyz"
            outputAmount={hyperbloom.outputAmount}
            route={hyperbloom.route}
            computeTimeMs={hyperbloom.computeTimeMs}
            error={hyperbloom.error}
            tokenOut={tokenOut}
            baselineAmountOut={baselineAmountOut}
          />
        )}

        {/* ── HyperBloom not configured notice ── */}
        {hyperbloom && !hyperbloom.enabled && (
          <div className="text-xs text-muted-foreground/70 italic py-1 pl-1">
            HyperBloom: Not configured (set HYPERBLOOM_API_KEY to enable)
          </div>
        )}

        {/* ── Refresh + loading indicator ── */}
        <div className="flex items-center justify-between pt-1">
          {loading && hasAnyData && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Refreshing...</span>
            </div>
          )}
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="text-xs"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 mr-1.5",
                  loading && "animate-spin"
                )}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Disclaimer ── */}
        <p className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-2">
          Benchmarks are informational only. Actual execution may differ.
          Route data sourced from third-party APIs.
        </p>
      </DialogContent>
    </Dialog>
  );
}
