"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import { QuoteKind, RFQRequest } from "@/types";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import { Clock, ArrowRight, MessageSquare } from "lucide-react";

interface RFQRowProps {
  request: RFQRequest;
  onRespond: () => void;
}

export function RFQRow({ request, onRespond }: RFQRowProps) {
  const { formattedTime, isExpired, isUrgent } = useQuoteExpiry(request.expiry);
  const isExactIn = request.kind === QuoteKind.EXACT_IN;

  const fixedToken = isExactIn ? request.tokenIn : request.tokenOut;
  const fixedAmount = isExactIn ? request.amountIn : request.amountOut;
  const floatingToken = isExactIn ? request.tokenOut : request.tokenIn;

  if (isExpired) return null;

  return (
    <div
      className={cn(
        "group relative rounded-xl border p-4 transition-all duration-200",
        "hover:border-primary/40 hover:bg-primary/[0.02]",
        isUrgent && "border-warning/40 bg-warning/[0.02]"
      )}
    >
      <div className="flex items-center gap-4">
        {/* Pair */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <span className="font-semibold text-sm">
            {safeSymbol(request.tokenIn)}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm">
            {safeSymbol(request.tokenOut)}
          </span>
        </div>

        {/* Mode */}
        <Badge
          variant={isExactIn ? "default" : "secondary"}
          className="shrink-0 text-[10px] px-2 py-0"
        >
          {isExactIn ? "Exact In" : "Exact Out"}
        </Badge>

        {/* Fixed Amount */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-mono truncate">
            {fixedAmount
              ? formatAmount(fixedAmount, fixedToken.decimals, 4)
              : "—"}{" "}
            <span className="text-muted-foreground">{safeSymbol(fixedToken)}</span>
          </span>
        </div>

        {/* Constraint */}
        <div className="hidden md:block text-xs text-muted-foreground min-w-[120px] truncate">
          {isExactIn && request.minOut && request.minOut > 0n ? (
            <>
              min: {formatAmount(request.minOut, request.tokenOut.decimals, 2)}{" "}
              {safeSymbol(request.tokenOut)}
            </>
          ) : !isExactIn && request.maxIn && request.maxIn < BigInt("0xffffffffffffffffffff") ? (
            <>
              max: {formatAmount(request.maxIn, request.tokenIn.decimals, 2)}{" "}
              {safeSymbol(request.tokenIn)}
            </>
          ) : (
            <span className="text-muted-foreground/50">no constraint</span>
          )}
        </div>

        {/* Taker */}
        <div className="hidden lg:block text-xs font-mono text-muted-foreground min-w-[90px]">
          {formatAddress(request.taker, 4)}
        </div>

        {/* TTL */}
        <div
          className={cn(
            "flex items-center gap-1 text-sm font-mono min-w-[60px] justify-end",
            isUrgent
              ? "text-warning animate-pulse"
              : "text-muted-foreground"
          )}
        >
          <Clock className="h-3 w-3" />
          {formattedTime}
        </div>

        {/* Respond */}
        <Button
          size="sm"
          onClick={onRespond}
          className="shrink-0 gap-1.5"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Respond
        </Button>
      </div>
    </div>
  );
}
