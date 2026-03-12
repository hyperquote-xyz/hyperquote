"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, ArrowRight, Info } from "lucide-react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// HyperQuote RFQ (Beta) Widget
// ---------------------------------------------------------------------------
// A compact action widget encouraging users to try HyperQuote RFQ.
// Surfaces Derive mid/mark IV context to help set premium.
// Does NOT display HQ volume/prints since none exist yet.

interface HQRfqWidgetProps {
  /** Current Derive spot price for underlying. */
  spot: number | null;
  underlying: string;
}

export function HQRfqWidget({ spot, underlying }: HQRfqWidgetProps) {
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-primary" />
          HyperQuote RFQ
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-primary/40 text-primary ml-1"
          >
            Beta
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Context */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            Request an on-chain options quote from HyperQuote makers on HyperEVM.
            Settle physically at expiry — no intermediaries.
          </p>
          {spot != null && (
            <div className="flex items-center gap-1 mt-1">
              <Info className="h-3 w-3 shrink-0" />
              <span>
                Derive {underlying} spot:{" "}
                <span className="font-mono text-foreground">
                  ${spot.toLocaleString()}
                </span>
                {" "}— use Derive mark IV to set your min premium.
              </span>
            </div>
          )}
        </div>

        {/* CTA */}
        <Link href="/options">
          <Button size="sm" className="w-full gap-2">
            Open RFQ Builder
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>

        {/* Status */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
          <span>
            Waiting for on-chain activity — HyperQuote prints will appear in
            the trade tape once there are executions.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
