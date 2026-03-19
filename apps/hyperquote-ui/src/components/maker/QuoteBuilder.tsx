"use client";

import { useState, useEffect, useMemo } from "react";
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
import { QuoteKind, RFQRequest } from "@/types";
import {
  formatAmount,
  parseAmount,
  calculateFee,
  calculateNetAmount,
  secondsUntilExpiry,
  cn,
  safeSymbol,
} from "@/lib/utils";
import { ArrowDown, Info, AlertTriangle } from "lucide-react";
import { TokenBadge } from "./TokenBadge";
import { computeBps, type BenchmarkData } from "@/hooks/useBenchmark";

/** Stable symbols for tighter deviation thresholds (mirrors USD_STABLES in lib/hyperliquid). */
const STABLES = new Set(["USDC", "USD₮0", "USDH", "USDT", "USDT0", "DAI", "FEUSD"]);

interface QuoteBuilderProps {
  request: RFQRequest;
  feePips: number;
  /** On-chain baseline data for BPS comparison. Optional — non-blocking. */
  benchmark?: BenchmarkData;
  /** Called whenever valid amounts change */
  onAmountsChange: (amounts: {
    amountIn: bigint;
    amountOut: bigint;
    quoteExpiry: number;
    isValid: boolean;
  }) => void;
}

const EXPIRY_OPTIONS = [
  { value: "30", label: "30s" },
  { value: "60", label: "1 min" },
  { value: "120", label: "2 min" },
];

export function QuoteBuilder({ request, feePips, benchmark, onAmountsChange }: QuoteBuilderProps) {
  const isExactIn = request.kind === QuoteKind.EXACT_IN;

  // Input mode: "direct" (Quote by Amount) is default — most makers think in amounts
  const [inputMode, setInputMode] = useState<"price" | "direct">("direct");
  const [priceStr, setPriceStr] = useState("");
  const [directStr, setDirectStr] = useState("");
  const [expirySec, setExpirySec] = useState("60");

  // Cap expiry to request TTL
  const maxExpiry = secondsUntilExpiry(request.expiry);
  const actualExpiry = Math.min(parseInt(expirySec), maxExpiry);
  const quoteExpiryTimestamp = Math.floor(Date.now() / 1000) + actualExpiry;

  // Compute amounts
  const computed = useMemo(() => {
    try {
      let amountIn: bigint;
      let amountOut: bigint;

      if (isExactIn) {
        amountIn = request.amountIn!;
        if (inputMode === "price" && priceStr) {
          // price = tokenOut per tokenIn, so amountOut = amountIn * price (adjusted for decimals)
          const price = parseFloat(priceStr);
          if (price <= 0 || isNaN(price)) return null;
          const normalizedIn = Number(amountIn) / 10 ** request.tokenIn.decimals;
          const rawOut = normalizedIn * price;
          amountOut = BigInt(Math.floor(rawOut * 10 ** request.tokenOut.decimals));
        } else if (inputMode === "direct" && directStr) {
          amountOut = parseAmount(directStr, request.tokenOut.decimals);
        } else {
          return null;
        }
      } else {
        // EXACT_OUT
        amountOut = request.amountOut!;
        if (inputMode === "price" && priceStr) {
          const price = parseFloat(priceStr);
          if (price <= 0 || isNaN(price)) return null;
          const normalizedOut = Number(amountOut) / 10 ** request.tokenOut.decimals;
          const rawIn = normalizedOut / price;
          amountIn = BigInt(Math.ceil(rawIn * 10 ** request.tokenIn.decimals));
        } else if (inputMode === "direct" && directStr) {
          amountIn = parseAmount(directStr, request.tokenIn.decimals);
        } else {
          return null;
        }
      }

      if (amountIn <= 0n || amountOut <= 0n) return null;

      const fee = calculateFee(amountIn, feePips);
      const netIn = amountIn - fee;

      // Constraint check
      let constraintOk = true;
      if (isExactIn && request.minOut && request.minOut > 0n && amountOut < request.minOut) {
        constraintOk = false;
      }
      if (!isExactIn && request.maxIn && request.maxIn < BigInt("0xffffffffffffffffffff") && amountIn > request.maxIn) {
        constraintOk = false;
      }

      return { amountIn, amountOut, fee, netIn, constraintOk };
    } catch {
      return null;
    }
  }, [isExactIn, inputMode, priceStr, directStr, request, feePips]);

  // Propagate to parent
  useEffect(() => {
    if (computed && computed.constraintOk) {
      onAmountsChange({
        amountIn: computed.amountIn,
        amountOut: computed.amountOut,
        quoteExpiry: quoteExpiryTimestamp,
        isValid: true,
      });
    } else {
      onAmountsChange({ amountIn: 0n, amountOut: 0n, quoteExpiry: quoteExpiryTimestamp, isValid: false });
    }
  }, [computed, quoteExpiryTimestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Input Mode Toggle */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-muted/30 w-fit">
        {(["price", "direct"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setInputMode(m)}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-all",
              inputMode === m
                ? "bg-background shadow-sm text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m === "price" ? "Quote by Price" : "Quote by Amount"}
          </button>
        ))}
      </div>

      {/* Input Field */}
      {inputMode === "price" ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Price ({safeSymbol(request.tokenOut)} per {safeSymbol(request.tokenIn)})
          </Label>
          <Input
            type="text"
            placeholder="e.g. 0.95"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            className="font-mono"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {isExactIn
              ? `${safeSymbol(request.tokenOut)} you will send (amountOut)`
              : `${safeSymbol(request.tokenIn)} you will receive (amountIn)`}
          </Label>
          <Input
            type="text"
            placeholder="0.0"
            value={directStr}
            onChange={(e) => setDirectStr(e.target.value)}
            className="font-mono"
          />
        </div>
      )}

      {/* Expiry */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground shrink-0">Quote Expiry</Label>
          <Select value={expirySec} onValueChange={setExpirySec}>
            <SelectTrigger className="w-[90px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.filter((o) => parseInt(o.value) <= maxExpiry || parseInt(o.value) === 30).map(
                (o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          {actualExpiry < parseInt(expirySec) && (
            <span className="text-[10px] text-warning">capped to {actualExpiry}s</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          Shorter expiry reduces adverse selection risk
        </p>
      </div>

      {/* ── Preview ── */}
      {computed && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2.5 text-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Quote Preview
          </div>

          {/* Gross */}
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Taker pays</span>
            <span className="font-mono">
              {formatAmount(computed.amountIn, request.tokenIn.decimals, 6)}{" "}
              {safeSymbol(request.tokenIn)}
            </span>
          </div>

          <div className="flex justify-center">
            <ArrowDown className="h-3 w-3 text-muted-foreground" />
          </div>

          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Taker receives</span>
            <span className="font-mono">
              {formatAmount(computed.amountOut, request.tokenOut.decimals, 6)}{" "}
              {safeSymbol(request.tokenOut)}
            </span>
          </div>

          <div className="h-px bg-border/50" />

          {/* Fee */}
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Protocol fee ({feePips / 100} bps)
            </span>
            <span className="font-mono text-muted-foreground">
              {formatAmount(computed.fee, request.tokenIn.decimals, 6)}{" "}
              {safeSymbol(request.tokenIn)}
            </span>
          </div>

          {/* Effective price */}
          {isExactIn && computed.amountIn > 0n && computed.amountOut > 0n && (
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Effective price</span>
              <span className="font-mono">
                {(
                  (Number(computed.amountOut) / 10 ** request.tokenOut.decimals) /
                  (Number(computed.amountIn) / 10 ** request.tokenIn.decimals)
                ).toFixed(6)}{" "}
                <span className="text-muted-foreground">{safeSymbol(request.tokenOut)}/{safeSymbol(request.tokenIn)}</span>
              </span>
            </div>
          )}

          {/* Maker receives/pays */}
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Maker receives (net)</span>
            <span className="font-mono font-medium text-primary">
              {formatAmount(computed.netIn, request.tokenIn.decimals, 6)}{" "}
              {safeSymbol(request.tokenIn)}
            </span>
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Maker sends</span>
            <span className="font-mono">
              {formatAmount(computed.amountOut, request.tokenOut.decimals, 6)}{" "}
              {safeSymbol(request.tokenOut)}
            </span>
          </div>

          {/* BPS vs on-chain baseline */}
          {isExactIn && benchmark?.ammOutput && computed.amountOut > 0n && (() => {
            try {
              const baselineOut = BigInt(benchmark.ammOutput!);
              const bps = computeBps(computed.amountOut, baselineOut);
              if (bps === null) return null;
              return (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Your quote vs on-chain</span>
                  <span className={cn("font-mono font-medium", bps >= 0 ? "text-primary" : "text-warning")}>
                    {bps >= 0 ? "+" : ""}{bps} bps
                  </span>
                </div>
              );
            } catch { return null; }
          })()}

          {/* Price deviation warning — 100 bps for stable/stable, 300 bps otherwise */}
          {isExactIn && benchmark?.ammOutput && computed.amountOut > 0n && (() => {
            try {
              const baselineOut = BigInt(benchmark.ammOutput!);
              const bps = computeBps(computed.amountOut, baselineOut);
              if (bps === null) return null;
              const isStablePair =
                STABLES.has(safeSymbol(request.tokenIn)) &&
                STABLES.has(safeSymbol(request.tokenOut));
              const threshold = isStablePair ? 100 : 300;
              if (Math.abs(bps) > threshold) {
                return (
                  <div className="flex items-center gap-1.5 text-xs text-warning bg-warning/10 rounded px-2 py-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Quote deviates significantly from market
                  </div>
                );
              }
              return null;
            } catch { return null; }
          })()}

          {/* Constraint warning */}
          {!computed.constraintOk && (
            <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
              {isExactIn
                ? `Below taker's minOut of ${formatAmount(request.minOut!, request.tokenOut.decimals, 4)} ${safeSymbol(request.tokenOut)}`
                : `Exceeds taker's maxIn of ${formatAmount(request.maxIn!, request.tokenIn.decimals, 4)} ${safeSymbol(request.tokenIn)}`}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!computed && (priceStr || directStr) && (
        <p className="text-xs text-destructive">Invalid input — enter a positive number</p>
      )}
    </div>
  );
}
