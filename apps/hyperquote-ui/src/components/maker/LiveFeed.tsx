"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RFQRow } from "./RFQRow";
import { QuoteKind, RFQRequest } from "@/types";
import { cn, safeSymbol } from "@/lib/utils";
import { Filter, Radio, Inbox } from "lucide-react";
import type { ConnectionStatus } from "@/lib/makerRelay";

interface LiveFeedProps {
  requests: RFQRequest[];
  relayStatus: ConnectionStatus;
  relayEnabled: boolean;
  onRespond: (request: RFQRequest) => void;
}

export function LiveFeed({
  requests,
  relayStatus,
  relayEnabled,
  onRespond,
}: LiveFeedProps) {
  // Filters
  const [pairFilter, setPairFilter] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | "exact_in" | "exact_out">("all");
  const [minSizeFilter, setMinSizeFilter] = useState("");

  // Unique pairs for filter dropdown
  const uniquePairs = useMemo(() => {
    const pairs = new Set<string>();
    requests.forEach((r) => pairs.add(`${safeSymbol(r.tokenIn)}/${safeSymbol(r.tokenOut)}`));
    return Array.from(pairs);
  }, [requests]);

  // Filtered requests — only public, not expired
  const filtered = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return requests.filter((r) => {
      // Only public
      if (r.visibility !== "public") return false;
      // Not expired
      if (r.expiry <= now) return false;
      // Pair filter
      if (pairFilter && pairFilter !== "all") {
        const pair = `${safeSymbol(r.tokenIn)}/${safeSymbol(r.tokenOut)}`;
        if (pair !== pairFilter) return false;
      }
      // Mode filter
      if (modeFilter === "exact_in" && r.kind !== QuoteKind.EXACT_IN) return false;
      if (modeFilter === "exact_out" && r.kind !== QuoteKind.EXACT_OUT) return false;
      return true;
    });
  }, [requests, pairFilter, modeFilter]);

  // Status indicator
  const statusColor = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-500 animate-pulse",
    disconnected: "bg-zinc-500",
    error: "bg-red-500",
  }[relayStatus];

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Filter className="h-3 w-3" />
          Filters
        </div>

        {/* Pair */}
        <Select value={pairFilter || "all"} onValueChange={(v) => setPairFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue placeholder="All pairs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All pairs</SelectItem>
            {uniquePairs.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Relay Status */}
        {relayEnabled && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio className="h-3 w-3" />
            <div className={cn("h-2 w-2 rounded-full", statusColor)} />
            <span className="capitalize">{relayStatus}</span>
          </div>
        )}

        {!relayEnabled && (
          <Badge variant="outline" className="text-[10px]">
            Relay Off — Import Only
          </Badge>
        )}
      </div>

      {/* Feed */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((r) => (
            <RFQRow key={r.id} request={r} onRespond={() => onRespond(r)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground font-medium">
            {relayEnabled
              ? "No live requests yet"
              : "Import a request to get started"}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {relayEnabled
              ? "Public RFQs will appear here in real-time"
              : "Enable the relay or paste a request JSON above"}
          </p>
        </div>
      )}
    </div>
  );
}
