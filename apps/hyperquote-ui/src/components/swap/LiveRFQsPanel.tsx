"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  QuoteKind,
  type Token,
  type RFQQuote,
  type QuoteWithMeta,
} from "@/types";
import { type TrackedRFQ } from "@/hooks/useRFQ";
import { type MidPriceRef } from "@/lib/benchmark";
import { formatAmount, cn, safeSymbol } from "@/lib/utils";
import { LiveRFQRow } from "./LiveRFQRow";

// ---------------------------------------------------------------------------
// LiveRFQsPanel
// ---------------------------------------------------------------------------

export function LiveRFQsPanel({
  trackedRequests,
  currentRequestId,
  onCancel,
  enrichedQuotes,
  bestQuote,
  selectedQuoteSignature,
  onSelectQuote,
  receivedQuotes,
  validationResults,
  tokenIn,
  tokenOut,
  selectedRfqId,
  onSelectRfq,
  baselineAmountOut,
  midPriceRef,
}: {
  trackedRequests: TrackedRFQ[];
  currentRequestId: string | null;
  onCancel: (requestId: string) => void;
  enrichedQuotes: QuoteWithMeta[];
  bestQuote: QuoteWithMeta | null;
  selectedQuoteSignature: string | null;
  onSelectQuote: (q: RFQQuote) => void;
  receivedQuotes: RFQQuote[];
  validationResults: Map<string, { status: string }>;
  tokenIn: Token | null;
  tokenOut: Token | null;
  selectedRfqId: string | null;
  onSelectRfq: (id: string) => void;
  baselineAmountOut?: string | null;
  midPriceRef?: MidPriceRef | null;
}) {
  const [showPast, setShowPast] = useState(false);

  const activeRFQs = trackedRequests.filter((t) => t.status === "active");
  const pastRFQs = trackedRequests.filter((t) => t.status !== "active");
  const hasActiveRFQ = activeRFQs.length > 0;

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Your Live RFQs
          {activeRFQs.length > 0 && (
            <Badge variant="outline" className="ml-auto text-xs font-mono">
              {activeRFQs.length} active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {activeRFQs.length === 0 && pastRFQs.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">
            No RFQs created yet. Submit a request to get started.
          </p>
        )}

        {activeRFQs.length === 0 && pastRFQs.length > 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No active RFQs
          </p>
        )}

        {/* Active RFQs */}
        {activeRFQs.map((t) => (
          <LiveRFQRow
            key={t.request.id}
            tracked={t}
            isCurrent={t.request.id === currentRequestId}
            isSelected={t.request.id === selectedRfqId}
            onCancel={onCancel}
            onSelect={() => onSelectRfq(t.request.id)}
          />
        ))}

        {/* ── Maker Quotes section ── */}
        {hasActiveRFQ && (
          <div className="pt-2 mt-1 border-t border-border/30">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Maker Quotes
              </span>
            </div>

            {enrichedQuotes.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 px-2 rounded-lg bg-muted/30">
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                Waiting for maker quotes…
              </div>
            ) : (
              <div className="space-y-1.5">
                {/* Show best quote prominently */}
                {bestQuote && tokenIn && tokenOut && (() => {
                  // Compute vs baseline for best quote
                  let vsBaselineLabel: React.ReactNode = null;
                  if (baselineAmountOut) {
                    const bl = BigInt(baselineAmountOut);
                    if (bl > 0n) {
                      const diff = bestQuote.amountOut - bl;
                      const pctDiff = Number(diff) / Number(bl) * 100;
                      const isPos = pctDiff > 0;
                      const isNeutral = Math.abs(pctDiff) < 0.01;
                      vsBaselineLabel = (
                        <span className={cn(
                          "font-mono",
                          isNeutral ? "text-muted-foreground" : isPos ? "text-emerald-500" : "text-muted-foreground/60"
                        )}>
                          {isNeutral ? "≈ baseline" : `${isPos ? "+" : ""}${pctDiff.toFixed(2)}%`}
                        </span>
                      );
                    }
                  }

                  return (
                    <div
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs cursor-pointer transition-colors",
                        selectedQuoteSignature === bestQuote.signature
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/30 bg-card/50 hover:border-border/60"
                      )}
                      onClick={() => {
                        const raw = receivedQuotes.find((q) => q.signature === bestQuote.signature);
                        if (raw) onSelectQuote(raw);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
                          Best
                        </Badge>
                        <span className="font-mono text-muted-foreground">
                          {bestQuote.maker.slice(0, 6)}…{bestQuote.maker.slice(-4)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">
                          {formatAmount(bestQuote.amountOut, tokenOut.decimals, 2)} {safeSymbol(tokenOut)}
                        </span>
                        {vsBaselineLabel}
                      </div>
                    </div>
                  );
                })()}
                {/* Additional quotes count */}
                {enrichedQuotes.length > 1 && (
                  <p className="text-[11px] text-muted-foreground pl-1">
                    +{enrichedQuotes.length - 1} more quote{enrichedQuotes.length - 1 !== 1 ? "s" : ""} received
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Past RFQs (collapsed) */}
        {pastRFQs.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowPast((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {showPast ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Past RFQs ({pastRFQs.length})
            </button>
            {showPast && (
              <div className="space-y-2 mt-2">
                {pastRFQs.map((t) => (
                  <LiveRFQRow
                    key={t.request.id}
                    tracked={t}
                    isCurrent={false}
                    onCancel={onCancel}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
