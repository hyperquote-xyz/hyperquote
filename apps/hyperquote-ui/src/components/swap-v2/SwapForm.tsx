"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Token } from "@/types";
import { TokenSelector } from "@/components/TokenSelector";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  ArrowDownUp,
  ChevronDown,
  Info,
  Search,
  Zap,
  X,
  Plus,
  Copy,
  Link2,
  Users,
  Timer,
} from "lucide-react";
import { cn, safeSymbol } from "@/lib/utils";
import { fmtNum, fmtUsd } from "./formatNumber";
import { toast } from "@/components/ui/use-toast";

interface SwapFormProps {
  tokenIn: Token | null;
  tokenOut: Token | null;
  amountIn: string;
  visibility: "public" | "private";
  selectedMakers: string[];
  onTokenInChange: (t: Token | null) => void;
  onTokenOutChange: (t: Token | null) => void;
  onAmountInChange: (v: string) => void;
  onVisibilityChange: (v: "public" | "private") => void;
  onSelectedMakersChange: (makers: string[]) => void;
  onFindPrice: () => void;
  onCancel: () => void;
  isSearching: boolean;
  bestPrice: number | null;
  mockUsdPerToken: number;
}

const SUGGESTED_MAKERS = [
  "0x8d8a…6045",
  "0x1f98…f984",
  "0xa4e3…b72c",
];

function SpotRateLabel({ symbol, rate }: { symbol: string; rate: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70 mt-0.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-success/70" />
      @ 1 {symbol} = ${rate} (HyperCore Spot)
    </span>
  );
}

function MakerSelector({
  selectedMakers,
  onSelectedMakersChange,
}: {
  selectedMakers: string[];
  onSelectedMakersChange: (makers: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  const addMaker = useCallback((addr: string) => {
    const trimmed = addr.trim();
    if (!trimmed || selectedMakers.includes(trimmed)) return;
    onSelectedMakersChange([...selectedMakers, trimmed]);
    setInputValue("");
  }, [selectedMakers, onSelectedMakersChange]);

  const removeMaker = (addr: string) => {
    onSelectedMakersChange(selectedMakers.filter((m) => m !== addr));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMaker(inputValue);
    }
  };

  const availableSuggestions = SUGGESTED_MAKERS.filter(
    (m) => !selectedMakers.includes(m)
  );

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground/90">Selected Makers</span>
      </div>

      {/* Selected maker pills */}
      {selectedMakers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedMakers.map((addr) => (
            <span
              key={addr}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border/50 text-xs font-mono"
            >
              {addr}
              <button
                onClick={() => removeMaker(addr)}
                className="text-muted-foreground/70 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Paste maker address (0x...)"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 text-xs bg-muted/30 border border-border/50 rounded-lg px-3 py-2 outline-none focus:border-primary/50 font-mono placeholder:font-sans placeholder:text-muted-foreground/50"
        />
        <button
          onClick={() => addMaker(inputValue)}
          disabled={!inputValue.trim()}
          className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center hover:bg-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5 text-primary" />
        </button>
      </div>

      {/* Quick-add suggestions */}
      {availableSuggestions.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider">Quick add</span>
          <div className="flex flex-wrap gap-1.5">
            {availableSuggestions.map((addr) => (
              <button
                key={addr}
                onClick={() => addMaker(addr)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/20 border border-border/30 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:border-border/50 transition-colors"
              >
                <Plus className="h-2.5 w-2.5" />
                {addr}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Helper copy */}
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Only selected makers can view and respond to this RFQ through the API, dashboard, and notifications.
      </p>
    </div>
  );
}

function ShareRfqSection({
  tokenIn,
  tokenOut,
  amountIn,
  ttl,
  selectedMakers,
}: {
  tokenIn: Token | null;
  tokenOut: Token | null;
  amountIn: string;
  ttl: string;
  selectedMakers: string[];
}) {
  const mockJson = JSON.stringify(
    {
      rfqId: `rfq_${Date.now().toString(36)}`,
      tokenIn: tokenIn ? safeSymbol(tokenIn) : null,
      tokenOut: tokenOut ? safeSymbol(tokenOut) : null,
      amountIn,
      ttl: parseInt(ttl) || 180,
      makers: selectedMakers,
      timestamp: new Date().toISOString(),
    },
    null,
    2
  );

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(mockJson);
      toast({ title: "Copied", description: "RFQ JSON copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleCopyLink = async () => {
    const mockLink = `https://app.hyperquote.xyz/rfq/${Date.now().toString(36)}`;
    try {
      await navigator.clipboard.writeText(mockLink);
      toast({ title: "Copied", description: "Shareable link copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground/90">Share RFQ Request</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={handleCopyJson}
        >
          <Copy className="h-3 w-3" />
          Copy Request JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={handleCopyLink}
        >
          <Link2 className="h-3 w-3" />
          Copy Shareable Link
        </Button>
      </div>
    </div>
  );
}

export function SwapForm({
  tokenIn,
  tokenOut,
  amountIn,
  visibility,
  selectedMakers,
  onTokenInChange,
  onTokenOutChange,
  onAmountInChange,
  onVisibilityChange,
  onSelectedMakersChange,
  onFindPrice,
  onCancel,
  isSearching,
  bestPrice,
  mockUsdPerToken,
}: SwapFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ttl, setTtl] = useState("180");
  const [priceProtection, setPriceProtection] = useState("2");
  const [rfqCountdown, setRfqCountdown] = useState(0);
  const rfqIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // RFQ expiry countdown — starts when searching begins, resets on cancel
  useEffect(() => {
    if (isSearching) {
      const ttlSec = parseInt(ttl) || 180;
      setRfqCountdown(ttlSec);
      rfqIntervalRef.current = setInterval(() => {
        setRfqCountdown((c) => (c <= 1 ? 0 : c - 1));
      }, 1000);
    } else {
      setRfqCountdown(0);
      if (rfqIntervalRef.current) clearInterval(rfqIntervalRef.current);
    }
    return () => {
      if (rfqIntervalRef.current) clearInterval(rfqIntervalRef.current);
    };
  }, [isSearching, ttl]);

  const rfqMinutes = Math.floor(rfqCountdown / 60);
  const rfqSeconds = rfqCountdown % 60;
  const rfqTimeStr = `${rfqMinutes}:${String(rfqSeconds).padStart(2, "0")}`;

  const handleSwapTokens = () => {
    const tmp = tokenIn;
    onTokenInChange(tokenOut);
    onTokenOutChange(tmp);
  };

  const handleAmountInput = (raw: string) => {
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      onAmountInChange(raw);
    }
  };

  const parsedAmount = parseFloat(amountIn) || 0;
  const payUsd = parsedAmount * mockUsdPerToken;

  const estimatedOutput = bestPrice ? fmtNum(bestPrice) : "";
  const receiveUsd = bestPrice ? bestPrice : null;

  const tokenInSymbol = tokenIn ? safeSymbol(tokenIn) : "TOKEN";
  const tokenOutSymbol = tokenOut ? safeSymbol(tokenOut) : "TOKEN";

  const mockReceiveRate = tokenOutSymbol === "USDC" ? "1.0000" : "0.9976";

  const isPrivate = visibility === "private";

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-full bg-muted/50 p-0.5 border border-border/50">
          <button
            onClick={() => onVisibilityChange("public")}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
              visibility === "public"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Open Market
          </button>
          <button
            onClick={() => onVisibilityChange("private")}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
              isPrivate
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Private Routing
          </button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[220px] text-xs">
            {isPrivate
              ? "Only selected makers can view and respond"
              : "Any maker can compete for your order"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Private Routing — Maker Selector */}
      {isPrivate && (
        <MakerSelector
          selectedMakers={selectedMakers}
          onSelectedMakersChange={onSelectedMakersChange}
        />
      )}

      {/* Swap Card */}
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
        {/* You pay */}
        <div className="p-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground/70">
              You pay
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amountIn}
              onChange={(e) => handleAmountInput(e.target.value)}
              className="flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/50 min-w-0"
            />
            <TokenSelector
              selectedToken={tokenIn}
              onSelect={onTokenInChange}
              excludeToken={tokenOut}
              label="Select"
              mode="rfq"
            />
          </div>
          {parsedAmount > 0 && (
            <div className="mt-1.5">
              <p className="text-xs text-muted-foreground">
                ~{fmtUsd(payUsd)}
              </p>
              <SpotRateLabel
                symbol={tokenInSymbol}
                rate={mockUsdPerToken.toFixed(4)}
              />
            </div>
          )}
        </div>

        {/* Swap direction button */}
        <div className="relative h-0">
          <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <button
              onClick={handleSwapTokens}
              className="w-8 h-8 rounded-lg bg-muted border border-border/50 flex items-center justify-center hover:bg-accent transition-colors group"
            >
              <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/30" />

        {/* You receive */}
        <div className="p-4 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground/70">
              You receive
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {isSearching && bestPrice ? (
                <span className="text-2xl font-semibold text-primary transition-all duration-300">
                  {estimatedOutput}
                </span>
              ) : isSearching ? (
                <div className="flex items-center gap-2">
                  <div className="h-6 w-32 rounded bg-muted/50 animate-pulse" />
                </div>
              ) : (
                <span className="text-2xl font-semibold text-muted-foreground/50">
                  0.00
                </span>
              )}
            </div>
            <TokenSelector
              selectedToken={tokenOut}
              onSelect={onTokenOutChange}
              excludeToken={tokenIn}
              label="Select"
              mode="rfq"
            />
          </div>
          {receiveUsd && isSearching && (
            <div className="mt-1.5 transition-all duration-300">
              <p className="text-xs text-muted-foreground">
                ~{fmtUsd(receiveUsd)}
              </p>
              <SpotRateLabel
                symbol={tokenOutSymbol}
                rate={mockReceiveRate}
              />
            </div>
          )}
        </div>
      </div>

      {/* CTA Buttons */}
      <div className="space-y-2">
        {!isSearching ? (
          <Button
            size="lg"
            className="w-full gap-2 h-12 text-base font-semibold"
            onClick={onFindPrice}
            disabled={!tokenIn || !tokenOut || !amountIn || parsedAmount <= 0}
          >
            <Search className="h-4 w-4" />
            Find Best Price
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              className="w-full gap-2 h-12 text-base font-semibold"
              disabled
              loading={!bestPrice}
            >
              <Zap className="h-4 w-4" />
              Searching for Quotes…
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full gap-2 h-11 text-sm font-medium border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50"
              onClick={onCancel}
            >
              <X className="h-4 w-4" />
              Cancel Request
              {rfqCountdown > 0 && (
                <span className="text-muted-foreground ml-1">· {rfqTimeStr}</span>
              )}
            </Button>
          </>
        )}
      </div>

      {/* Share RFQ — Private Routing only */}
      {isPrivate && selectedMakers.length > 0 && (
        <ShareRfqSection
          tokenIn={tokenIn}
          tokenOut={tokenOut}
          amountIn={amountIn}
          ttl={ttl}
          selectedMakers={selectedMakers}
        />
      )}

      {/* Advanced */}
      <div className="rounded-lg border border-border/30 overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>Advanced</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200",
              showAdvanced && "rotate-180"
            )}
          />
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground">Quote TTL</label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground/80 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    How long your RFQ remains active for makers to respond before expiring. Individual maker quotes may expire sooner.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                  className="w-14 text-right text-xs bg-muted/30 border border-border/50 rounded px-2 py-1 outline-none focus:border-primary/50"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground">Price protection</label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground/80 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] text-xs">
                    Your swap cannot execute if the selected quote is more than {priceProtection}% away from the latest Theoretical reference price. You can customise this threshold.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={priceProtection}
                  onChange={(e) => setPriceProtection(e.target.value)}
                  className="w-14 text-right text-xs bg-muted/30 border border-border/50 rounded px-2 py-1 outline-none focus:border-primary/50"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
