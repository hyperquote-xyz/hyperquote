"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Clock,
  Lock,
  CheckCircle2,
  Ban,
  X,
} from "lucide-react";
import { QuoteKind, type Token } from "@/types";
import { type TrackedRFQ } from "@/hooks/useRFQ";
import { useCountdown } from "@/hooks/useCountdown";
import { formatAmount, cn, safeSymbol } from "@/lib/utils";

// ---------------------------------------------------------------------------
// LiveRFQRow
// ---------------------------------------------------------------------------

export function LiveRFQRow({
  tracked,
  isCurrent,
  isSelected,
  onCancel,
  onSelect,
}: {
  tracked: TrackedRFQ;
  isCurrent: boolean;
  isSelected?: boolean;
  onCancel: (requestId: string) => void;
  onSelect?: () => void;
}) {
  const { request, status, quoteCount } = tracked;
  const { secondsLeft, isExpired, isUrgent, isExpiringSoon } = useCountdown(request.expiry);

  const isActive = status === "active";

  // Format countdown
  const ttlLabel = (() => {
    if (!isActive) return null;
    if (isExpired) return "Expired";
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
  })();

  // Status badge
  const statusBadge = (() => {
    switch (status) {
      case "active":
        return (
          <Badge variant="outline" className={cn(
            "text-[10px] font-mono",
            isUrgent && "border-red-500/50 text-red-500 animate-pulse",
            isExpiringSoon && !isUrgent && "border-amber-500/50 text-amber-500"
          )}>
            <Clock className="h-2.5 w-2.5 mr-1" />
            {ttlLabel}
          </Badge>
        );
      case "filled":
        return (
          <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/50 text-emerald-500">
            <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
            Filled
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="outline" className="text-[10px] font-mono border-muted-foreground/30 text-muted-foreground">
            <Ban className="h-2.5 w-2.5 mr-1" />
            Cancelled
          </Badge>
        );
      case "expired":
        return (
          <Badge variant="outline" className="text-[10px] font-mono border-muted-foreground/30 text-muted-foreground">
            <Clock className="h-2.5 w-2.5 mr-1" />
            Expired
          </Badge>
        );
    }
  })();

  // Human-readable amount
  const amountLabel = (() => {
    if (request.kind === QuoteKind.EXACT_IN && request.amountIn != null) {
      return `${formatAmount(request.amountIn, request.tokenIn.decimals)} ${safeSymbol(request.tokenIn)}`;
    }
    if (request.kind === QuoteKind.EXACT_OUT && request.amountOut != null) {
      return `${formatAmount(request.amountOut, request.tokenOut.decimals)} ${safeSymbol(request.tokenOut)}`;
    }
    return "—";
  })();

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        isSelected
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
          : "border-border/30 bg-card/50",
        isActive && "cursor-pointer hover:border-primary/30",
        !isActive && "opacity-60",
        // Expiry visual escalation
        isActive && isUrgent && !isSelected && "border-red-500/40",
        isActive && isExpiringSoon && !isUrgent && !isSelected && "border-amber-500/30"
      )}
      onClick={() => {
        if (isActive && onSelect) onSelect();
      }}
    >
      {/* Pair + mode */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate">
            {safeSymbol(request.tokenIn)} → {safeSymbol(request.tokenOut)}
          </span>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 shrink-0"
          >
            {request.kind === QuoteKind.EXACT_IN ? "In" : "Out"}
          </Badge>
          {request.visibility === "private" && (
            <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <span className="font-mono">{amountLabel}</span>
          {quoteCount > 0 && (
            <>
              <span>·</span>
              <span>{quoteCount} quote{quoteCount !== 1 ? "s" : ""}</span>
            </>
          )}
        </div>
      </div>

      {/* Status badge */}
      {statusBadge}

      {/* Cancel button */}
      {isActive && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(request.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Cancel this RFQ</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
