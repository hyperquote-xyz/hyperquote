"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TrendingUp, RefreshCw, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchHomeComparison,
  HomeComparisonData,
  EXAMPLE_AMOUNT_IN_DISPLAY,
  EXAMPLE_TOKEN_IN,
  EXAMPLE_TOKEN_OUT,
} from "@/lib/home-estimates";

const REFRESH_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Stale fallback — shown instantly on first render until live data arrives.
// Updated periodically by the dev team to stay roughly accurate.
// ---------------------------------------------------------------------------

const STALE_FALLBACK: HomeComparisonData = {
  spotPrice: 62.5,
  rfqRefOut: 1_600,
  hypercoreOut: 1_580,
  hypercoreSlippagePct: 1.25,
  evmOut: 1_560,
  evmRouteLabel: null,
  fetchedAt: 0, // sentinel — we use this to detect stale data
};

// ---------------------------------------------------------------------------
// Row definition
// ---------------------------------------------------------------------------

interface VenueRow {
  id: string;
  label: string;
  badge: string;
  amount: number | null;
  slippagePct: number | null;
  isReference: boolean;
  available: boolean;
  subtext?: string;
  /** 0.0–1.0, present when venue can only partially fill the order */
  partialPct?: number;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSlippage(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

function fmtSpotPrice(price: number): string {
  // For very small prices show more decimals
  if (price < 0.01) {
    return `$${price.toFixed(6)}`;
  }
  if (price < 1) {
    return `$${price.toFixed(4)}`;
  }
  return `$${price.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeComparisonCard() {
  // Seed with stale fallback so the card is never empty on first render
  const [data, setData] = useState<HomeComparisonData>(STALE_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // True while we still only have the stale fallback (fetchedAt === 0)
  const isStale = data.fetchedAt === 0;

  const refresh = useCallback(async () => {
    try {
      const result = await fetchHomeComparison();
      setData(result);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const rows = buildRows(data);
  const rfqAmount = rows.find((r) => r.isReference)?.amount ?? null;

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <h3 className="font-semibold">
            {EXAMPLE_AMOUNT_IN_DISPLAY} {EXAMPLE_TOKEN_IN} → {EXAMPLE_TOKEN_OUT}
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-xs">
              Simulates buying {EXAMPLE_TOKEN_OUT} with 100k {EXAMPLE_TOKEN_IN} across
              three venues. RFQ row is the zero-slippage ideal.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
          )}
        </div>
      </div>

      {/* Spot price + timestamp */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-6">
        {data.spotPrice != null && (
          <span className="font-mono">
            Spot: {fmtSpotPrice(data.spotPrice)}
          </span>
        )}
        {!isStale && !loading && (
          <span className="tabular-nums">
            Updated {new Date(data.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Venue rows */}
      <div className="space-y-3">
        {rows.map((row) => (
          <VenueRowCard key={row.id} row={row} rfqAmount={rfqAmount} loading={false} />
        ))}

        <SavingsCallout rows={rows} />

        {error && isStale && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center py-4">
            <AlertCircle className="h-4 w-4" />
            <span>Unable to fetch live estimates. Showing recent data…</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// VenueRowCard
// ---------------------------------------------------------------------------

function VenueRowCard({
  row,
  rfqAmount,
  loading,
}: {
  row: VenueRow;
  rfqAmount: number | null;
  loading: boolean;
}) {
  const isRef = row.isReference;

  // Color coding
  const colorClass = !row.available
    ? "bg-muted/50 border-border"
    : isRef
      ? "bg-success/10 border-success/20"
      : rfqAmount !== null && row.amount !== null && row.amount < rfqAmount
        ? "bg-destructive/10 border-destructive/20"
        : "bg-muted/50 border-border";

  const amountColor = !row.available
    ? "text-muted-foreground"
    : isRef
      ? "text-success"
      : rfqAmount !== null && row.amount !== null && row.amount < rfqAmount
        ? "text-destructive"
        : "text-foreground";

  // Slippage vs RFQ for non-reference rows — use venue as denominator so % matches savings banner
  let slippageVsRFQ: string | null = null;
  if (!isRef && row.available && row.amount !== null && row.amount > 0 && rfqAmount !== null && rfqAmount > 0) {
    const diff = rfqAmount - row.amount;
    const pct = (diff / row.amount) * 100;
    if (Math.abs(pct) < 0.01) {
      slippageVsRFQ = "≈ same as RFQ";
    } else if (pct > 0) {
      slippageVsRFQ = `-${pct.toFixed(2)}% vs RFQ`;
    } else {
      slippageVsRFQ = `+${Math.abs(pct).toFixed(2)}% vs RFQ`;
    }
  }

  return (
    <div className={cn("p-4 rounded-lg border", colorClass)}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{row.label}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {row.badge}
          </Badge>
        </div>
        {row.available && row.amount !== null ? (
          <span className={cn("font-mono font-medium text-sm", amountColor)}>
            {fmtAmount(row.amount)} {EXAMPLE_TOKEN_OUT}
          </span>
        ) : loading ? (
          <span className="inline-block w-28 h-4 rounded bg-muted animate-pulse" />
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {row.subtext}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {loading && !row.available ? (
          <span className="inline-block w-20 h-3 rounded bg-muted animate-pulse" />
        ) : row.available && row.amount !== null ? (
          <>
            <span>
              Slippage:{" "}
              {isRef
                ? "None"
                : row.slippagePct !== null
                  ? fmtSlippage(row.slippagePct)
                  : "—"}
            </span>
            {slippageVsRFQ && (
              <>
                <span>•</span>
                <span className="text-destructive">{slippageVsRFQ}</span>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SavingsCallout
// ---------------------------------------------------------------------------

function SavingsCallout({ rows }: { rows: VenueRow[] }) {
  const rfq = rows.find((r) => r.isReference);
  const others = rows.filter(
    (r) => !r.isReference && r.available && r.amount !== null && r.amount > 0
  );

  if (!rfq?.available || rfq.amount === null || others.length === 0)
    return null;

  const bestOther = others.reduce((best, r) =>
    (r.amount ?? 0) > (best.amount ?? 0) ? r : best
  );
  if (bestOther.amount === null) return null;

  const saved = rfq.amount - bestOther.amount;
  if (saved <= 0) return null;

  const pct = (saved / bestOther.amount) * 100;

  return (
    <div className="text-center pt-4 border-t border-border/50">
      <div className="flex items-center justify-center gap-2 text-success">
        <TrendingUp className="h-5 w-5" />
        <span className="text-2xl font-bold">
          +{fmtAmount(saved)} {EXAMPLE_TOKEN_OUT}
        </span>
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        saved with RFQ vs {bestOther.label} ({pct.toFixed(2)}% better execution)
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data → rows
// ---------------------------------------------------------------------------

function buildRows(data: HomeComparisonData | null): VenueRow[] {
  const rfqRef = data?.rfqRefOut ?? null;

  // Compute slippage using rfqRefOut as reference
  let evmSlippage: number | null = null;
  if (rfqRef !== null && rfqRef > 0 && data?.evmOut != null) {
    evmSlippage = ((rfqRef - data.evmOut) / rfqRef) * 100;
  }

  return [
    {
      id: "rfq",
      label: "HyperQuote RFQ",
      badge: "zero slippage",
      amount: data?.rfqRefOut ?? null,
      slippagePct: null,
      isReference: true,
      available: data?.rfqRefOut != null && data.rfqRefOut > 0,
      subtext: "RFQ reference not available for this pair.",
    },
    {
      id: "best-route",
      label: "Public Best Route",
      badge: "best execution",
      amount: data?.evmOut ?? null,
      slippagePct: evmSlippage,
      isReference: false,
      available: data?.evmOut != null && data.evmOut > 0,
      subtext: "No public route found for this pair.",
    },
    {
      id: "hypercore",
      label: "HyperCore Spot",
      badge: "L2 order book",
      amount: data?.hypercoreOut ?? null,
      slippagePct: data?.hypercoreSlippagePct ?? null,
      isReference: false,
      available: data?.hypercoreOut != null && data.hypercoreOut > 0,
      subtext: "HyperCore book too thin for this size.",
    },
  ];
}
