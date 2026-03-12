"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, ChevronDown, ChevronUp, Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EnrichedPosition, Moneyness } from "@/lib/positions-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCountdown(expiryTs: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiryTs - now;
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function fmtExpiry(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function moneynessBadge(m: Moneyness | null) {
  if (m == null) return null;
  const variant = m === "ITM" ? "default" : "secondary";
  const className =
    m === "ITM"
      ? "bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/15"
      : "bg-muted/50 text-muted-foreground border-border/40 hover:bg-muted/50";
  return (
    <Badge variant={variant} className={cn("text-[10px] px-1.5 py-0", className)}>
      {m}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Expandable Detail Row
// ---------------------------------------------------------------------------

function PositionDetail({ position }: { position: EnrichedPosition }) {
  const isCall = position.raw.isCall;

  return (
    <tr>
      <td colSpan={7} className="px-4 py-3 bg-muted/10 border-b border-border/10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Outcome scenarios */}
          <div className="space-y-2">
            <p className="font-medium text-muted-foreground">
              What happens at expiry?
            </p>
            {isCall ? (
              <>
                <p>
                  <span className="text-muted-foreground">If spot {"<"} strike:</span>{" "}
                  Option expires worthless. You keep the premium and your {position.collateralSymbol}.
                </p>
                <p>
                  <span className="text-muted-foreground">If spot {">"} strike:</span>{" "}
                  Option is exercised. You sell your {position.collateralSymbol} at the strike price
                  and keep the premium.
                </p>
              </>
            ) : (
              <>
                <p>
                  <span className="text-muted-foreground">If spot {">"} strike:</span>{" "}
                  Option expires worthless. You keep the premium and your collateral is returned.
                </p>
                <p>
                  <span className="text-muted-foreground">If spot {"<"} strike:</span>{" "}
                  Option is exercised. You buy the underlying at the strike price
                  and keep the premium.
                </p>
              </>
            )}
          </div>

          {/* Position details */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Collateral Locked</span>
              <span className="font-mono">
                {position.collateralLockedDisplay.toFixed(
                  isCall ? 4 : 2,
                )}{" "}
                {position.collateralSymbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Premium Received</span>
              <span className="font-mono">
                ${position.premiumDisplay.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Position ID</span>
              <span className="font-mono">#{position.positionId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role</span>
              <span className="capitalize">{position.role}</span>
            </div>

            {/* Settlement note */}
            <div className="flex items-start gap-1.5 pt-1 text-muted-foreground/70">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Settlement based on 08:00 UTC reference price.</span>
            </div>

            {/* Roadmap teasers */}
            <div className="pt-1 space-y-0.5 text-muted-foreground/50 italic">
              <p>Early close via RFQ coming soon.</p>
              <p>Buying options coming in V2.</p>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Active Positions Table
// ---------------------------------------------------------------------------

interface PositionsTableProps {
  positions: EnrichedPosition[];
}

export function PositionsTable({ positions }: PositionsTableProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const toggle = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4 text-primary" />
          Active Positions
          {positions.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {positions.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {positions.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            No active positions
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Strategy</th>
                  <th className="px-3 py-2 text-right font-medium">Strike</th>
                  <th className="px-3 py-2 text-left font-medium">Expiry</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Premium</th>
                  <th className="px-3 py-2 text-right font-medium">Spot</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const isExpanded = expandedId === pos.positionId;
                  return (
                    <>
                      <tr
                        key={pos.positionId}
                        className={cn(
                          "border-b border-border/10 cursor-pointer transition-colors",
                          isExpanded
                            ? "bg-muted/20"
                            : "hover:bg-muted/10",
                        )}
                        onClick={() => toggle(pos.positionId)}
                      >
                        {/* Strategy */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1.5 py-0",
                                pos.raw.isCall
                                  ? "border-emerald-500/30 text-emerald-500"
                                  : "border-rose-500/30 text-rose-500",
                              )}
                            >
                              {pos.raw.isCall ? "CC" : "CSP"}
                            </Badge>
                            <span className="font-medium text-sm">
                              {pos.strategyLabel}
                            </span>
                          </div>
                        </td>

                        {/* Strike */}
                        <td className="px-3 py-2.5 text-right font-mono">
                          ${pos.strikeDisplay.toLocaleString()}
                        </td>

                        {/* Expiry */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span>{fmtExpiry(pos.expiryDate)}</span>
                            <span className="text-muted-foreground">
                              ({fmtCountdown(pos.expiryTs)})
                            </span>
                          </div>
                        </td>

                        {/* Qty */}
                        <td className="px-3 py-2.5 text-right font-mono">
                          {pos.quantityDisplay.toFixed(2)}
                        </td>

                        {/* Premium */}
                        <td className="px-3 py-2.5 text-right font-mono text-emerald-400">
                          ${pos.premiumDisplay.toFixed(2)}
                        </td>

                        {/* Spot */}
                        <td className="px-3 py-2.5 text-right font-mono">
                          {pos.spot != null
                            ? `$${pos.spot.toLocaleString()}`
                            : "\u2014"}
                        </td>

                        {/* Status */}
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {moneynessBadge(pos.moneyness)}
                            {pos.lifecycle === "pending_expiry" && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-border/40 text-muted-foreground"
                              >
                                Expired — Awaiting Finalization
                              </Badge>
                            )}
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable detail */}
                      {isExpanded && (
                        <PositionDetail
                          key={`detail-${pos.positionId}`}
                          position={pos}
                        />
                      )}
                    </>
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
