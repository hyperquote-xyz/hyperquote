"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Trophy,
  Timer,
  TrendingUp,
  Activity,
  ArrowRight,
  Zap,
  BarChart3,
  RefreshCw,
  Info,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MakerQuote, ExpiredQuote, MarketReference } from "./useMockQuotes";
import { Token } from "@/types";
import { safeSymbol } from "@/lib/utils";
import { fmtNum } from "./formatNumber";

interface LiveQuotesPanelProps {
  makers: MakerQuote[];
  expired: ExpiredQuote[];
  references: MarketReference[];
  bestMaker: MakerQuote | null;
  countdown: number;
  isLive: boolean;
  isSearching: boolean;
  tokenOut: Token | null;
  bpsVsDex: number;
  bpsVsCore: number;
  refCountdown: number;
  newBestFlash: boolean;
  bestAmountOut: string | null; // Formatted total output amount (e.g. "415")
  onExecute: () => void;
}

const REF_TOOLTIPS: Record<string, string> = {
  "best-route": "Best executable price across all public venues (HyperCore, PRJX DEX, HT Aggregator). Ranked by output amount and fill completeness.",
  "hypercore": "Estimated execution against the HyperCore spot order book for this trade size. Includes slippage from walking the book.",
  "dex": "DEX reference uses the best available route. Direct pools are preferred when liquidity supports the trade size; otherwise routing may go through USDC.",
  "last-trade": "Fair market value computed from last traded prices. Used for price protection threshold. No slippage or fees included.",
};

function AnimatedPrice({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (Math.abs(value - prevRef.current) > 0.001) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 400);
      prevRef.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span
      className={cn(
        "transition-colors duration-300 tabular-nums",
        flash && "text-primary"
      )}
    >
      {fmtNum(value, decimals)}
    </span>
  );
}

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const pct = seconds / total;
  const r = 10;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
      <circle
        cx="14" cy="14" r={r}
        fill="none" stroke="hsl(var(--muted))" strokeWidth="2"
      />
      <circle
        cx="14" cy="14" r={r}
        fill="none" stroke="hsl(var(--primary))" strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform="rotate(-90 14 14)"
        className="transition-all duration-1000 ease-linear"
      />
      <text
        x="14" y="14"
        textAnchor="middle" dominantBaseline="central"
        className="fill-foreground text-[8px] font-mono font-medium"
      >
        {seconds}
      </text>
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-muted/30 border border-border/30 flex items-center justify-center mb-4">
        <Activity className="h-7 w-7 text-muted-foreground/80" />
      </div>
      <h3 className="text-sm font-medium text-muted-foreground mb-1">
        Live market competition
      </h3>
      <p className="text-xs text-muted-foreground/80 max-w-[240px]">
        Enter a swap and hit Find Best Price to see makers compete for your order in real time
      </p>
    </div>
  );
}

function MarketReferenceSection({
  references,
  refCountdown,
}: {
  references: MarketReference[];
  refCountdown: number;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <span className="text-xs font-medium text-foreground/90">
                Market Reference
              </span>
              <span className="text-[10px] text-muted-foreground/70 ml-2">
                Live baseline pricing
              </span>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/80 font-mono">
            <RefreshCw className="h-3 w-3" />
            Refreshes in {String(refCountdown).padStart(2, "0")}s · Updated just now
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 px-4 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider border-b border-border/10">
        <span>Reference</span>
        <span className="text-right">Amount</span>
      </div>

      <div className="divide-y divide-border/10">
        {references.map((ref) => (
          <div
            key={ref.id}
            className="grid grid-cols-[1fr_auto] gap-3 items-start px-4 py-3"
          >
            <div className="min-w-0 space-y-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground/90">
                {ref.label}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground/70 cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] text-xs">
                    {REF_TOOLTIPS[ref.id] ?? ref.routeDescription}
                  </TooltipContent>
                </Tooltip>
              </span>
              <span className="block text-[10px] text-muted-foreground/80 truncate">
                {ref.routeDescription}
              </span>
              {ref.rateDescription && (
                <span className="block text-[10px] text-muted-foreground/70">
                  {ref.rateDescription}
                </span>
              )}
              {ref.userMessage && (
                <span className={cn(
                  "block text-[10px] mt-0.5",
                  ref.noRoute ? "text-muted-foreground/70" : "text-success"
                )}>
                  {ref.userMessage}
                </span>
              )}
            </div>
            <div className="text-right pt-0.5 space-y-0.5">
              <span className="block text-sm font-mono tabular-nums">
                {ref.noRoute ? (
                  <span className="text-muted-foreground/70">—</span>
                ) : (
                  <AnimatedPrice value={ref.price} />
                )}
              </span>
              {ref.usdValue && ref.usdValue > 0 && (
                <span className="block text-[10px] text-muted-foreground/70">
                  ~${fmtNum(ref.usdValue)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MakerCompetitionSection({
  makers,
  bestMaker,
  isLive,
}: {
  makers: MakerQuote[];
  bestMaker: MakerQuote | null;
  isLive: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <div>
              <span className="text-xs font-medium text-foreground/90">
                Live Maker Competition
              </span>
              <span className="text-[10px] text-muted-foreground/70 ml-2">
                Makers competing for your order flow
              </span>
            </div>
          </div>
          {isLive && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-[10px] text-success font-medium">LIVE</span>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider border-b border-border/10">
        <span>Maker</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Status</span>
      </div>

      <div className="divide-y divide-border/10">
        {makers.map((maker) => {
          const isBest = bestMaker?.id === maker.id;
          return (
            <div
              key={maker.id}
              className={cn(
                "grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5 transition-all duration-300",
                isBest && "bg-primary/5",
                "hover:bg-muted/10"
              )}
            >
              <span
                className={cn(
                  "text-sm font-mono truncate",
                  isBest ? "text-primary font-medium" : "text-foreground/80"
                )}
              >
                {maker.address}
              </span>
              <span
                className={cn(
                  "text-sm font-mono tabular-nums text-right",
                  isBest && "font-semibold"
                )}
              >
                {maker.amountOut}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-wider text-right",
                  maker.status === "live" ? "text-success" : "text-warning"
                )}
              >
                {maker.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExpiredQuotesSection({ expired }: { expired: ExpiredQuote[] }) {
  if (expired.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/20">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground/90">
            Expired Quotes
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-1.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider border-b border-border/10">
        <span>Maker</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Expired</span>
      </div>

      <div className="divide-y divide-border/10">
        {expired.map((eq) => (
          <div
            key={eq.id}
            className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5"
          >
            <span className="text-sm font-mono text-muted-foreground/70 truncate">
              {eq.address}
            </span>
            <span className="text-sm font-mono tabular-nums text-muted-foreground/80 text-right">
              {fmtNum(eq.price)}
            </span>
            <span className="text-[10px] text-muted-foreground/80 text-right">
              {eq.expiredAgo}s ago
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LiveQuotesPanel({
  makers,
  expired,
  references,
  bestMaker,
  countdown,
  isLive,
  isSearching,
  tokenOut,
  bpsVsDex,
  bpsVsCore,
  refCountdown,
  newBestFlash,
  bestAmountOut,
  onExecute,
}: LiveQuotesPanelProps) {
  if (!isSearching) {
    return <EmptyState />;
  }

  const symbol = tokenOut ? safeSymbol(tokenOut) : "";
  const hasQuotes = makers.length > 0;

  return (
    <div className="space-y-4">
      {/* 1. Best Quote Hero Card — only show when quotes exist */}
      {!hasQuotes && (
        <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <svg className="animate-spin h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm font-medium text-muted-foreground">Waiting for maker quotes…</span>
          </div>
          <p className="text-xs text-muted-foreground/70">Makers are competing for your order</p>
        </div>
      )}

      {hasQuotes && (<>
        {/* 1. Best Quote Hero Card */}
      <div
        className={cn(
          "relative rounded-xl border bg-card/60 backdrop-blur-sm overflow-hidden transition-all duration-500",
          newBestFlash
            ? "border-primary/50 shadow-lg shadow-primary/10"
            : "border-primary/20"
        )}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div
          className={cn(
            "absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl pointer-events-none transition-all duration-500",
            newBestFlash ? "bg-primary/15" : "bg-primary/8"
          )}
        />

        <div className="relative p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                Best Live Quote
              </span>
              {newBestFlash && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded animate-in fade-in zoom-in-95 duration-200">
                  NEW BEST
                </span>
              )}
            </div>
            <CountdownRing seconds={countdown} total={30} />
          </div>

          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-bold tracking-tight transition-all duration-300">
              {bestAmountOut ?? (bestMaker ? <AnimatedPrice value={bestMaker.price} /> : "—")}
            </span>
            <span className="text-sm text-muted-foreground font-medium">
              {symbol}
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {bpsVsCore > 0 && (
              <span className="flex items-center gap-1 text-success font-medium">
                <TrendingUp className="h-3 w-3" />
                +{bpsVsCore} bps vs Public Best Route
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
            <Timer className="h-3 w-3" />
            Quote valid for {countdown}s
          </div>
        </div>
      </div>

      {/* Execute Button — directly associated with Best Live Quote */}
      <Button
        size="lg"
        variant="success"
        className="w-full gap-2 h-12 text-base font-semibold"
        onClick={onExecute}
      >
        Execute Swap
        <ArrowRight className="h-4 w-4" />
      </Button>
      </>)}

      {/* 2. Market Reference — always show when searching */}
      <MarketReferenceSection
        references={references}
        refCountdown={refCountdown}
      />

      {/* 3. Live Maker Competition */}
      <MakerCompetitionSection
        makers={makers}
        bestMaker={bestMaker}
        isLive={isLive}
      />

      {/* 4. Expired Quotes */}
      <ExpiredQuotesSection expired={expired} />
    </div>
  );
}
