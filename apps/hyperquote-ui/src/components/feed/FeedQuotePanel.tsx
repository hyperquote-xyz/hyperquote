"use client";

import { useState, useMemo, useCallback } from "react";
import { useReadContract } from "wagmi";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useMakerRFQ } from "@/hooks/useRFQ";
import {
  QuoteKind,
  type RFQRequest,
  type Token,
  quoteToJSON,
} from "@/types";
import {
  parseAmount,
  formatAmount,
  calculateFee,
  calculateNetAmount,
  secondsUntilExpiry,
  safeSymbol,
  cn,
  safeFormatTokenAmount,
} from "@/lib/utils";
import { getTokenByAddress } from "@/config/tokens";
import { RFQ_CONTRACT_ADDRESS, RFQ_ABI } from "@/config/contracts";
import type { FeedRfqItem } from "@/hooks/useFeedStream";
import { MOCK_MODE } from "@/lib/mockMode";
import {
  ArrowDown,
  Info,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FeedQuotePanelProps {
  item: FeedRfqItem;
  connectedAddress: string;
  /** SOR benchmark amountOut (raw string) for bps comparison. */
  benchmarkAmountOut?: string;
  /** Number of other quotes already submitted for this RFQ. */
  existingQuoteCount?: number;
  /** Best existing quote amountOut (raw string) for competitive context. */
  bestExistingAmountOut?: string;
  onQuoteSubmitted?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPIRY_OPTIONS = [
  { value: "10", label: "10s" },
  { value: "20", label: "20s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

type PanelStatus = "idle" | "signing" | "submitting" | "submitted" | "error";

// ---------------------------------------------------------------------------
// FeedQuotePanel
// ---------------------------------------------------------------------------

export function FeedQuotePanel({
  item,
  connectedAddress,
  benchmarkAmountOut,
  existingQuoteCount,
  bestExistingAmountOut,
  onQuoteSubmitted,
}: FeedQuotePanelProps) {
  // ── Self-trade guard ────────────────────────────────────────────────
  if (connectedAddress.toLowerCase() === item.taker.toLowerCase()) {
    return null;
  }

  // ── Token resolution ────────────────────────────────────────────────
  const tokenInFull = getTokenByAddress(item.tokenIn?.address ?? "");
  const tokenOutFull = getTokenByAddress(item.tokenOut?.address ?? "");

  if (!tokenInFull || !tokenOutFull) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/10 p-4 text-center">
        <AlertCircle className="h-4 w-4 mx-auto mb-2 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Token not recognized — cannot quote this pair.
        </p>
      </div>
    );
  }

  return (
    <FeedQuotePanelInner
      item={item}
      connectedAddress={connectedAddress}
      tokenInFull={tokenInFull}
      tokenOutFull={tokenOutFull}
      benchmarkAmountOut={benchmarkAmountOut}
      existingQuoteCount={existingQuoteCount}
      bestExistingAmountOut={bestExistingAmountOut}
      onQuoteSubmitted={onQuoteSubmitted}
    />
  );
}

// ---------------------------------------------------------------------------
// Inner component (after early returns, so hooks are unconditional)
// ---------------------------------------------------------------------------

function FeedQuotePanelInner({
  item,
  connectedAddress,
  tokenInFull,
  tokenOutFull,
  benchmarkAmountOut,
  existingQuoteCount,
  bestExistingAmountOut,
  onQuoteSubmitted,
}: {
  item: FeedRfqItem;
  connectedAddress: string;
  tokenInFull: Token;
  tokenOutFull: Token;
  benchmarkAmountOut?: string;
  existingQuoteCount?: number;
  bestExistingAmountOut?: string;
  onQuoteSubmitted?: () => void;
}) {
  const isExactIn = item.kind === 0;

  // ── Hooks ──────────────────────────────────────────────────────────
  const { createQuote, refetchNonce } = useMakerRFQ();

  const { data: feePipsRaw } = useReadContract({
    address: RFQ_CONTRACT_ADDRESS,
    abi: RFQ_ABI,
    functionName: "feePips",
  });
  const feePips = typeof feePipsRaw === "bigint" ? Number(feePipsRaw) : 250;

  // ── Input state ────────────────────────────────────────────────────
  const [inputMode, setInputMode] = useState<"price" | "direct">("direct");
  const [priceStr, setPriceStr] = useState("");
  const [directStr, setDirectStr] = useState("");
  const [expirySec, setExpirySec] = useState("20");
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Submitted quote summary
  const [submittedAmountOut, setSubmittedAmountOut] = useState<string | null>(null);

  // Cap expiry to remaining RFQ TTL
  const maxExpiry = secondsUntilExpiry(item.expiry);

  // ── Compute amounts ────────────────────────────────────────────────
  const computed = useMemo(() => {
    try {
      let amountIn: bigint;
      let amountOut: bigint;

      if (isExactIn) {
        if (!item.amountIn) return null;
        amountIn = BigInt(item.amountIn);

        if (inputMode === "price" && priceStr) {
          const price = parseFloat(priceStr);
          if (price <= 0 || isNaN(price)) return null;
          const normalizedIn = Number(amountIn) / 10 ** tokenInFull.decimals;
          const rawOut = normalizedIn * price;
          amountOut = BigInt(Math.floor(rawOut * 10 ** tokenOutFull.decimals));
        } else if (inputMode === "direct" && directStr) {
          amountOut = parseAmount(directStr, tokenOutFull.decimals);
        } else {
          return null;
        }
      } else {
        // EXACT_OUT
        if (!item.amountOut) return null;
        amountOut = BigInt(item.amountOut);

        if (inputMode === "price" && priceStr) {
          const price = parseFloat(priceStr);
          if (price <= 0 || isNaN(price)) return null;
          const normalizedOut = Number(amountOut) / 10 ** tokenOutFull.decimals;
          const rawIn = normalizedOut / price;
          amountIn = BigInt(Math.ceil(rawIn * 10 ** tokenInFull.decimals));
        } else if (inputMode === "direct" && directStr) {
          amountIn = parseAmount(directStr, tokenInFull.decimals);
        } else {
          return null;
        }
      }

      if (amountIn <= 0n || amountOut <= 0n) return null;

      const fee = calculateFee(amountIn, feePips);
      const netIn = calculateNetAmount(amountIn, feePips);

      return { amountIn, amountOut, fee, netIn };
    } catch {
      return null;
    }
  }, [isExactIn, inputMode, priceStr, directStr, item, tokenInFull, tokenOutFull, feePips]);

  // ── Benchmark comparison ───────────────────────────────────────────
  const bpsDiff = useMemo(() => {
    if (!computed || !benchmarkAmountOut || benchmarkAmountOut === "mock") return null;
    try {
      const bench = BigInt(benchmarkAmountOut);
      if (bench === 0n) return null;
      // For EXACT_IN: positive means maker offers MORE than benchmark
      const diff = Number(computed.amountOut - bench) / Number(bench) * 10000;
      return Math.round(diff * 100) / 100; // bps with 2 decimal places
    } catch {
      return null;
    }
  }, [computed, benchmarkAmountOut]);

  // ── Build pseudo RFQRequest ────────────────────────────────────────
  const pseudoRequest: RFQRequest = useMemo(() => ({
    id: item.id,
    kind: isExactIn ? QuoteKind.EXACT_IN : QuoteKind.EXACT_OUT,
    taker: item.taker as `0x${string}`,
    tokenIn: tokenInFull,
    tokenOut: tokenOutFull,
    amountIn: item.amountIn ? BigInt(item.amountIn) : undefined,
    amountOut: item.amountOut ? BigInt(item.amountOut) : undefined,
    expiry: item.expiry,
    createdAt: Math.floor(new Date(item.createdAt).getTime() / 1000),
    visibility: "public",
  }), [item, isExactIn, tokenInFull, tokenOutFull]);

  // ── Submit handler ─────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!computed) return;

    // Mock mode: instant success
    if (MOCK_MODE) {
      setStatus("submitted");
      setSubmittedAmountOut(
        formatAmount(computed.amountOut, tokenOutFull.decimals, 6),
      );
      toast({ title: "Quote submitted (mock)" });
      onQuoteSubmitted?.();
      return;
    }

    setStatus("signing");
    setErrorMsg(null);

    try {
      await refetchNonce();

      // createQuote expects the "floating" amount: amountOut for EXACT_IN, amountIn for EXACT_OUT
      const quotedAmount = isExactIn ? computed.amountOut : computed.amountIn;

      // Override expiry on pseudoRequest to be quote-specific
      const actualExpiry = Math.min(parseInt(expirySec), maxExpiry);
      const quoteExpiryTimestamp = Math.floor(Date.now() / 1000) + actualExpiry;
      const requestForSign: RFQRequest = {
        ...pseudoRequest,
        expiry: quoteExpiryTimestamp,
      };

      const quote = await createQuote(requestForSign, quotedAmount);

      if (!quote) {
        setStatus("error");
        setErrorMsg("Signing failed or was cancelled");
        return;
      }

      // Submit via REST
      setStatus("submitting");
      const quoteJSON = quoteToJSON(quote);
      const res = await fetch("/api/v1/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfqId: item.id, quote: quoteJSON }),
      });

      const data = await res.json();

      if (data.accepted) {
        setStatus("submitted");
        setSubmittedAmountOut(
          formatAmount(computed.amountOut, tokenOutFull.decimals, 6),
        );
        toast({ title: "Quote submitted!" });
        onQuoteSubmitted?.();
      } else {
        setStatus("error");
        setErrorMsg(data.reason ?? "Quote rejected");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }, [
    computed, isExactIn, pseudoRequest, expirySec, maxExpiry,
    item.id, tokenOutFull, createQuote, refetchNonce, onQuoteSubmitted,
  ]);

  // ── Already submitted state ────────────────────────────────────────
  if (status === "submitted") {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-success" />
          <h4 className="text-sm font-medium">Quote Submitted</h4>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>You deliver</span>
            <span className="font-mono">
              {submittedAmountOut ?? "—"} {safeSymbol(tokenOutFull)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>For</span>
            <span className="font-mono">
              {safeFormatTokenAmount(item.amountIn, tokenInFull.decimals)}{" "}
              {safeSymbol(tokenInFull)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────
  const isSubmitting = status === "signing" || status === "submitting";
  const canSubmit = !!computed && !isSubmitting && maxExpiry > 0;
  const actualExpiry = Math.min(parseInt(expirySec), maxExpiry);

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-primary" />
        <h4 className="text-sm font-medium">Quote This RFQ</h4>
      </div>

      {/* Fixed amount display */}
      <div className="text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">Fixed</span>{" "}
        <span className="font-mono font-medium text-foreground">
          {safeFormatTokenAmount(
            isExactIn ? item.amountIn : item.amountOut,
            isExactIn ? tokenInFull.decimals : tokenOutFull.decimals,
            6,
          )}{" "}
          {isExactIn ? safeSymbol(tokenInFull) : safeSymbol(tokenOutFull)}
        </span>
      </div>

      {/* Input mode toggle */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-muted/30 w-fit">
        {(["direct", "price"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setInputMode(m)}
            className={cn(
              "px-3 py-1 text-xs rounded-md transition-all",
              inputMode === m
                ? "bg-background shadow-sm text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "direct" ? "By Amount" : "By Price"}
          </button>
        ))}
      </div>

      {/* Input field */}
      {inputMode === "direct" ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {isExactIn
              ? `You deliver (${safeSymbol(tokenOutFull)})`
              : `You receive (${safeSymbol(tokenInFull)})`}
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={directStr}
            onChange={(e) => {
              setDirectStr(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            className="font-mono"
            disabled={isSubmitting}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Price ({safeSymbol(tokenOutFull)} per {safeSymbol(tokenInFull)})
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="e.g. 0.95"
            value={priceStr}
            onChange={(e) => {
              setPriceStr(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            className="font-mono"
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Benchmark comparison */}
      {bpsDiff !== null && computed && (
        <div
          className={cn(
            "text-[10px] font-mono",
            bpsDiff > 0 ? "text-success" : bpsDiff < -50 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          vs benchmark: {bpsDiff > 0 ? "+" : ""}{bpsDiff.toFixed(2)} bps
        </div>
      )}

      {/* Market context — quote competition */}
      {(existingQuoteCount !== undefined || bestExistingAmountOut) && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {existingQuoteCount !== undefined && (
            <span>
              {existingQuoteCount === 0
                ? "No competing quotes yet"
                : `${existingQuoteCount} competing quote${existingQuoteCount !== 1 ? "s" : ""}`}
            </span>
          )}
          {bestExistingAmountOut && computed && (() => {
            try {
              const best = BigInt(bestExistingAmountOut);
              if (best <= 0n) return null;
              const diff = Number(computed.amountOut - best) / Number(best) * 10000;
              const bps = Math.round(diff * 100) / 100;
              return (
                <span className={cn(
                  "font-mono",
                  bps > 0 ? "text-success" : bps < 0 ? "text-amber-500" : "text-muted-foreground"
                )}>
                  vs best: {bps > 0 ? "+" : ""}{bps.toFixed(1)} bps
                </span>
              );
            } catch { return null; }
          })()}
        </div>
      )}

      {/* Quote TTL */}
      <div className="flex items-center gap-3">
        <Label className="text-xs text-muted-foreground shrink-0">Quote TTL</Label>
        <Select value={expirySec} onValueChange={setExpirySec}>
          <SelectTrigger className="w-[80px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.filter(
              (o) => parseInt(o.value) <= maxExpiry || parseInt(o.value) === 10,
            ).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {actualExpiry < parseInt(expirySec) && (
          <span className="text-[10px] text-warning">capped to {actualExpiry}s</span>
        )}
      </div>

      {/* Preview */}
      {computed && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2 text-xs">
          <div className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
            Quote Preview
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Taker pays</span>
            <span className="font-mono">
              {formatAmount(computed.amountIn, tokenInFull.decimals, 6)}{" "}
              {safeSymbol(tokenInFull)}
            </span>
          </div>

          <div className="flex justify-center">
            <ArrowDown className="h-3 w-3 text-muted-foreground" />
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Taker receives</span>
            <span className="font-mono">
              {formatAmount(computed.amountOut, tokenOutFull.decimals, 6)}{" "}
              {safeSymbol(tokenOutFull)}
            </span>
          </div>

          <div className="h-px bg-border/50" />

          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground flex items-center gap-1">
              <Info className="h-2.5 w-2.5" />
              Fee ({feePips / 100} bps)
            </span>
            <span className="font-mono text-muted-foreground">
              {formatAmount(computed.fee, tokenInFull.decimals, 6)}{" "}
              {safeSymbol(tokenInFull)}
            </span>
          </div>

          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">You receive (net)</span>
            <span className="font-mono font-medium text-primary">
              {formatAmount(computed.netIn, tokenInFull.decimals, 6)}{" "}
              {safeSymbol(tokenInFull)}
            </span>
          </div>

          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">You send</span>
            <span className="font-mono">
              {formatAmount(computed.amountOut, tokenOutFull.decimals, 6)}{" "}
              {safeSymbol(tokenOutFull)}
            </span>
          </div>
        </div>
      )}

      {/* Invalid input hint */}
      {!computed && (priceStr || directStr) && (
        <p className="text-xs text-destructive">Invalid input — enter a positive number</p>
      )}

      {/* Error message */}
      {status === "error" && errorMsg && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Submit button */}
      <Button
        className="w-full gap-2"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {status === "signing" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Signing...
          </>
        ) : status === "submitting" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting...
          </>
        ) : maxExpiry <= 0 ? (
          "RFQ Expired"
        ) : (
          "Submit Quote"
        )}
      </Button>
    </div>
  );
}
