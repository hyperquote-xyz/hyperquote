"use client";

import { useState, useMemo, useEffect, useCallback, memo } from "react";
import {
  useFeedStream,
  type FeedRfqItem,
  type FeedRfqStatus,
} from "@/hooks/useFeedStream";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { secondsUntilExpiry } from "@/lib/utils";
import {
  formatAddress,
  cn,
  safeFormatTokenAmount,
  formatCompactUsd,
} from "@/lib/utils";
import {
  Radio,
  ArrowRight,
  Clock,
  Search,
  Inbox,
} from "lucide-react";
import { useFeedNotionals } from "@/hooks/useFeedNotionals";
import { MOCK_MODE } from "@/lib/mockMode";
import {
  buildMockFeedItems,
  generateMockRfq,
  MOCK_FEED_NOTIONALS,
} from "@/lib/mockFeedData";
import { STATUS_BADGE } from "./constants";
import {
  TokenFilterBar,
  ALL_FILTER_SYMBOLS,
  buildMatchSet,
} from "./TokenFilterBar";

import { RfqDetailDrawer } from "./RfqDetailDrawer";

// ---------------------------------------------------------------------------
// Size filter types
// ---------------------------------------------------------------------------

type SizeFilter = "all" | "25k" | "100k" | "250k";

const SIZE_THRESHOLDS: Record<SizeFilter, number> = {
  all: 0,
  "25k": 25_000,
  "100k": 100_000,
  "250k": 250_000,
};

const SIZE_LABELS: Record<SizeFilter, string> = {
  all: "All Sizes",
  "25k": "\u2265 $25k",
  "100k": "\u2265 $100k",
  "250k": "\u2265 $250k",
};

// ---------------------------------------------------------------------------
// FeedTable — main component (NO per-second tick at this level)
// ---------------------------------------------------------------------------

const EMPTY_ITEMS: FeedRfqItem[] = [];

export function FeedTable() {
  // Mock mode state — declared before other hooks (rules of hooks)
  const [mockItems, setMockItems] = useState<FeedRfqItem[]>(() =>
    MOCK_MODE ? buildMockFeedItems() : []
  );
  const [mockNotionals, setMockNotionals] = useState<Map<string, number | null>>(
    () => MOCK_MODE ? new Map(MOCK_FEED_NOTIONALS) : new Map()
  );

  // Always call hooks unconditionally (React rules)
  const stream = useFeedStream();
  // IMPORTANT: use a stable empty array reference in mock mode to avoid
  // triggering useFeedNotionals' effect on every render (new [] each time).
  const realNotionals = useFeedNotionals(MOCK_MODE ? EMPTY_ITEMS : stream.items);

  // Resolve which data source to use
  const items = MOCK_MODE ? mockItems : stream.items;
  const connected = MOCK_MODE ? true : stream.connected;
  const notionals = MOCK_MODE ? mockNotionals : realNotionals;

  const [statusFilter, setStatusFilter] = useState<"all" | FeedRfqStatus>("all");
  const [tokenSearch, setTokenSearch] = useState("");
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("all");
  const [selectedRfq, setSelectedRfq] = useState<FeedRfqItem | null>(null);

  // Core token filter — all 5 selected by default
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(
    () => new Set(ALL_FILTER_SYMBOLS)
  );

  const handleTokenToggle = useCallback((symbol: string) => {
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        // Don't allow deselecting the last remaining token — reset to all
        if (next.size === 1) {
          return new Set(ALL_FILTER_SYMBOLS);
        }
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  }, []);

  // Simulated SSE updates in mock mode
  useEffect(() => {
    if (!MOCK_MODE) return;

    const interval = setInterval(() => {
      setMockItems((prev) => {
        // 40% chance: transition an existing OPEN item
        const openItems = prev.filter((i) => i.status === "OPEN");
        if (openItems.length > 0 && Math.random() < 0.4) {
          const target = openItems[Math.floor(Math.random() * openItems.length)];
          const newStatus: FeedRfqStatus = Math.random() < 0.6 ? "FILLED" : "EXPIRED";
          return prev.map((i) =>
            i.id === target.id
              ? {
                  ...i,
                  status: newStatus,
                  ...(newStatus === "FILLED" && {
                    fillTxHash: `0x${target.id.replace(/[^0-9a-f]/g, "").padEnd(64, "0")}`,
                  }),
                }
              : i
          );
        }

        // 60% chance: insert a new OPEN RFQ at the top
        const { item, notionalUsd } = generateMockRfq();
        setMockNotionals((n) => new Map(n).set(item.id, notionalUsd));
        return [item, ...prev.slice(0, 49)]; // cap at 50 items
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    const threshold = SIZE_THRESHOLDS[sizeFilter];

    // Build the set of lowercase symbols that pass the core token filter.
    // When all tokens are selected we skip the token filter entirely for
    // maximum throughput (common case).
    const allSelected = selectedTokens.size === ALL_FILTER_SYMBOLS.size;
    const matchSet = allSelected ? null : buildMatchSet(selectedTokens);

    return items.filter((item) => {
      // Core token filter
      if (matchSet) {
        const inSym = (item.tokenIn?.symbol ?? "").toLowerCase();
        const outSym = (item.tokenOut?.symbol ?? "").toLowerCase();
        if (!matchSet.has(inSym) && !matchSet.has(outSym)) return false;
      }
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (tokenSearch) {
        const q = tokenSearch.toLowerCase();
        const inSym = (item.tokenIn?.symbol ?? "").toLowerCase();
        const outSym = (item.tokenOut?.symbol ?? "").toLowerCase();
        if (!inSym.includes(q) && !outSym.includes(q)) return false;
      }
      // Size filter: only hide items with a known USD value below threshold.
      // Items with unknown USD (null) are always shown.
      if (threshold > 0) {
        const usd = notionals.get(item.id);
        if (usd != null && usd < threshold) return false;
      }
      return true;
    });
  }, [items, statusFilter, tokenSearch, sizeFilter, notionals, selectedTokens]);

  const handleRowClick = useCallback((item: FeedRfqItem) => {
    setSelectedRfq(item);
  }, []);

  return (
    <>
      {MOCK_MODE && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2 mb-4 text-center">
          <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
            DEV MODE — Mock Feed Data (updates every 5s)
          </p>
        </div>
      )}
      {/* Core token filter — between page subtitle and feed table */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 shrink-0">
          Filter
        </span>
        <TokenFilterBar
          selected={selectedTokens}
          onToggle={handleTokenToggle}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              Public RFQ Feed
              <Badge
                variant={connected ? "default" : "outline"}
                className="text-[10px] gap-1"
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    connected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                  )}
                />
                {connected ? "Live" : "Connecting"}
              </Badge>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search token..."
                  value={tokenSearch}
                  onChange={(e) => setTokenSearch(e.target.value)}
                  className="pl-7 h-8 w-[140px] text-xs"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as "all" | FeedRfqStatus)}
              >
                <SelectTrigger className="w-[110px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="QUOTED">Quoted</SelectItem>
                  <SelectItem value="FILLED">Filled</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                  <SelectItem value="KILLED">Killed</SelectItem>
                </SelectContent>
              </Select>
              {/* Size filter chips */}
              <div className="flex items-center gap-1.5">
                {(["all", "25k", "100k", "250k"] as const).map((key) => (
                  <Button
                    key={key}
                    variant={sizeFilter === key ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setSizeFilter(key)}
                  >
                    {SIZE_LABELS[key]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[80px_1fr_80px_1fr_100px_70px_80px] gap-2 px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border/30">
            <span>Time</span>
            <span>Pair</span>
            <span>Flow</span>
            <span>Size</span>
            <span>Requester</span>
            <span>TTL</span>
            <span className="text-right">Status</span>
          </div>
          {/* Rows — single TooltipProvider wraps all rows */}
          <TooltipProvider delayDuration={300}>
            <div className="divide-y divide-border/20">
              {filtered.map((item) => (
                <FeedRow
                  key={item.id}
                  item={item}
                  notionalUsd={notionals.get(item.id)}
                  onClick={handleRowClick}
                />
              ))}
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground font-medium">
                    {items.length === 0
                      ? "No RFQs yet"
                      : "No RFQs match your filters"}
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {items.length === 0
                      ? "Public RFQs will appear here in real-time"
                      : "Try adjusting your filters"}
                  </p>
                </div>
              )}
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>

      {/* Detail drawer */}
      <Sheet
        open={!!selectedRfq}
        onOpenChange={(open) => {
          if (!open) setSelectedRfq(null);
        }}
      >
        <SheetContent aria-describedby={undefined}>
          <SheetHeader className="sr-only">
            <SheetTitle>RFQ Details</SheetTitle>
          </SheetHeader>
          {selectedRfq && (
            <RfqDetailDrawer
              item={selectedRfq}
              onClose={() => setSelectedRfq(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// FeedRow — memoized table row. Only re-renders when item/notional changes.
// ---------------------------------------------------------------------------

const FeedRow = memo(function FeedRow({
  item,
  notionalUsd,
  onClick,
}: {
  item: FeedRfqItem;
  notionalUsd: number | null | undefined;
  onClick: (item: FeedRfqItem) => void;
}) {
  const isExactIn = item.kind === 0;
  const statusCfg = STATUS_BADGE[item.status];

  return (
    <div
      onClick={() => onClick(item)}
      className="grid grid-cols-[80px_1fr_80px_1fr_100px_70px_80px] gap-2 px-3 py-3 items-center cursor-pointer border-l-2 border-l-transparent hover:border-l-primary/50 hover:bg-muted/30 transition-colors text-sm"
    >
      {/* Time — self-updating at low frequency */}
      <RelativeTime createdAt={item.createdAt} />

      {/* Pair */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium truncate text-xs">
          {item.tokenIn?.symbol ?? "?"}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="font-medium truncate text-xs">
          {item.tokenOut?.symbol ?? "?"}
        </span>
      </div>

      {/* Flow */}
      <Badge
        variant={isExactIn ? "default" : "secondary"}
        className="text-[9px] px-1.5 py-0 w-fit"
      >
        {isExactIn ? "Exact In" : "Exact Out"}
      </Badge>

      {/* Size */}
      <div className="font-mono text-xs truncate">
        {safeFormatTokenAmount(
          isExactIn ? item.amountIn : item.amountOut,
          (isExactIn ? item.tokenIn : item.tokenOut)?.decimals ?? 18,
        )}
        {" "}
        <span className="text-muted-foreground">
          {isExactIn ? item.tokenIn?.symbol : item.tokenOut?.symbol}
        </span>
        {notionalUsd != null && (
          <div className="text-[10px] text-muted-foreground">
            {formatCompactUsd(notionalUsd)}
          </div>
        )}
      </div>

      {/* Requester */}
      <div className="text-xs font-mono text-muted-foreground truncate">
        {formatAddress(item.taker as `0x${string}`, 4)}
      </div>

      {/* TTL — only ticks for active (OPEN/QUOTED) rows */}
      <TTLCell expiry={item.expiry} status={item.status} />

      {/* Status */}
      <div className="text-right">
        <Badge
          variant={statusCfg.variant}
          className={cn("text-[9px] px-1.5 py-0", statusCfg.className)}
        >
          {statusCfg.label}
        </Badge>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// RelativeTime — lightweight self-updating component.
// Uses a single interval at REDUCED frequency (10s) per row.
// Rows > 1 min old update every 30s. Rows > 1 hour old don't tick.
// ---------------------------------------------------------------------------

function RelativeTime({ createdAt }: { createdAt: string }) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const created = new Date(createdAt).getTime();

    // Determine update frequency based on age
    function getInterval(): number | null {
      const ageSec = Math.floor((Date.now() - created) / 1000);
      if (ageSec < 60) return 10_000;    // < 1 min: update every 10s
      if (ageSec < 3600) return 30_000;  // < 1 hour: update every 30s
      return null;                        // > 1 hour: static, no interval
    }

    const ms = getInterval();
    if (ms == null) return;

    const id = setInterval(() => forceUpdate((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [createdAt]);

  const created = new Date(createdAt);
  const diffSec = Math.floor((Date.now() - created.getTime()) / 1000);

  let display: string;
  if (diffSec < 60) {
    display = `${diffSec}s ago`;
  } else if (diffSec < 3600) {
    display = `${Math.floor(diffSec / 60)}m ago`;
  } else if (diffSec < 86400) {
    display = `${Math.floor(diffSec / 3600)}h ago`;
  } else {
    display = `${Math.floor(diffSec / 86400)}d ago`;
  }

  return (
    <span
      className="text-xs text-muted-foreground cursor-default"
      title={created.toLocaleString()}
      suppressHydrationWarning
    >
      {display}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TTLCell — countdown only for active (OPEN/QUOTED) RFQs.
// Terminal states (FILLED/KILLED/EXPIRED) render static text with no timer.
// Active countdowns update every 1s but self-clear when expired.
// ---------------------------------------------------------------------------

function TTLCell({ expiry, status }: { expiry: number; status: FeedRfqStatus }) {
  const [, forceUpdate] = useState(0);

  const isTerminal = status === "FILLED" || status === "KILLED" || status === "EXPIRED";
  const secondsLeft = secondsUntilExpiry(expiry);
  const isActive = !isTerminal && secondsLeft > 0;

  useEffect(() => {
    // Only run interval for active (non-terminal, non-expired) countdowns
    if (!isActive) return;
    const id = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  if (status === "FILLED" || status === "KILLED") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (secondsLeft <= 0 || status === "EXPIRED") {
    return <span className="text-xs text-muted-foreground">Expired</span>;
  }

  const isUrgent = secondsLeft <= 10;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const formattedTime = mins > 0
    ? `${mins}:${secs.toString().padStart(2, "0")}`
    : `${secs}s`;

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-mono",
        isUrgent ? "text-warning animate-pulse" : "text-muted-foreground"
      )}
      suppressHydrationWarning
    >
      <Clock className="h-3 w-3" />
      {formattedTime}
    </span>
  );
}
