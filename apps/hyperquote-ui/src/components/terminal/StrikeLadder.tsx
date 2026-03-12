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
import { BarChart3, Loader2 } from "lucide-react";
import { cn, safeBigIntFromFloat } from "@/lib/utils";
import type { LadderStrike, VenueExpiry, StrikeSelection } from "@/types/terminal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 0.0001) return "<0.0001";
  return v.toFixed(4);
}

function fmtIv(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(3);
}

function fmtOi(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

/** Format YYYYMMDD or ISO date as human-readable short date. */
function fmtExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Convert ISO expiry to YYYYMMDD for API param. */
function expiryToYYYYMMDD(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StrikeLadderProps {
  strikes: LadderStrike[] | undefined;
  loading: boolean;
  error: string | null;
  /** Available expiries from venue endpoint. */
  expiries: VenueExpiry[];
  selectedExpiry: string; // YYYYMMDD
  onExpiryChange: (v: string) => void;
  underlying: string;
  /** ISO expiry timestamp from the ladder response. */
  expiryTs?: string;
  /** Called when user clicks a call or put side of a strike row. */
  onStrikeSelect?: (sel: StrikeSelection) => void;
  /** Currently selected strike (for highlighting). */
  selectedStrike?: StrikeSelection | null;
}

export function StrikeLadder({
  strikes,
  loading,
  error,
  expiries,
  selectedExpiry,
  onExpiryChange,
  underlying,
  expiryTs,
  onStrikeSelect,
  selectedStrike,
}: StrikeLadderProps) {
  // Split strikes into calls and puts by strike level
  const strikeMap = new Map<number, { call?: LadderStrike; put?: LadderStrike }>();
  if (strikes) {
    for (const s of strikes) {
      const entry = strikeMap.get(s.strike) ?? {};
      if (s.isCall) entry.call = s;
      else entry.put = s;
      strikeMap.set(s.strike, entry);
    }
  }
  const sortedStrikes = [...strikeMap.entries()].sort((a, b) => a[0] - b[0]);

  // Spot price from first strike with index price
  const spot = strikes?.find((s) => s.index != null)?.index;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" />
            Strike Ladder — {underlying}
            {spot != null && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1 font-mono">
                Spot ${spot.toLocaleString()}
              </Badge>
            )}
          </CardTitle>

          {/* Expiry selector */}
          {expiries.length > 0 && (
            <Select value={selectedExpiry} onValueChange={onExpiryChange}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="Select expiry" />
              </SelectTrigger>
              <SelectContent>
                {expiries.map((exp) => {
                  const code = expiryToYYYYMMDD(exp.expiry);
                  return (
                    <SelectItem key={code} value={code}>
                      {fmtExpiry(exp.expiry)} ({exp.instruments})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading && !strikes ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading ladder…
          </div>
        ) : error ? (
          <div className="px-6 py-8 text-center text-sm text-destructive">
            {error}
          </div>
        ) : !selectedExpiry ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            Select an expiry to view the strike ladder
          </div>
        ) : sortedStrikes.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No strikes available for this expiry
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground">
                  {/* Call side */}
                  <th className="px-2 py-2 text-right font-medium">Δ</th>
                  <th className="px-2 py-2 text-right font-medium">IV</th>
                  <th className="px-2 py-2 text-right font-medium">Bid</th>
                  <th className="px-2 py-2 text-right font-medium">Ask</th>
                  <th className="px-2 py-2 text-right font-medium">OI</th>
                  {/* Strike */}
                  <th className="px-3 py-2 text-center font-semibold bg-muted/20">Strike</th>
                  {/* Put side */}
                  <th className="px-2 py-2 text-right font-medium">Bid</th>
                  <th className="px-2 py-2 text-right font-medium">Ask</th>
                  <th className="px-2 py-2 text-right font-medium">IV</th>
                  <th className="px-2 py-2 text-right font-medium">Δ</th>
                  <th className="px-2 py-2 text-right font-medium">OI</th>
                </tr>
              </thead>
              <tbody>
                {sortedStrikes.map(([strike, { call, put }]) => {
                  const atm = spot != null && Math.abs(strike - spot) / spot < 0.02;
                  const strike1e18 = safeBigIntFromFloat(strike, 18).toString();

                  // Find the matching expiry ISO from venues
                  const expiryIso = expiries.find(
                    (e) => expiryToYYYYMMDD(e.expiry) === selectedExpiry,
                  )?.expiry ?? "";
                  const expiryUnix = expiryIso
                    ? Math.floor(new Date(expiryIso).getTime() / 1000)
                    : 0;

                  const isCallSelected =
                    selectedStrike?.strikeDisplay === strike &&
                    selectedStrike?.isCall === true;
                  const isPutSelected =
                    selectedStrike?.strikeDisplay === strike &&
                    selectedStrike?.isCall === false;

                  function handleSideClick(isCall: boolean, inst?: LadderStrike) {
                    if (!onStrikeSelect || !expiryIso) return;
                    onStrikeSelect({
                      expiry: expiryIso,
                      expiryTs: expiryUnix,
                      isCall,
                      strikeDisplay: strike,
                      strike1e18,
                      instrument:
                        inst?.instrument ??
                        `${underlying}-${selectedExpiry}-${strike}-${isCall ? "C" : "P"}`,
                    });
                  }

                  return (
                    <tr
                      key={strike}
                      className={cn(
                        "border-b border-border/10 transition-colors",
                        atm && "bg-primary/5",
                      )}
                    >
                      {/* Call side — clickable */}
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-emerald-400/80 cursor-pointer hover:bg-emerald-500/10 transition-colors",
                          isCallSelected && "bg-emerald-500/15",
                        )}
                        onClick={() => handleSideClick(true, call)}
                      >
                        {fmtDelta(call?.delta ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-muted-foreground cursor-pointer hover:bg-emerald-500/10 transition-colors",
                          isCallSelected && "bg-emerald-500/15",
                        )}
                        onClick={() => handleSideClick(true, call)}
                      >
                        {fmtIv(call?.iv ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-emerald-400 cursor-pointer hover:bg-emerald-500/10 transition-colors",
                          isCallSelected && "bg-emerald-500/15",
                        )}
                        onClick={() => handleSideClick(true, call)}
                      >
                        {fmtPrice(call?.bid ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-rose-400 cursor-pointer hover:bg-emerald-500/10 transition-colors",
                          isCallSelected && "bg-emerald-500/15",
                        )}
                        onClick={() => handleSideClick(true, call)}
                      >
                        {fmtPrice(call?.ask ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-muted-foreground cursor-pointer hover:bg-emerald-500/10 transition-colors",
                          isCallSelected && "bg-emerald-500/15",
                        )}
                        onClick={() => handleSideClick(true, call)}
                      >
                        {fmtOi(call?.oi ?? null)}
                      </td>
                      {/* Strike — center column */}
                      <td
                        className={cn(
                          "px-3 py-1.5 text-center font-mono font-semibold bg-muted/10",
                          atm && "text-primary",
                        )}
                      >
                        {strike.toLocaleString()}
                      </td>
                      {/* Put side — clickable */}
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-emerald-400 cursor-pointer hover:bg-rose-500/10 transition-colors",
                          isPutSelected && "bg-rose-500/15",
                        )}
                        onClick={() => handleSideClick(false, put)}
                      >
                        {fmtPrice(put?.bid ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-rose-400 cursor-pointer hover:bg-rose-500/10 transition-colors",
                          isPutSelected && "bg-rose-500/15",
                        )}
                        onClick={() => handleSideClick(false, put)}
                      >
                        {fmtPrice(put?.ask ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-muted-foreground cursor-pointer hover:bg-rose-500/10 transition-colors",
                          isPutSelected && "bg-rose-500/15",
                        )}
                        onClick={() => handleSideClick(false, put)}
                      >
                        {fmtIv(put?.iv ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-rose-400/80 cursor-pointer hover:bg-rose-500/10 transition-colors",
                          isPutSelected && "bg-rose-500/15",
                        )}
                        onClick={() => handleSideClick(false, put)}
                      >
                        {fmtDelta(put?.delta ?? null)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-muted-foreground cursor-pointer hover:bg-rose-500/10 transition-colors",
                          isPutSelected && "bg-rose-500/15",
                        )}
                        onClick={() => handleSideClick(false, put)}
                      >
                        {fmtOi(put?.oi ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { expiryToYYYYMMDD };
