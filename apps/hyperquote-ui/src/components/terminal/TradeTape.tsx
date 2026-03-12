"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TapeTrade, LiquidityFilter } from "@/types/terminal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatUsd(v: number | null): string {
  if (v == null || v === 0) return "—";
  if (v < 0.01) return "<$0.01";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
}

function formatIv(iv: number | null): string {
  if (iv == null) return "—";
  return `${(iv * 100).toFixed(1)}%`;
}

function liqBadge(guess: string) {
  switch (guess) {
    case "LIKELY_RFQ":
    case "RFQ":
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">
          RFQ
        </Badge>
      );
    case "LIKELY_CLOB":
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/40 text-blue-500">
          CLOB
        </Badge>
      );
    default:
      return null;
  }
}

function sideBadge(side: string) {
  const isBuy = side?.toLowerCase() === "buy";
  return (
    <span
      className={cn(
        "text-[11px] font-semibold uppercase",
        isBuy ? "text-emerald-400" : "text-rose-400",
      )}
    >
      {side}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TradeTapeProps {
  trades: TapeTrade[] | undefined;
  loading: boolean;
  error: string | null;
  liquidityFilter: LiquidityFilter;
  onLiquidityFilterChange: (v: LiquidityFilter) => void;
}

export function TradeTape({
  trades,
  loading,
  error,
  liquidityFilter,
  onLiquidityFilterChange,
}: TradeTapeProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Trade Tape
            {trades && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                {trades.length}
              </Badge>
            )}
          </CardTitle>

          {/* Liquidity filter */}
          <Select
            value={liquidityFilter}
            onValueChange={(v) => onLiquidityFilterChange(v as LiquidityFilter)}
          >
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Trades</SelectItem>
              <SelectItem value="clob">CLOB Only</SelectItem>
              <SelectItem value="rfq">RFQ Only</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading && !trades ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading trades…
          </div>
        ) : error ? (
          <div className="px-6 py-8 text-center text-sm text-destructive">
            {error}
          </div>
        ) : !trades || trades.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No trades found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-3 py-2 text-left font-medium">Instrument</th>
                  <th className="px-3 py-2 text-center font-medium">Side</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Premium</th>
                  <th className="px-3 py-2 text-right font-medium">IV</th>
                  <th className="px-3 py-2 text-center font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={`${t.venue}-${t.trade_ref}`}
                    className="border-b border-border/10 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-2 font-mono text-muted-foreground whitespace-nowrap">
                      {formatTs(t.ts)}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      <span className="text-foreground">{t.instrument}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {sideBadge(t.side)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {t.price.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {t.quantity_display}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatUsd(t.premium_usd)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {formatIv(t.iv)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {liqBadge(t.derive_liquidity_guess)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
