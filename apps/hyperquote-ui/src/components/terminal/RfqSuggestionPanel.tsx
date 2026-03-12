"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Crosshair, ArrowRight, Info, Loader2, X } from "lucide-react";
import { useStrikeDetail } from "@/hooks/useTerminalApi";
import { putCollateralRequired, callCollateralRequired } from "@/lib/options-protocol";
import { safeBigIntFromFloat } from "@/lib/utils";
import type { StrikeSelection } from "@/types/terminal";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Default edge in basis points (3%). Configurable via env. */
const EDGE_BPS = Number(process.env.NEXT_PUBLIC_RFQ_EDGE_BPS || "300");

/** Default quantity in underlying tokens. */
const DEFAULT_QTY = 1;

// Collateral options — USDH is default per spec
const COLLATERAL_MAP: Record<string, { symbol: string; param: string }> = {
  usdh: { symbol: "USDH", param: "usdh" },
  usdc: { symbol: "USDC", param: "usdc" },
  usdt0: { symbol: "USD\u20AE0", param: "usdt0" },
};
const DEFAULT_COLLATERAL = "usdc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  if (v < 0.0001) return "<0.0001";
  return v.toFixed(4);
}

function fmtIv(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function fmtExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RfqSuggestionPanelProps {
  selection: StrikeSelection;
  underlying: string;
  selectedExpiry: string; // YYYYMMDD
  onClear: () => void;
}

export function RfqSuggestionPanel({
  selection,
  underlying,
  selectedExpiry,
  onClear,
}: RfqSuggestionPanelProps) {
  // Fetch pricing detail from terminal-api
  const { data: detail, loading } = useStrikeDetail({
    underlying,
    expiry: selectedExpiry,
    strike: selection.strikeDisplay,
    isCall: selection.isCall,
  });

  // Compute mid premium: prefer (bid+ask)/2, fallback mark, fallback lastTrade
  const midPremium = useMemo(() => {
    if (!detail) return null;
    if (detail.bid != null && detail.ask != null && detail.bid > 0 && detail.ask > 0) {
      return (detail.bid + detail.ask) / 2;
    }
    if (detail.mark != null && detail.mark > 0) return detail.mark;
    if (detail.lastTrade?.price != null && detail.lastTrade.price > 0) {
      return detail.lastTrade.price;
    }
    return null;
  }, [detail]);

  // Suggested min premium = midPremium * (1 + EDGE_BPS / 10_000)
  const suggestedMinPremium = midPremium != null
    ? midPremium * (1 + EDGE_BPS / 10_000)
    : null;

  // Collateral required (display only)
  const collateralRequired = useMemo(() => {
    const strike1e18 = safeBigIntFromFloat(selection.strikeDisplay, 18);
    const qty1e18 = safeBigIntFromFloat(DEFAULT_QTY, 18);
    if (selection.isCall) {
      return {
        amount: Number(callCollateralRequired(qty1e18)) / 1e18,
        symbol: underlying,
      };
    }
    // CSP: collateral in stablecoin (6 dec)
    const collateral = putCollateralRequired(strike1e18, qty1e18, 18, 6);
    return {
      amount: Number(collateral) / 1e6,
      symbol: COLLATERAL_MAP[DEFAULT_COLLATERAL].symbol,
    };
  }, [selection.strikeDisplay, selection.isCall, underlying]);

  // Strategy label
  const strategyLabel = selection.isCall ? "Covered Call" : "Cash-Secured Put";
  const typeParam = selection.isCall ? "cc" : "csp";

  // Deep-link query params
  const prefillParams = new URLSearchParams({
    type: typeParam,
    strike: String(selection.strikeDisplay),
    expiry: String(selection.expiryTs),
    qty: String(DEFAULT_QTY),
    collateral: DEFAULT_COLLATERAL,
  });
  if (suggestedMinPremium != null) {
    prefillParams.set("minPremium", suggestedMinPremium.toFixed(6));
  }
  // Pass pricing context so /options can show a Market Reference box
  if (midPremium != null) {
    prefillParams.set("deriveMid", midPremium.toFixed(6));
  }
  if (detail?.iv != null) {
    prefillParams.set("deriveIv", String(detail.iv));
  }
  const prefillUrl = `/options?${prefillParams.toString()}`;

  const hasPricing = midPremium != null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crosshair className="h-4 w-4 text-primary" />
            RFQ Suggestion
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={onClear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Strike + strategy header */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {strategyLabel}
          </Badge>
          <span className="font-mono text-sm font-medium">
            {underlying} {selection.strikeDisplay}{" "}
            {selection.isCall ? "C" : "P"}
          </span>
          <span className="text-xs text-muted-foreground">
            {fmtExpiry(selection.expiry)}
          </span>
        </div>

        {/* Pricing detail */}
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading pricing...
          </div>
        ) : (
          <div className="space-y-1.5 text-xs">
            {/* Derive bid/ask */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Derive Bid / Ask</span>
              <span className="font-mono">
                {fmtPrice(detail?.bid)} / {fmtPrice(detail?.ask)}
              </span>
            </div>

            {/* Mid premium */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mid Premium</span>
              <span className="font-mono font-medium">
                {fmtPrice(midPremium)}
              </span>
            </div>

            {/* Mark IV */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mark IV</span>
              <span className="font-mono">{fmtIv(detail?.iv)}</span>
            </div>

            {/* Volume / trades */}
            {(detail?.volume1h != null || detail?.tradeCount1h != null) && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">1h Vol / Trades</span>
                <span className="font-mono">
                  {detail?.volume1h?.toFixed(1) ?? "\u2014"} /{" "}
                  {detail?.tradeCount1h ?? 0}
                </span>
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-border/30 my-1" />

            {/* Suggested min premium */}
            <div className="flex justify-between items-center">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-1 text-muted-foreground">
                    Suggested Min Premium
                    <Info className="h-3 w-3" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[200px]">
                    <p className="text-xs">
                      Mid premium + {(EDGE_BPS / 100).toFixed(1)}% edge
                      ({EDGE_BPS} bps)
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="font-mono font-medium text-primary">
                {fmtPrice(suggestedMinPremium)}
              </span>
            </div>

            {/* Collateral required */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {selection.isCall ? "Underlying to lock" : "Collateral req."}
              </span>
              <span className="font-mono">
                {collateralRequired.amount.toFixed(
                  selection.isCall ? 2 : 2,
                )}{" "}
                {collateralRequired.symbol}
              </span>
            </div>

            {/* Quantity */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quantity</span>
              <span className="font-mono">
                {DEFAULT_QTY} {underlying}
              </span>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="space-y-2 pt-1">
          {hasPricing ? (
            <Link href={prefillUrl}>
              <Button size="sm" className="w-full gap-2">
                Open with Prefill
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="w-full gap-2" disabled>
                    Open with Prefill
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    No market premium available for this strike
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <Link href="/options">
            <Button variant="outline" size="sm" className="w-full gap-2">
              Open RFQ Builder
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
