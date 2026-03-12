"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EnrichedPosition } from "@/lib/positions-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtExpiry(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function outcomeBadge(label: string | null) {
  if (!label) return null;

  // Neutral styling — no dramatic colors per spec
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 border-border/40 text-muted-foreground"
    >
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ExpiredPositionsProps {
  positions: EnrichedPosition[];
}

export function ExpiredPositions({ positions }: ExpiredPositionsProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (positions.length === 0) return null;

  return (
    <Card>
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <CardTitle className="flex items-center gap-2 text-base">
          <Archive className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            Expired Positions ({positions.length})
          </span>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
          )}
        </CardTitle>
      </CardHeader>

      {isOpen && (
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Strategy</th>
                  <th className="px-3 py-2 text-right font-medium">Strike</th>
                  <th className="px-3 py-2 text-left font-medium">Expiry</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Premium</th>
                  <th className="px-3 py-2 text-center font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr
                    key={pos.positionId}
                    className="border-b border-border/10 hover:bg-muted/10 transition-colors"
                  >
                    {/* Strategy */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0",
                            pos.raw.isCall
                              ? "border-emerald-500/20 text-emerald-500/60"
                              : "border-rose-500/20 text-rose-500/60",
                          )}
                        >
                          {pos.raw.isCall ? "CC" : "CSP"}
                        </Badge>
                        <span className="text-muted-foreground">
                          {pos.strategyLabel}
                        </span>
                      </div>
                    </td>

                    {/* Strike */}
                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                      ${pos.strikeDisplay.toLocaleString()}
                    </td>

                    {/* Expiry */}
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {fmtExpiry(pos.expiryDate)}
                    </td>

                    {/* Qty */}
                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                      {pos.quantityDisplay.toFixed(2)}
                    </td>

                    {/* Premium */}
                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                      ${pos.premiumDisplay.toFixed(2)}
                    </td>

                    {/* Outcome */}
                    <td className="px-3 py-2.5 text-center">
                      {outcomeBadge(pos.outcomeLabel)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
