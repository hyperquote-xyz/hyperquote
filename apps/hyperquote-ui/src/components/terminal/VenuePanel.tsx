"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Loader2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VenueExpiry } from "@/types/terminal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtNumber(v: number | null): string {
  if (v == null || v === 0) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface VenuePanelProps {
  expiries: VenueExpiry[] | undefined;
  loading: boolean;
  error: string | null;
  underlying: string;
  selectedExpiry: string;
  onExpirySelect: (yyyymmdd: string) => void;
}

export function VenuePanel({
  expiries,
  loading,
  error,
  underlying,
  selectedExpiry,
  onExpirySelect,
}: VenuePanelProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4 text-primary" />
          Derive Venues — {underlying}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !expiries ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading venues…
          </div>
        ) : error ? (
          <div className="text-center text-sm text-destructive py-4">
            {error}
          </div>
        ) : !expiries || expiries.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">
            No active expiries
          </div>
        ) : (
          <div className="space-y-2">
            {expiries.map((exp) => {
              const code = expiryCode(exp.expiry);
              const isSelected = code === selectedExpiry;
              return (
                <button
                  key={code}
                  onClick={() => onExpirySelect(code)}
                  className={cn(
                    "w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors text-left",
                    isSelected
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/30 bg-card/50 hover:border-border/60",
                  )}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-sm">
                        {fmtExpiry(exp.expiry)}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {exp.instruments} inst
                      </Badge>
                      {isSelected && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-primary/40 text-primary"
                        >
                          Selected
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>{exp.calls}C / {exp.puts}P</span>
                      <span>·</span>
                      <span>OI {fmtNumber(exp.totalOI)}</span>
                      <span>·</span>
                      <span>Vol {fmtNumber(exp.totalVolume24h)}</span>
                    </div>
                  </div>

                  <div className="text-right space-y-0.5 shrink-0 ml-4">
                    {exp.tradeCount24h > 0 && (
                      <div className="flex items-center gap-1 text-emerald-400">
                        <TrendingUp className="h-3 w-3" />
                        <span className="font-mono">{exp.tradeCount24h} trades</span>
                      </div>
                    )}
                    <div className="text-muted-foreground/60">
                      {timeSince(exp.lastSnapshot)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Convert ISO date to YYYYMMDD. */
function expiryCode(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
