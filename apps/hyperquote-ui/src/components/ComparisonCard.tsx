"use client";

import { QuoteWithMeta, AMMEstimate, Token } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAmount, cn, safeSymbol } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";

interface ComparisonCardProps {
  rfqQuote: QuoteWithMeta | null;
  ammEstimate: AMMEstimate | null;
  tokenIn: Token;
  tokenOut: Token;
}

export function ComparisonCard({
  rfqQuote,
  ammEstimate,
  tokenIn,
  tokenOut,
}: ComparisonCardProps) {
  // Calculate comparison
  const hasComparison = rfqQuote && ammEstimate && ammEstimate.amountOut > 0n;

  let advantage: {
    absoluteDiff: bigint;
    percentageDiff: number;
    isBetter: boolean;
  } | null = null;

  if (hasComparison) {
    const diff = rfqQuote.amountOut - ammEstimate.amountOut;
    const percentageDiff =
      ammEstimate.amountOut > 0n
        ? (Number(diff) / Number(ammEstimate.amountOut)) * 100
        : 0;

    advantage = {
      absoluteDiff: diff,
      percentageDiff,
      isBetter: diff > 0n,
    };
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          RFQ vs AMM Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* RFQ Quote */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-primary">RFQ Quote</span>
            {rfqQuote ? (
              <Badge variant="outline" className="font-mono">
                {formatAmount(rfqQuote.amountOut, tokenOut.decimals)} {safeSymbol(tokenOut)}
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">No quote</span>
            )}
          </div>
          {rfqQuote && (
            <div className="text-xs text-muted-foreground">
              Fee: {formatAmount(rfqQuote.feeAmount, tokenIn.decimals)} {safeSymbol(tokenIn)} (2.5 bps)
            </div>
          )}
        </div>

        {/* AMM Estimate */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              AMM Estimate
            </span>
            {ammEstimate ? (
              <Badge variant="secondary" className="font-mono">
                {formatAmount(ammEstimate.amountOut, tokenOut.decimals)} {safeSymbol(tokenOut)}
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">Calculating...</span>
            )}
          </div>
          {ammEstimate && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>Price Impact: {ammEstimate.priceImpact.toFixed(2)}%</span>
              <span>•</span>
              <span>Source: {ammEstimate.source}</span>
            </div>
          )}
        </div>

        {/* Comparison Result */}
        {advantage && (
          <div
            className={cn(
              "pt-3 border-t border-border/50",
              advantage.isBetter ? "text-success" : "text-destructive"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {advantage.isBetter ? (
                  <TrendingUp className="h-4 w-4" />
                ) : advantage.percentageDiff === 0 ? (
                  <Minus className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                <span className="text-sm font-medium">
                  RFQ is {advantage.isBetter ? "better" : "worse"} by
                </span>
              </div>
              <div className="text-right">
                <div className="font-mono font-medium">
                  {advantage.isBetter ? "+" : ""}
                  {formatAmount(advantage.absoluteDiff, tokenOut.decimals)} {safeSymbol(tokenOut)}
                </div>
                <div className="text-xs opacity-80">
                  ({advantage.isBetter ? "+" : ""}
                  {advantage.percentageDiff.toFixed(2)}%)
                </div>
              </div>
            </div>
          </div>
        )}

        {!hasComparison && (rfqQuote || ammEstimate) && (
          <div className="pt-3 border-t border-border/50 text-center text-sm text-muted-foreground">
            {!rfqQuote && "Waiting for RFQ quote..."}
            {!ammEstimate && "Calculating AMM estimate..."}
          </div>
        )}

        {!rfqQuote && !ammEstimate && (
          <div className="text-center text-sm text-muted-foreground py-2">
            Request a quote to see comparison
          </div>
        )}
      </CardContent>
    </Card>
  );
}
