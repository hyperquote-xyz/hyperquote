"use client";

import { QuoteWithMeta, QuoteKind, Token, QuoteValidationResult, QuoteValidationStatus } from "@/types";
import { type MidPriceRef, impactExactIn } from "@/lib/benchmark";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  User,
  XCircle,
  Lock,
  Loader2,
  ShieldCheck,
  ShieldX,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface QuoteCardProps {
  quote: QuoteWithMeta;
  tokenIn: Token;
  tokenOut: Token;
  validation?: QuoteValidationResult;
  isSelected?: boolean;
  isBest?: boolean;
  onSelect: () => void;
  /** AMM baseline amountOut (raw string) for "vs baseline" comparison */
  baselineAmountOut?: string | null;
  /** Universal mid-price benchmark for "vs Mid-Price" comparison */
  midPriceRef?: MidPriceRef | null;
}

/** Map validation status to visual config */
function getValidationDisplay(status: QuoteValidationStatus) {
  switch (status) {
    case "validating":
      return { icon: Loader2, label: "Validating…", color: "text-muted-foreground", bg: "bg-muted/30", spin: true };
    case "valid":
      return { icon: ShieldCheck, label: "Valid", color: "text-emerald-500", bg: "bg-emerald-500/10", spin: false };
    case "expiring_soon":
      return { icon: AlertTriangle, label: "Expiring Soon", color: "text-amber-500", bg: "bg-amber-500/10", spin: false };
    case "invalid_signature":
      return { icon: ShieldX, label: "Invalid Signature", color: "text-red-500", bg: "bg-red-500/10", spin: false };
    case "expired":
      return { icon: XCircle, label: "Expired", color: "text-red-500", bg: "bg-red-500/10", spin: false };
    case "needs_approval":
      return { icon: Lock, label: "Needs Approval", color: "text-amber-500", bg: "bg-amber-500/10", spin: false };
    case "structural_mismatch":
      return { icon: XCircle, label: "Mismatch", color: "text-red-500", bg: "bg-red-500/10", spin: false };
    case "error":
      return { icon: AlertCircle, label: "Error", color: "text-red-500", bg: "bg-red-500/10", spin: false };
    default:
      return { icon: Loader2, label: "…", color: "text-muted-foreground", bg: "bg-muted/30", spin: true };
  }
}

function isFillable(status?: QuoteValidationStatus): boolean {
  return status === "valid" || status === "expiring_soon" || status === "needs_approval";
}

export function QuoteCard({
  quote,
  tokenIn,
  tokenOut,
  validation,
  isSelected,
  isBest,
  onSelect,
  baselineAmountOut,
  midPriceRef,
}: QuoteCardProps) {
  const { formattedTime, isExpired, isUrgent, isExpiringSoon } = useQuoteExpiry(quote.expiry);
  const vStatus = validation?.status ?? "validating";
  const vDisplay = getValidationDisplay(vStatus);
  const canSelect = isFillable(vStatus) && !isExpired;

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-all duration-200",
        canSelect && "cursor-pointer hover:border-primary/50",
        isSelected && canSelect && "border-primary ring-2 ring-primary/20",
        !canSelect && "opacity-60",
        (vStatus === "invalid_signature" || vStatus === "structural_mismatch") && "opacity-40 pointer-events-none",
        // Expiry visual escalation
        isExpired && "border-red-500/40 opacity-50",
        isUrgent && !isExpired && "border-red-500/50 animate-pulse",
        isExpiringSoon && "border-amber-500/50"
      )}
      onClick={() => canSelect && onSelect()}
    >
      {isBest && canSelect && (
        <div className="absolute top-0 right-0">
          <Badge className="rounded-none rounded-bl-lg bg-success text-success-foreground">
            Best Price
          </Badge>
        </div>
      )}

      <CardContent className="p-4 space-y-3">
        {/* Maker, Validation Badge & Expiry */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="font-mono">{formatAddress(quote.maker, 6)}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Validation Badge */}
            <div className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded-full", vDisplay.bg, vDisplay.color)}>
              <vDisplay.icon className={cn("h-3 w-3", vDisplay.spin && "animate-spin")} />
              <span>{vDisplay.label}</span>
            </div>
            {/* Timer */}
            <div
              className={cn(
                "flex items-center gap-1.5 text-sm",
                isExpired
                  ? "text-destructive"
                  : isUrgent
                    ? "text-red-500 animate-countdown-pulse"
                    : isExpiringSoon
                      ? "text-amber-500"
                      : "text-muted-foreground"
              )}
            >
              <Clock className="h-4 w-4" />
              <span className="font-mono">{formattedTime}</span>
            </div>
          </div>
        </div>

        {/* Amounts */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">You Pay</span>
            <span className="font-medium">
              {formatAmount(quote.amountIn, tokenIn.decimals)} {safeSymbol(tokenIn)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">You Receive</span>
            <span className="font-medium text-success">
              {formatAmount(quote.amountOut, tokenOut.decimals)} {safeSymbol(tokenOut)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Fee (2.5 bps)</span>
            <span className="text-muted-foreground">
              {formatAmount(quote.feeAmount, tokenIn.decimals)} {safeSymbol(tokenIn)}
            </span>
          </div>
        </div>

        {/* Price */}
        <div className="pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Rate</span>
            <span className="font-mono">
              1 {safeSymbol(tokenIn)} = {quote.price.toFixed(6)} {safeSymbol(tokenOut)}
            </span>
          </div>
        </div>

        {/* vs Baseline */}
        {baselineAmountOut && (() => {
          const baseline = BigInt(baselineAmountOut);
          if (baseline <= 0n) return null;
          const diff = quote.amountOut - baseline;
          const pctDiff = Number(diff) / Number(baseline) * 100;
          const isPositive = pctDiff > 0;
          const isNeutral = Math.abs(pctDiff) < 0.01;

          return (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">vs AMM Baseline</span>
              <div className={cn(
                "flex items-center gap-1 font-mono",
                isNeutral ? "text-muted-foreground" : isPositive ? "text-emerald-500" : "text-muted-foreground/60"
              )}>
                {!isNeutral && (isPositive ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                ))}
                <span>
                  {isNeutral ? "≈ same" : `${isPositive ? "+" : ""}${pctDiff.toFixed(2)}%`}
                </span>
              </div>
            </div>
          );
        })()}

        {/* vs Mid-Price — universal benchmark */}
        {midPriceRef && midPriceRef.referenceOut > 0n && (() => {
          const impact = impactExactIn(midPriceRef.referenceOut, quote.amountOut);
          return (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">vs Mid-Price</span>
              <span className="font-mono text-muted-foreground">
                {impact.toFixed(2)}%
              </span>
            </div>
          );
        })()}

        {/* Status Footer */}
        {isSelected && canSelect && (
          <div className="flex items-center justify-center gap-2 pt-2 text-primary">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Selected</span>
          </div>
        )}

        {/* Validation error messages */}
        {validation?.message && (vStatus === "invalid_signature" || vStatus === "structural_mismatch" || vStatus === "error") && (
          <div className="flex items-center gap-2 pt-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span>{validation.message}</span>
          </div>
        )}

        {vStatus === "needs_approval" && (
          <div className="flex items-center gap-2 pt-2 text-xs text-amber-500">
            <Lock className="h-3 w-3 shrink-0" />
            <span>Token approval required before filling</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
