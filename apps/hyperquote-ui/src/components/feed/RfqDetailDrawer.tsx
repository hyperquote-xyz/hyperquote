"use client";

import { useState, useEffect, useCallback } from "react";
// SheetHeader/Title/Description are provided by the parent (FeedTable) for
// Radix Dialog accessibility. This component renders a visual-only header.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import {
  formatAddress,
  cn,
  safeFormatTokenAmount,
} from "@/lib/utils";
import { formatAmount } from "@/lib/utils";
import {
  ArrowRight,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  XCircle,
  MessageSquare,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { TakerBadge } from "@/components/TakerBadge";
import type { FeedRfqItem } from "@/hooks/useFeedStream";
import type { AMMEstimate, RFQQuoteJSON, Token } from "@/types";
import { MOCK_MODE } from "@/lib/mockMode";
import { ALL_TOKENS } from "@/config/tokens";
import { useAccount } from "wagmi";
import { STATUS_BADGE } from "./constants";
import { FeedQuotePanel } from "./FeedQuotePanel";
import { useVenueComparison } from "@/hooks/useVenueComparison";
import { type VenueComparisonResult, type VenuePartial, venueFailureText } from "@/lib/venueComparison";

/** Cast FeedRfqItem token info → full Token for venue estimate functions.
 *  Looks up ALL_TOKENS first so fields like `hyperliquidCoin` are available
 *  for estimateHyperliquidSpot's tokenToHLCoin mapping. */
function asFeedToken(t: { address: string; symbol: string; decimals: number }): Token {
  const full = ALL_TOKENS.find(
    (tok) => tok.address.toLowerCase() === t.address.toLowerCase(),
  );
  if (full) return full;
  return { address: t.address as `0x${string}`, symbol: t.symbol, name: t.symbol, decimals: t.decimals };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RfqDetailDrawerProps {
  item: FeedRfqItem;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// RfqDetailDrawer
// ---------------------------------------------------------------------------

export function RfqDetailDrawer({
  item,
  onClose,
}: RfqDetailDrawerProps) {
  const { address: connectedAddress } = useAccount();
  const [copied, setCopied] = useState<string | null>(null);
  const statusCfg = STATUS_BADGE[item.status];
  const isExactIn = item.kind === 0;

  // Role detection
  const isTaker =
    !!connectedAddress &&
    connectedAddress.toLowerCase() === item.taker.toLowerCase();
  const isMaker = !!connectedAddress && !isTaker;
  const isConnected = !!connectedAddress;

  // Quotes state
  const [quotes, setQuotes] = useState<{
    items: RFQQuoteJSON[];
    loading: boolean;
    error: string | null;
  }>({ items: [], loading: false, error: null });

  // Cancel state
  const [cancelState, setCancelState] = useState<
    "idle" | "cancelling" | "cancelled" | "error"
  >("idle");

  // Venue comparison — unified service
  const feedTokenIn = item.tokenIn ? asFeedToken(item.tokenIn) : null;
  const feedTokenOut = item.tokenOut ? asFeedToken(item.tokenOut) : null;
  const rawAmountIn = isExactIn ? item.amountIn : item.amountOut;
  const venueAmountStr = rawAmountIn && feedTokenIn
    ? formatAmount(BigInt(rawAmountIn), feedTokenIn.decimals, 18)
    : "";
  const {
    result: venueResult,
    loading: venueLoading,
    refresh: refreshVenues,
  } = useVenueComparison({
    tokenIn: feedTokenIn,
    tokenOut: feedTokenOut,
    amountIn: venueAmountStr,
    enabled: (item.status === "OPEN" || item.status === "QUOTED") && !MOCK_MODE,
  });
  // Convenience accessors for bestVenueAmountOut calculation
  const hlEstimate = venueResult?.hypercore.ok === true ? venueResult.hypercore.estimate : null;
  const hsEstimate = venueResult?.dex.ok === true ? venueResult.dex.estimate : null;

  const { formattedTime, isExpired, isUrgent } = useQuoteExpiry(item.expiry);
  const explorerUrl =
    process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL ??
    "https://explorer.hyperevm.io";

  // Copy handler
  const handleCopy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(field);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  // Derive best venue output as string for FeedQuotePanel bps comparison
  const bestVenueAmountOut: string | undefined = (() => {
    const amounts: bigint[] = [];
    if (hlEstimate && hlEstimate.amountOut > 0n) amounts.push(hlEstimate.amountOut);
    if (hsEstimate && hsEstimate.amountOut > 0n) amounts.push(hsEstimate.amountOut);
    // Include partial fills
    if (venueResult?.hypercore.ok === "partial" && venueResult.hypercore.filledOut > 0n) {
      amounts.push(venueResult.hypercore.filledOut);
    }
    if (venueResult?.dex.ok === "partial" && venueResult.dex.filledOut > 0n) {
      amounts.push(venueResult.dex.filledOut);
    }
    if (amounts.length === 0) return undefined;
    const best = amounts.reduce((a, b) => (a > b ? a : b));
    return best.toString();
  })();

  // ── Fetch quotes ──────────────────────────────────────────────────────
  useEffect(() => {
    if (MOCK_MODE) {
      setQuotes({ items: [], loading: false, error: null });
      return;
    }

    setQuotes((prev) => ({ ...prev, loading: true }));

    fetch(`/api/v1/rfqs/${item.id}`)
      .then((res) => res.json())
      .then((data) => {
        setQuotes({
          items: (data.quotes as RFQQuoteJSON[] | undefined) ?? [],
          loading: false,
          error: data.error ?? null,
        });
      })
      .catch((err) => {
        setQuotes({
          items: [],
          loading: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });
  }, [item.id]);

  // Venue estimates are managed by useVenueComparison hook above.

  // ── Cancel handler ────────────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (MOCK_MODE) {
      setCancelState("cancelled");
      toast({ title: "RFQ cancelled (mock)" });
      return;
    }

    setCancelState("cancelling");
    try {
      const res = await fetch(`/api/v1/rfqs/${item.id}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Cancel failed");
      setCancelState("cancelled");
      toast({ title: "RFQ cancelled" });
    } catch {
      setCancelState("error");
      toast({ title: "Failed to cancel", variant: "destructive" });
    }
  }, [item.id]);

  // Derive maker's own quotes
  const myQuotes = connectedAddress
    ? quotes.items.filter(
        (q) => q.maker.toLowerCase() === connectedAddress.toLowerCase(),
      )
    : [];

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Section 1: Summary Header ─────────────────────────────────── */}
      <div className="flex flex-col space-y-1.5 text-left">
        <h2 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
          <span>{item.tokenIn?.symbol ?? "?"}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <span>{item.tokenOut?.symbol ?? "?"}</span>
          <Badge
            variant={statusCfg.variant}
            className={cn("text-xs", statusCfg.className)}
          >
            {statusCfg.label}
          </Badge>
        </h2>
        <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
          <Badge
            variant={isExactIn ? "default" : "secondary"}
            className="text-[10px] px-1.5 py-0"
          >
            {isExactIn ? "Exact In" : "Exact Out"}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 gap-1"
          >
            <Globe className="h-2.5 w-2.5" /> Public
          </Badge>
        </div>
      </div>

      {/* ── Amounts box ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {isExactIn ? "Pays (Fixed)" : "Pays"}
            </div>
            <div className="font-mono text-sm font-medium truncate">
              {safeFormatTokenAmount(
                item.amountIn,
                item.tokenIn?.decimals ?? 18,
              )}{" "}
              {item.tokenIn?.symbol ?? "?"}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {isExactIn ? "Receives" : "Receives (Fixed)"}
            </div>
            <div className="font-mono text-sm font-medium truncate">
              {safeFormatTokenAmount(
                item.amountOut,
                item.tokenOut?.decimals ?? 18,
              )}{" "}
              {item.tokenOut?.symbol ?? "?"}
            </div>
          </div>
        </div>

        {/* TTL */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">TTL</span>
          <span
            className={cn(
              "flex items-center gap-1 font-mono",
              isExpired
                ? "text-muted-foreground"
                : isUrgent
                  ? "text-warning animate-pulse"
                  : "text-foreground",
            )}
          >
            <Clock className="h-3 w-3" />
            {formattedTime}
          </span>
        </div>

        {/* Requester */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Requester</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono">
              {formatAddress(item.taker as `0x${string}`, 6)}
            </span>
            {isTaker && (
              <Badge
                variant="outline"
                className="text-[9px] px-1 py-0 border-primary/50 text-primary"
              >
                You
              </Badge>
            )}
            {!isTaker && <TakerBadge address={item.taker} />}
            <CopyButton
              text={item.taker}
              field="taker"
              copied={copied}
              onCopy={handleCopy}
            />
          </div>
        </div>
      </div>

      {/* ── Section 2: Venue Comparison ────────────────────────────────── */}
      {(item.status === "OPEN" || item.status === "QUOTED") && (
        <VenueComparisonSection
          venueResult={venueResult}
          loading={venueLoading}
          tokenOut={item.tokenOut}
          onRefresh={refreshVenues}
        />
      )}

      {/* ── Section 3: Quotes ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Quotes ({quotes.loading ? "..." : item.quoteCount})
        </h4>

        {quotes.loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading quotes...
          </div>
        ) : !isConnected ? (
          /* Not connected: show count only */
          <div className="text-xs text-muted-foreground py-4 text-center">
            {item.quoteCount > 0
              ? `${item.quoteCount} quote(s) received. Connect wallet to view details.`
              : "No quotes yet."}
          </div>
        ) : isTaker ? (
          /* Taker view: show all quotes */
          quotes.items.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <MessageSquare className="h-6 w-6 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No quotes yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {quotes.items.map((q, i) => (
                <QuoteCard key={i} quote={q} item={item} />
              ))}
            </div>
          )
        ) : (
          /* Maker view: show own quotes + hint */
          <div className="space-y-2">
            {myQuotes.length > 0 &&
              myQuotes.map((q, i) => (
                <QuoteCard key={i} quote={q} item={item} />
              ))}
            {item.quoteCount > myQuotes.length && (
              <p className="text-xs text-muted-foreground italic">
                {item.quoteCount - myQuotes.length} other quote(s) exist
              </p>
            )}
            {myQuotes.length === 0 && item.quoteCount === 0 && (
              <div className="flex flex-col items-center py-6 text-center">
                <MessageSquare className="h-6 w-6 text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground">No quotes yet</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 4: Actions ────────────────────────────────────────── */}
      <div className="space-y-3 pt-2 border-t border-border/30">
        {/* Taker: Cancel */}
        {isTaker && item.status === "OPEN" && (
          <Button
            variant="destructive"
            className="w-full gap-2"
            disabled={
              cancelState === "cancelling" || cancelState === "cancelled"
            }
            onClick={handleCancel}
          >
            {cancelState === "cancelling" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancelling...
              </>
            ) : cancelState === "cancelled" ? (
              <>
                <Check className="h-3.5 w-3.5" /> Cancelled
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5" /> Cancel RFQ
              </>
            )}
          </Button>
        )}

        {/* Maker: Quote panel */}
        {isMaker &&
          (item.status === "OPEN" || item.status === "QUOTED") &&
          !isExpired && (
            <FeedQuotePanel
              item={item}
              connectedAddress={connectedAddress!}
              benchmarkAmountOut={bestVenueAmountOut || undefined}
              existingQuoteCount={quotes.items.length}
              bestExistingAmountOut={(() => {
                if (quotes.items.length === 0) return undefined;
                const amounts = quotes.items
                  .map((q) => { try { return BigInt(q.amountOut); } catch { return 0n; } })
                  .filter((a) => a > 0n);
                if (amounts.length === 0) return undefined;
                return amounts.reduce((a, b) => (a > b ? a : b)).toString();
              })()}
            />
          )}

        {/* Not connected */}
        {!isConnected &&
          (item.status === "OPEN" || item.status === "QUOTED") && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Connect wallet to interact with this RFQ
            </p>
          )}
      </div>

      {/* ── Open in Swap ─────────────────────────────────────────────── */}
      {(item.status === "OPEN" || item.status === "QUOTED") && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          asChild
        >
          <a href={buildSwapDeepLink(item)}>
            Open in Swap (prefilled){" "}
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      )}

      {/* ── Footer: Fill TX + RFQ ID ──────────────────────────────────── */}
      {item.fillTxHash && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Fill Transaction</div>
          <a
            href={`${explorerUrl}/tx/${item.fillTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-mono transition-colors"
          >
            {item.fillTxHash.slice(0, 16)}...
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="flex items-center justify-between text-xs pt-1 border-t border-border/20">
        <span className="text-muted-foreground">RFQ ID</span>
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-[10px] truncate max-w-[180px]">
            {item.id}
          </span>
          <CopyButton
            text={item.id}
            field="id"
            copied={copied}
            onCopy={handleCopy}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuoteCard — displays a single maker quote
// ---------------------------------------------------------------------------

function QuoteCard({
  quote,
  item,
}: {
  quote: RFQQuoteJSON;
  item: FeedRfqItem;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-2.5 text-xs space-y-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Maker</span>
        <span className="font-mono">
          {formatAddress(quote.maker as `0x${string}`, 4)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Offers</span>
        <span className="font-mono">
          {safeFormatTokenAmount(
            quote.amountOut,
            item.tokenOut?.decimals ?? 18,
          )}{" "}
          {item.tokenOut?.symbol}
        </span>
      </div>
      {quote.expiry && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Expires</span>
          <span className="text-muted-foreground">
            {new Date(quote.expiry * 1000).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VenueComparisonSection — HyperCore Spot + HyperEVM DEX benchmarks
// ---------------------------------------------------------------------------

// failureReasonText removed — use venueFailureText from @/lib/venueComparison

function VenueComparisonSection({
  venueResult,
  loading,
  tokenOut,
  onRefresh,
}: {
  venueResult: VenueComparisonResult | null;
  loading: boolean;
  tokenOut: { symbol: string; decimals: number } | null;
  onRefresh: () => void;
}) {
  const sym = tokenOut?.symbol ?? "";
  const dec = tokenOut?.decimals ?? 18;

  const venues = [
    { id: "hypercore", label: "HyperCore Spot", sublabel: "L2 order book", venue: venueResult?.hypercore ?? null },
    { id: "evm", label: "HyperEVM DEX", sublabel: "ht.xyz routing", venue: venueResult?.dex ?? null },
  ];

  const hasAnyData = venues.some((v) =>
    (v.venue?.ok === true && v.venue.estimate.amountOut > 0n) ||
    v.venue?.ok === "partial"
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5 text-primary" />
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Venue Comparison
          </h4>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      <div className="space-y-2">
        {venues.map((v) => {
          const isSuccess = v.venue?.ok === true && v.venue.estimate.amountOut > 0n;
          const isPartial = v.venue?.ok === "partial";
          const partial = isPartial ? (v.venue as VenuePartial) : null;

          return (
            <div
              key={v.id}
              className={cn(
                "rounded-lg border p-3",
                isPartial
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-border/50 bg-muted/10"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{v.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {v.sublabel}
                  </span>
                  {isPartial && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/50 text-amber-600 dark:text-amber-400">
                      {(partial!.filledPct * 100).toFixed(1)}%
                    </Badge>
                  )}
                </div>
                {isSuccess ? (
                  <span className="font-mono text-xs font-medium">
                    {formatAmount((v.venue as { ok: true; estimate: AMMEstimate }).estimate.amountOut, dec, 2)} {sym}
                  </span>
                ) : isPartial ? (
                  <span className="font-mono text-xs font-medium text-amber-600 dark:text-amber-400">
                    {formatAmount(partial!.filledOut, dec, 2)} {sym}
                  </span>
                ) : loading ? (
                  <span className="text-[10px] text-muted-foreground italic">
                    Calculating...
                  </span>
                ) : v.venue && v.venue.ok === false ? (
                  <span className="text-[10px] text-muted-foreground italic">
                    {venueFailureText(v.venue.reason, v.id === "hypercore" ? "hypercore" : "dex")}
                  </span>
                ) : null}
              </div>
              {isSuccess && (() => {
                const result = v.venue as { ok: true; slippageVsMid: number | null; estimate: AMMEstimate };
                const impact = result.slippageVsMid ?? result.estimate.priceImpact;
                return impact != null && impact > 0 ? (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Slippage: {impact.toFixed(2)}%
                  </div>
                ) : null;
              })()}
              {isPartial && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  Slippage (filled): {partial!.slippagePct.toFixed(2)}%
                </div>
              )}
            </div>
          );
        })}

        {!loading && !hasAnyData && venueResult && (
          <p className="text-[10px] text-muted-foreground text-center py-1">
            No venue estimates available for this pair
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// buildSwapDeepLink — construct /swap?... URL from feed item
// ---------------------------------------------------------------------------

function buildSwapDeepLink(item: FeedRfqItem): string {
  const params = new URLSearchParams();
  if (item.tokenIn) params.set("tokenIn", item.tokenIn.address);
  if (item.tokenOut) params.set("tokenOut", item.tokenOut.address);
  params.set("mode", item.kind === 0 ? "EXACT_IN" : "EXACT_OUT");
  if (item.kind === 0 && item.amountIn) params.set("amountIn", item.amountIn);
  if (item.kind === 1 && item.amountOut) params.set("amountOut", item.amountOut);
  return `/swap?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// CopyButton — small copy icon with feedback
// ---------------------------------------------------------------------------

function CopyButton({
  text,
  field,
  copied,
  onCopy,
}: {
  text: string;
  field: string;
  copied: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5 shrink-0"
      onClick={(e) => {
        e.stopPropagation();
        onCopy(text, field);
      }}
    >
      {copied === field ? (
        <Check className="h-3 w-3 text-success" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
}
