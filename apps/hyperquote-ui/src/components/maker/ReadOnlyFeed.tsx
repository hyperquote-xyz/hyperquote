"use client";

import { useMemo, useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuoteKind, RFQRequest, requestToJSON } from "@/types";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import { Radio, Inbox, ArrowRight, Clock, Copy, Check } from "lucide-react";
import type { ConnectionStatus } from "@/lib/makerRelay";

const MAX_FEED_SIZE = 50;

interface ReadOnlyFeedProps {
  requests: RFQRequest[];
  relayStatus: ConnectionStatus;
}

export function ReadOnlyFeed({ requests, relayStatus }: ReadOnlyFeedProps) {
  const visible = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return requests
      .filter((r) => r.visibility === "public" && r.expiry > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_FEED_SIZE);
  }, [requests]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            Live RFQ Feed
          </CardTitle>
          <ConnectionBadge status={relayStatus} />
        </div>
      </CardHeader>
      <CardContent>
        {visible.length > 0 ? (
          <div className="space-y-2">
            {visible.map((r) => (
              <ReadOnlyRow key={r.id} request={r} />
            ))}
          </div>
        ) : (
          <EmptyState relayStatus={relayStatus} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connection badge
// ---------------------------------------------------------------------------

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const config: Record<
    ConnectionStatus,
    {
      label: string;
      dotClass: string;
      badgeVariant: "default" | "secondary" | "outline" | "destructive";
    }
  > = {
    connected: {
      label: "Connected",
      dotClass: "bg-emerald-500",
      badgeVariant: "default",
    },
    connecting: {
      label: "Reconnecting",
      dotClass: "bg-amber-500 animate-pulse",
      badgeVariant: "secondary",
    },
    disconnected: {
      label: "Disconnected",
      dotClass: "bg-zinc-500",
      badgeVariant: "outline",
    },
    error: {
      label: "Disconnected",
      dotClass: "bg-red-500",
      badgeVariant: "destructive",
    },
  };

  const c = config[status];

  return (
    <Badge
      variant={c.badgeVariant}
      className="gap-1.5 text-[10px] px-2 py-0.5"
    >
      <span
        className={cn("inline-block h-1.5 w-1.5 rounded-full", c.dotClass)}
      />
      {c.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Single row — read-only, no Respond button
// ---------------------------------------------------------------------------

function ReadOnlyRow({ request }: { request: RFQRequest }) {
  const { formattedTime, isExpired, isUrgent } = useQuoteExpiry(
    request.expiry
  );
  const [copied, setCopied] = useState(false);

  const isExactIn = request.kind === QuoteKind.EXACT_IN;
  const fixedToken = isExactIn ? request.tokenIn : request.tokenOut;
  const fixedAmount = isExactIn ? request.amountIn : request.amountOut;

  const handleCopy = useCallback(() => {
    const json = JSON.stringify(requestToJSON(request), null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [request]);

  if (isExpired) return null;

  return (
    <div
      className={cn(
        "relative rounded-xl border p-4 transition-all duration-200",
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

        {/* Amount */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-mono truncate">
            {fixedAmount
              ? formatAmount(fixedAmount, fixedToken.decimals, 4)
              : "—"}{" "}
            <span className="text-muted-foreground">{safeSymbol(fixedToken)}</span>
          </span>
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

        {/* Copy JSON */}
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopy}
          className="shrink-0 gap-1.5"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-success" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy RFQ
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ relayStatus }: { relayStatus: ConnectionStatus }) {
  const isConnected = relayStatus === "connected";

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground font-medium">
        {isConnected
          ? "No live requests yet"
          : "Waiting for relay connection…"}
      </p>
      <p className="text-xs text-muted-foreground/60 mt-1">
        {isConnected
          ? "Public RFQs will appear here in real-time"
          : "The feed will populate once the relay connects"}
      </p>
    </div>
  );
}
