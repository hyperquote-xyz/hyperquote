"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import {
  Clock,
  CheckCircle2,
  User,
} from "lucide-react";
import { Token } from "@/types";
import type { OptionQuoteWithMeta } from "@/types/options";

interface OptionsQuoteCardProps {
  quote: OptionQuoteWithMeta;
  collateral: Token;
  underlying: Token;
  isSelected?: boolean;
  isBest?: boolean;
  onSelect: () => void;
}

export function OptionsQuoteCard({
  quote,
  collateral,
  underlying,
  isSelected,
  isBest,
  onSelect,
}: OptionsQuoteCardProps) {
  const { formattedTime, isExpired, isUrgent } = useQuoteExpiry(quote.deadline);
  const canSelect = !isExpired;

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-all duration-200",
        canSelect && "cursor-pointer hover:border-primary/50",
        isSelected && canSelect && "border-primary ring-2 ring-primary/20",
        !canSelect && "opacity-60",
      )}
      onClick={() => canSelect && onSelect()}
    >
      {isBest && canSelect && (
        <div className="absolute top-0 right-0">
          <Badge className="rounded-none rounded-bl-lg bg-success text-success-foreground">
            Best Premium
          </Badge>
        </div>
      )}

      <CardContent className="p-4 space-y-3">
        {/* Maker & Expiry */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="font-mono">{formatAddress(quote.maker, 6)}</span>
          </div>
          <div
            className={cn(
              "flex items-center gap-1.5 text-sm",
              isExpired
                ? "text-destructive"
                : isUrgent
                  ? "text-warning animate-countdown-pulse"
                  : "text-muted-foreground",
            )}
          >
            <Clock className="h-4 w-4" />
            <span className="font-mono">{formattedTime}</span>
          </div>
        </div>

        {/* Premium & Collateral */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Premium</span>
            <span className="font-medium text-success">
              {formatAmount(quote.premium, collateral.decimals)}{" "}
              {safeSymbol(collateral)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {quote.isCall ? "Underlying Locked" : "Collateral Locked"}
            </span>
            <span className="font-medium">
              {quote.isCall
                ? `${formatAmount(quote.collateralRequired, underlying.decimals)} ${safeSymbol(underlying)}`
                : `${formatAmount(quote.collateralRequired, collateral.decimals)} ${safeSymbol(collateral)}`}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Strike</span>
            <span className="font-mono">
              {formatAmount(quote.strike, 18)} {safeSymbol(collateral)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-muted-foreground">Quantity</span>
            <span className="font-mono">
              {formatAmount(quote.quantity, 18)} {safeSymbol(underlying)}
            </span>
          </div>
        </div>

        {/* Selected indicator */}
        {isSelected && canSelect && (
          <div className="flex items-center justify-center gap-2 pt-2 text-primary">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Selected</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
