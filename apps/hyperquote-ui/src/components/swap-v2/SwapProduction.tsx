"use client";

/**
 * SwapProduction — Production Swap Interface (v2 layout + v1 business logic)
 *
 * This is the production replacement for SwapInterface.tsx.
 * Uses the v2 two-column layout with real RFQ hooks:
 * - useTakerRFQ (relay, quotes, execution)
 * - useQuoteValidator (signature validation)
 * - useVenueComparison (HC + PRJX DEX references)
 * - useWrapUnwrap (HYPE ↔ WHYPE gating)
 * - useUsdEstimate (USD pricing)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAccount } from "wagmi";
import { toast } from "@/components/ui/use-toast";
import { useTakerRFQ } from "@/hooks/useRFQ";
import { useQuoteValidatorBatch, useQuoteValidator } from "@/hooks/useQuoteValidator";
import { useVenueComparison } from "@/hooks/useVenueComparison";
import { useWrapUnwrap } from "@/hooks/useWrapUnwrap";
import { useUsdEstimate } from "@/hooks/useUsdEstimate";
import { useFavoriteMakers } from "@/hooks/useFavoriteMakers";
import { QuoteKind, RFQVisibility, Token, QuoteWithMeta, requestToJSON, RFQQuoteJSON } from "@/types";
import { DEFAULT_TOKENS, getTokenByAddress, NATIVE_HYPE } from "@/config/tokens";
import { APPROVED_TOKEN_MAP } from "@/config/approvedTokens";
import { resolveSettlementToken, isNativeHype } from "@/lib/native-wrap";
import { checkMakerSolvency, makerIssueMessage } from "@/lib/makerSolvency";
import { validateLaunchPair, isSameTokenPair } from "@/lib/pairValidation";
import { parseAmount, formatAmount, toDecimalStr, enrichQuote, cn, safeSymbol } from "@/lib/utils";
import { WrapModal } from "@/components/WrapModal";
import { ConfirmSwapModal } from "./ConfirmSwapModal";
import { useQuotePolling } from "@/hooks/useQuotePolling";
import { SwapForm } from "./SwapForm";
import { LiveQuotesPanel } from "./LiveQuotesPanel";
import type { MakerQuote, ExpiredQuote, MarketReference } from "./useMockQuotes";
import { fmtNum } from "./formatNumber";
import {
  selectPublicBestRoute,
  computeTheoretical,
  type PublicBestRoute,
  type TheoreticalRef,
  type VenueCandidate,
} from "@/lib/reference-engine";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TTL_MIN = 10;
const TTL_MAX = 86_400;
const VENUE_POLL_MS = 30_000;

function clampTTL(s: number) { return Math.max(TTL_MIN, Math.min(TTL_MAX, Math.floor(s))); }

// ---------------------------------------------------------------------------
// Data transformation — real hooks → v2 UI shapes
// ---------------------------------------------------------------------------

function transformMakerQuotes(
  enriched: QuoteWithMeta[],
  validationResults: Map<string, { status: string }>,
): { live: MakerQuote[]; expired: ExpiredQuote[] } {
  const live: MakerQuote[] = [];
  const expired: ExpiredQuote[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const q of enriched) {
    if (q.isExpired) {
      expired.push({
        id: q.signature,
        address: `${q.maker.slice(0, 6)}…${q.maker.slice(-4)}`,
        price: q.price ?? 0,
        expiredAgo: now - q.expiry,
      });
    } else {
      const vr = validationResults.get(q.signature);
      const isRefreshing = vr?.status === "validating";
      live.push({
        id: q.signature,
        address: `${q.maker.slice(0, 6)}…${q.maker.slice(-4)}`,
        price: q.price ?? 0,
        amountOut: formatAmount(q.amountOut, q.tokenOutDecimals ?? 18),
        status: isRefreshing ? "refreshing" : "live",
      });
    }
  }

  live.sort((a, b) => b.price - a.price);
  return { live, expired };
}

/**
 * Build 3-row reference display: Public Best Route + HyperCore Spot + Theoretical
 * from all venue results using the reference engine.
 */
function buildReferenceRows(
  venueResult: ReturnType<typeof useVenueComparison>["result"],
  tokenIn: Token | null,
  tokenOut: Token | null,
  amountIn: string,
  usdValueIn: number | null,
): { refs: MarketReference[]; bestRoute: PublicBestRoute | null; theoretical: TheoreticalRef | null } {
  const refs: MarketReference[] = [];
  let bestRoute: PublicBestRoute | null = null;
  let theoretical: TheoreticalRef | null = null;

  if (!venueResult || !tokenOut) return { refs, bestRoute, theoretical };

  const decOut = tokenOut.decimals ?? 18;
  const parsedIn = parseFloat(amountIn) || 0;
  const rawSymIn = tokenIn ? safeSymbol(tokenIn) : "?";
  const rawSymOut = tokenOut ? safeSymbol(tokenOut) : "?";
  // Normalize WHYPE → HYPE for user-facing display
  const symIn = rawSymIn === "WHYPE" ? "HYPE" : rawSymIn;
  const symOut = rawSymOut === "WHYPE" ? "HYPE" : rawSymOut;

  // Normalize WHYPE → HYPE in display strings and remove consecutive duplicates
  const normRoute = (r: string) => r.replace(/WHYPE/g, "HYPE").replace(/(HYPE)\s*→\s*\1/g, "HYPE");

  // Get USD prices from midRef for computing USD values
  const priceIn = venueResult.midRef?.priceIn ?? 0;
  const priceOut = venueResult.midRef?.priceOut ?? 0;
  const computeUsd = (tokenAmount: number) => priceOut > 0 ? tokenAmount * priceOut : 0;

  // --- Build venue candidates for Public Best Route ---
  const candidates: VenueCandidate[] = [];

  // HyperCore
  const hc = venueResult.hypercore;
  let hcHumanOut = 0;
  if (hc.ok === true) {
    hcHumanOut = Number(hc.estimate.amountOut) / 10 ** decOut;
    const isImplied = hc.routeLabel.split("→").length > 2;
    candidates.push({ source: "HyperCore", amountOut: hcHumanOut, route: hc.estimate.route ?? (hc.routeLabel?.split(" → ") || []), status: isImplied ? "OK_ROUTED_USDC" : "OK_DIRECT", fillRatio: 1.0, slippagePct: hc.slippageVsMid ?? 0 });
  } else if (hc.ok === "partial") {
    hcHumanOut = Number(hc.filledOut) / 10 ** decOut;
    candidates.push({ source: "HyperCore", amountOut: hcHumanOut, route: hc.routeLabel?.split(" → ") || [], status: "PARTIAL_FILL", fillRatio: hc.filledPct, slippagePct: hc.slippageVsMid ?? 0 });
  }

  // PRJX
  const dex = venueResult.dex;
  let prjxHumanOut = 0;
  if (dex.ok === true) {
    prjxHumanOut = Number(dex.estimate.amountOut) / 10 ** decOut;
    const routeArr = dex.estimate.route ?? [];
    const isRouted = routeArr.length > 2;
    const intermediates = isRouted ? routeArr.slice(1, -1) : [];
    const through = intermediates.includes("USDC") ? "USDC" : intermediates.includes("HYPE") ? "HYPE" : null;
    candidates.push({ source: "PRJX DEX", amountOut: prjxHumanOut, route: routeArr, status: isRouted ? (through === "USDC" ? "OK_ROUTED_USDC" : "OK_ROUTED_WHYPE") : "OK_DIRECT", fillRatio: 1.0, slippagePct: dex.slippageVsMid ?? 0 });
  }

  // HT R1
  const ht = venueResult.ht;
  let htHumanOut = 0;
  if (ht.ok === true) {
    htHumanOut = Number(ht.estimate.amountOut) / 10 ** decOut;
    const htRouteArr = ht.estimate.route ?? [];
    const isRouted = htRouteArr.length > 2;
    const htIntermediates = isRouted ? htRouteArr.slice(1, -1) : [];
    const through = htIntermediates.includes("USDC") ? "USDC" : htIntermediates.includes("HYPE") ? "HYPE" : null;
    candidates.push({ source: "HT Aggregator", amountOut: htHumanOut, route: htRouteArr, status: isRouted ? (through === "USDC" ? "OK_ROUTED_USDC" : through === "HYPE" ? "OK_ROUTED_WHYPE" : "OK_DIRECT") : "OK_DIRECT", fillRatio: 1.0, slippagePct: ht.slippageVsMid ?? 0 });
  }

  // --- ROW 1: Public Best Route ---
  bestRoute = selectPublicBestRoute(candidates);
  if (bestRoute) {
    const ratePerToken = parsedIn > 0 ? bestRoute.amountOut / parsedIn : 0;
    refs.push({
      id: "best-route", label: "Public Best Route", price: bestRoute.amountOut,
      usdValue: computeUsd(bestRoute.amountOut),
      routeDescription: normRoute(`Source: ${bestRoute.source} | Route: ${bestRoute.routeLabel}`),
      rateDescription: parsedIn > 0 ? `1 ${symIn} = ${fmtNum(ratePerToken, ratePerToken >= 1 ? 4 : 6)} ${symOut}` : undefined,
      status: bestRoute.status, userMessage: `${bestRoute.userMessage} · Confidence: ${bestRoute.confidenceLabel}`,
      confidence: bestRoute.confidenceLabel, source: bestRoute.source,
    });
  } else {
    refs.push({ id: "best-route", label: "Public Best Route", price: 0, routeDescription: "No executable public route found", noRoute: true, status: "REFERENCE_UNAVAILABLE", userMessage: "Reference unavailable" });
  }

  // --- ROW 2: HyperCore Spot ---
  if (hc.ok === true || hc.ok === "partial") {
    const ratePerToken = parsedIn > 0 ? hcHumanOut / parsedIn : 0;
    const isImplied = hc.ok === true && hc.routeLabel.split("→").length > 2;
    refs.push({
      id: "hypercore", label: "HyperCore Spot", price: hcHumanOut,
      usdValue: computeUsd(hcHumanOut),
      routeDescription: isImplied ? `Implied: ${symIn} → USDC → ${symOut}` : `Direct: ${symIn}/${symOut}`,
      rateDescription: parsedIn > 0 ? `1 ${symIn} = ${fmtNum(ratePerToken, ratePerToken >= 1 ? 4 : 6)} ${symOut}` : undefined,
      status: hc.ok === "partial" ? "PARTIAL_FILL" : (isImplied ? "OK_ROUTED_USDC" : "OK_DIRECT"),
      userMessage: hc.ok === "partial" ? `Partial fill: ${(hc.filledPct * 100).toFixed(0)}%` : (isImplied ? "Routed through USDC" : "Valid direct route"),
      confidence: hc.ok === true ? "High" : "Moderate", source: "HyperCore",
    });
  } else {
    refs.push({
      id: "hypercore", label: "HyperCore Spot", price: 0,
      routeDescription: `${symIn} → ${symOut}`, noRoute: true,
      status: "NO_ROUTE", userMessage: "HyperCore reference unavailable",
    });
  }

  // --- ROW 3: Theoretical ---
  // Theoretical = frictionless mid-price cross-rate. NOT from Public Best Route.
  // Priority: 1. HC mid-price, 2. HT Aggregator, 3. PRJX pool, 4. unavailable
  const midRef = venueResult.midRef;

  if (midRef && priceIn > 0 && priceOut > 0 && parsedIn > 0) {
    // HC mid-price cross-rate: amountIn × (priceIn / priceOut)
    const theoreticalOut = parsedIn * priceIn / priceOut;
    theoretical = computeTheoretical({ amountIn: parsedIn, midRef, htPriceIn: null, htPriceOut: null, prjxAmountOut: null });
    refs.push({
      id: "last-trade", label: "Theoretical", price: theoreticalOut,
      usdValue: computeUsd(theoreticalOut),
      routeDescription: `Derived from last traded price on HyperCore`,
      rateDescription: `@ $${fmtNum(priceIn, 4)} / $${fmtNum(priceOut, 4)}`,
      status: "OK_DIRECT", userMessage: "Mid-price cross-rate",
      confidence: "High", source: "HyperCore",
    });
  } else if (htHumanOut > 0 && parsedIn > 0) {
    // Fallback 2: HT Aggregator market pricing
    theoretical = computeTheoretical({ amountIn: parsedIn, midRef: null, htPriceIn: null, htPriceOut: null, prjxAmountOut: htHumanOut });
    refs.push({
      id: "last-trade", label: "Theoretical", price: htHumanOut,
      usdValue: computeUsd(htHumanOut),
      routeDescription: "Derived from HT Aggregator pricing",
      status: "OK_DIRECT", userMessage: "Based on aggregated market pricing",
      confidence: "Moderate", source: "HT Aggregator",
    });
  } else if (prjxHumanOut > 0 && parsedIn > 0) {
    // Fallback 3: PRJX pool pricing
    theoretical = computeTheoretical({ amountIn: parsedIn, midRef: null, htPriceIn: null, htPriceOut: null, prjxAmountOut: prjxHumanOut });
    refs.push({
      id: "last-trade", label: "Theoretical", price: prjxHumanOut,
      usdValue: computeUsd(prjxHumanOut),
      routeDescription: "Derived from PRJX pool pricing",
      status: "OK_DIRECT", userMessage: "Based on on-chain pool pricing",
      confidence: "Moderate", source: "PRJX DEX",
    });
  } else {
    theoretical = computeTheoretical({ amountIn: parsedIn, midRef: null, htPriceIn: null, htPriceOut: null, prjxAmountOut: null });
    refs.push({
      id: "last-trade", label: "Theoretical", price: 0,
      routeDescription: "Mid-price reference unavailable", noRoute: true,
      status: "REFERENCE_UNAVAILABLE", userMessage: "Reference unavailable",
    });
  }

  return { refs, bestRoute, theoretical };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SwapProductionProps {
  initialParams?: {
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    amountOut?: string;
    mode?: "EXACT_IN" | "EXACT_OUT";
  };
}

export function SwapProduction({ initialParams }: SwapProductionProps = {}) {
  const { address, isConnected } = useAccount();

  // ── RFQ Engine ──
  const {
    currentRequest,
    receivedQuotes,
    selectedQuote,
    txState,
    feePips,
    trackedRequests,
    createRequest,
    exportRequestJSON,
    importQuoteJSON,
    setSelectedQuote,
    checkAllowance,
    approveToken,
    fillQuote,
    cancelRFQ,
    reset,
  } = useTakerRFQ();

  // ── Quote polling (database fallback) ──
  const isExpired = currentRequest
    ? currentRequest.expiry <= Math.floor(Date.now() / 1000)
    : true;

  const { quotes: polledQuotes } = useQuotePolling({
    rfqId: currentRequest?.id ?? null,
    enabled: !!currentRequest && !isExpired,
    intervalMs: 3000,
    onNewQuote: useCallback((q: RFQQuoteJSON) => {
      importQuoteJSON(JSON.stringify(q));
    }, [importQuoteJSON]),
  });

  // ── Confirmation modal ──
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [makerIssue, setMakerIssue] = useState<string | null>(null);

  // ── Form state ──
  const [tokenIn, setTokenIn] = useState<Token | null>(NATIVE_HYPE);
  const [tokenOut, setTokenOut] = useState<Token | null>(APPROVED_TOKEN_MAP.get("USDC") ?? DEFAULT_TOKENS[0]);
  const [amountIn, setAmountIn] = useState("");
  const [visibility, setVisibility] = useState<RFQVisibility>("public");
  const [selectedMakers, setSelectedMakers] = useState<string[]>([]);
  const [needsApproval, setNeedsApproval] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  // ── Deep-link prefill ──
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!initialParams || prefilled) return;
    if (initialParams.tokenIn) { const t = getTokenByAddress(initialParams.tokenIn); if (t) setTokenIn(t); }
    if (initialParams.tokenOut) { const t = getTokenByAddress(initialParams.tokenOut); if (t) setTokenOut(t); }
    if (initialParams.amountIn && initialParams.tokenIn) {
      const t = getTokenByAddress(initialParams.tokenIn);
      if (t) try { setAmountIn(toDecimalStr(BigInt(initialParams.amountIn), t.decimals)); } catch { /* */ }
    }
    setPrefilled(true);
  }, [initialParams, prefilled]);

  // ── Wrap/unwrap ──
  const { whypeBalance, refetch: refetchWrapBalances } = useWrapUnwrap();
  const [showWrapGating, setShowWrapGating] = useState(false);
  const [showUnwrapNudge, setShowUnwrapNudge] = useState(false);
  useEffect(() => { setShowWrapGating(false); setShowUnwrapNudge(false); }, [tokenIn?.address, tokenOut?.address]);

  // ── USD estimates ──
  const { usdValue: usdValueIn, usdPrice: usdPriceIn } = useUsdEstimate(tokenIn, amountIn);
  const { usdPrice: usdPriceOut } = useUsdEstimate(tokenOut, "1");

  // ── Venue comparison ──
  const activeTracked = trackedRequests.find(t => t.status === "active");
  const hasActiveRFQ = activeTracked != null;
  const venueTokenIn = activeTracked?.request.tokenIn ?? null;
  const venueTokenOut = activeTracked?.request.tokenOut ?? null;
  const venueAmountIn = activeTracked?.request.amountIn != null
    ? toDecimalStr(activeTracked.request.amountIn, activeTracked.request.tokenIn.decimals)
    : "";

  const {
    result: venueResult,
    loading: venueLoading,
    refresh: refreshVenues,
  } = useVenueComparison({
    tokenIn: venueTokenIn,
    tokenOut: venueTokenOut,
    amountIn: venueAmountIn,
    pollIntervalMs: hasActiveRFQ ? VENUE_POLL_MS : 0,
    enabled: hasActiveRFQ && !isSameTokenPair(venueTokenIn, venueTokenOut),
  });

  // ── Quote validation ──
  const validationResults = useQuoteValidatorBatch(currentRequest, receivedQuotes);
  const selectedValidation = useQuoteValidator(currentRequest, selectedQuote);

  // ── Enrich + transform quotes for v2 UI ──
  const enrichedQuotes: QuoteWithMeta[] = receivedQuotes
    .filter(() => tokenIn && tokenOut)
    .map(q => enrichQuote(q, tokenIn!, tokenOut!, feePips));

  const { live: makerQuotes, expired: expiredQuotes } = useMemo(
    () => transformMakerQuotes(enrichedQuotes, validationResults),
    [enrichedQuotes, validationResults]
  );

  const bestMaker = makerQuotes.length > 0
    ? makerQuotes.reduce((best, q) => q.price > best.price ? q : best, makerQuotes[0])
    : null;

  // ── Market references from venue comparison ──
  const { refs: references, bestRoute, theoretical } = useMemo(
    () => buildReferenceRows(venueResult, venueTokenIn, venueTokenOut, venueAmountIn, usdValueIn),
    [venueResult, venueTokenIn, venueTokenOut, venueAmountIn, usdValueIn]
  );

  // ── BPS calculation: maker vs Public Best Route ──
  const bpsVsBestRoute = bestMaker && bestRoute && bestRoute.amountOut > 0
    ? Math.round(((bestMaker.price - bestRoute.amountOut) / bestRoute.amountOut) * 10000) : 0;
  // Keep bpsVsCore/bpsVsDex as 0 — we only show "vs Public Best Route" now
  const bpsVsDex = 0;
  const bpsVsCore = bpsVsBestRoute;

  // ── RFQ countdown + auto-expiry ──
  const [countdown, setCountdown] = useState(30);
  useEffect(() => {
    if (!currentRequest) return;
    const iv = setInterval(() => {
      const remaining = currentRequest.expiry - Math.floor(Date.now() / 1000);
      setCountdown(Math.max(0, remaining));
      // Auto-expire: when RFQ TTL reaches 0, reset UI to idle
      if (remaining <= 0) {
        console.log("[SwapProduction] RFQ expired, auto-resetting");
        setIsSearching(false);
        reset();
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [currentRequest]);

  // ── Ref countdown ──
  const [refCountdown, setRefCountdown] = useState(4);
  useEffect(() => {
    if (!hasActiveRFQ) return;
    const iv = setInterval(() => setRefCountdown(c => c <= 1 ? 4 : c - 1), 1000);
    return () => clearInterval(iv);
  }, [hasActiveRFQ]);

  // ── Allowance tracking ──
  useEffect(() => {
    if (selectedQuote && tokenIn && address) {
      const settlement = resolveSettlementToken(tokenIn);
      checkAllowance(settlement.address, selectedQuote.amountIn).then(has => setNeedsApproval(!has));
    }
  }, [selectedQuote, tokenIn, address, checkAllowance]);

  // ── Create RFQ (Find Best Price) ──
  const handleFindPrice = useCallback(async () => {
    console.log("[SwapProduction] handleFindPrice called", { tokenIn: tokenIn?.symbol, tokenOut: tokenOut?.symbol, amountIn, address, isConnected });

    // Auto-cancel any existing active RFQ — v2 allows only one at a time
    if (currentRequest) {
      console.log("[SwapProduction] auto-cancelling previous RFQ:", currentRequest.id);
      cancelRFQ(currentRequest.id);
      reset();
      // Brief pause to let the cancellation propagate
      await new Promise(r => setTimeout(r, 200));
    }

    const pairCheck = validateLaunchPair(tokenIn, tokenOut);
    if (!pairCheck.valid) {
      console.log("[SwapProduction] pair validation failed:", pairCheck.message);
      toast({ title: "Invalid pair", description: pairCheck.message ?? "Select a valid pair", variant: "destructive" });
      return;
    }
    if (!tokenIn || !tokenOut || !amountIn) { console.log("[SwapProduction] missing token/amount"); return; }

    let parsedAmountIn: bigint;
    try { parsedAmountIn = parseAmount(amountIn, tokenIn.decimals); }
    catch { console.log("[SwapProduction] parseAmount failed"); toast({ title: "Invalid amount", variant: "destructive" }); return; }

    console.log("[SwapProduction] parsedAmountIn:", parsedAmountIn.toString());

    // Wrap gating
    if (isNativeHype(tokenIn)) {
      console.log("[SwapProduction] native HYPE detected, checking wrap balance...");
      const fresh = await refetchWrapBalances();
      console.log("[SwapProduction] whypeBalance:", fresh.whypeBalance.toString(), "needed:", parsedAmountIn.toString());
      if (fresh.whypeBalance < parsedAmountIn) { console.log("[SwapProduction] wrap gating triggered"); setShowWrapGating(true); return; }
    }

    const settlementIn = resolveSettlementToken(tokenIn);
    const settlementOut = resolveSettlementToken(tokenOut);
    const rfqId = crypto.randomUUID();
    const ttlSeconds = 180; // v2 default
    const expiryTs = Math.floor(Date.now() / 1000) + ttlSeconds;
    const walletAddr = address ?? "0x0000000000000000000000000000000000000000";

    // Server limit check
    try {
      const limitRes = await fetch("/api/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddr,
          visibility,
          expiry: expiryTs,
          rfqData: {
            id: rfqId, kind: QuoteKind.EXACT_IN, taker: walletAddr,
            tokenIn: settlementIn, tokenOut: settlementOut,
            amountIn: parsedAmountIn.toString(), minOut: "0",
            expiry: expiryTs, createdAt: Math.floor(Date.now() / 1000),
            visibility,
            ...(visibility === "private" && selectedMakers.length > 0 ? { allowedMakers: selectedMakers } : {}),
          },
        }),
      });
      const result = await limitRes.json();
      if (!result.allowed) {
        toast({ title: "Request limit reached", description: result.reason, variant: "destructive" });
        return;
      }
    } catch (e) { console.log("[SwapProduction] limit check failed (graceful):", e); }

    console.log("[SwapProduction] calling createRequest...", { rfqId, address });
    const request = createRequest({
      id: rfqId,
      kind: QuoteKind.EXACT_IN,
      tokenIn: settlementIn,
      tokenOut: settlementOut,
      amountIn: parsedAmountIn,
      minOut: 0n,
      ttlSeconds,
      visibility,
      allowedMakers: visibility === "private" && selectedMakers.length > 0 ? selectedMakers.map(s => s as `0x${string}`) : undefined,
    });

    console.log("[SwapProduction] createRequest returned:", request ? `id=${request.id}` : "null (wallet not connected?)");
    if (request) {
      setIsSearching(true);
      toast({ title: visibility === "private" ? "Private request created!" : "Request created!" });
      refreshVenues();
    } else {
      console.log("[SwapProduction] createRequest returned null — wallet likely not connected");
      toast({ title: "Wallet required", description: "Connect your wallet to create a swap request", variant: "destructive" });
    }
  }, [tokenIn, tokenOut, amountIn, address, visibility, selectedMakers, createRequest, refetchWrapBalances, refreshVenues, currentRequest, cancelRFQ, reset]);

  // ── Cancel ──
  const handleCancel = useCallback(() => {
    if (currentRequest) cancelRFQ(currentRequest.id);
    setIsSearching(false);
    reset();
  }, [currentRequest, cancelRFQ, reset]);

  // ── Execute swap (opens confirmation modal) ──
  const handleExecute = useCallback(async () => {
    if (!selectedQuote || !tokenIn) return;

    const sv = selectedValidation.status;
    if (sv !== "valid" && sv !== "expiring_soon" && sv !== "needs_approval") {
      toast({ title: "Cannot execute", description: "Quote validation failed", variant: "destructive" });
      return;
    }

    // Wrap gating before fill
    if (isNativeHype(tokenIn)) {
      const fresh = await refetchWrapBalances();
      if (fresh.whypeBalance < selectedQuote.amountIn) { setShowWrapGating(true); return; }
    }

    // Maker solvency gate (blocks execute in the modal).
    const mk = await checkMakerSolvency({
      maker: selectedQuote.maker,
      tokenOut: selectedQuote.tokenOut,
      amountOut: selectedQuote.amountOut,
    });
    setMakerIssue(mk.executable ? null : makerIssueMessage(mk.issue));

    // Open the confirmation modal instead of filling directly
    setConfirmModalOpen(true);
  }, [selectedQuote, tokenIn, selectedValidation, refetchWrapBalances]);

  // ── Confirm execution (called from modal) ──
  const handleConfirmExecute = useCallback(async () => {
    if (!selectedQuote || !tokenIn) return;
    const settlement = resolveSettlementToken(tokenIn);
    const constraint = selectedQuote.amountOut; // minOut for EXACT_IN
    const result = await fillQuote(selectedQuote, constraint, {
      amountInUsd: usdValueIn ?? 0,
      visibility,
    });
    if (result && isNativeHype(tokenOut!)) {
      setShowUnwrapNudge(true);
    }
  }, [selectedQuote, tokenIn, tokenOut, fillQuote, usdValueIn, visibility]);

  // ── Approve from modal ──
  const handleApproveFromModal = useCallback(async () => {
    if (!selectedQuote || !tokenIn) return;
    const settlement = resolveSettlementToken(tokenIn);
    const ok = await approveToken(settlement.address as `0x${string}`, selectedQuote.amountIn);
    if (ok) setNeedsApproval(false);
  }, [selectedQuote, tokenIn, approveToken]);

  // ── Auto-select best quote ──
  useEffect(() => {
    if (enrichedQuotes.length > 0 && !selectedQuote) {
      const best = enrichedQuotes.reduce((b, c) => {
        if (c.isExpired) return b;
        const vr = validationResults.get(c.signature);
        if (vr?.status !== "valid" && vr?.status !== "expiring_soon") return b;
        if (!b) return c;
        return c.amountOut > b.amountOut ? c : b;
      }, null as QuoteWithMeta | null);
      if (best) setSelectedQuote(best);
    }
  }, [enrichedQuotes, selectedQuote, validationResults, setSelectedQuote]);

  // ── Sync isSearching with RFQ state ──
  useEffect(() => {
    if (currentRequest) setIsSearching(true);
    else setIsSearching(false);
  }, [currentRequest]);

  // ── USD per token (derived from live useUsdEstimate) ──
  const usdPerToken = usdValueIn && parseFloat(amountIn) > 0
    ? usdValueIn / parseFloat(amountIn)
    : 0; // no fallback — show nothing if price unavailable

  // ── New best flash ──
  const [newBestFlash, setNewBestFlash] = useState(false);
  const prevBestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bestMaker) return;
    if (prevBestRef.current && prevBestRef.current !== bestMaker.id) {
      setNewBestFlash(true);
      const t = setTimeout(() => setNewBestFlash(false), 800);
      return () => clearTimeout(t);
    }
    prevBestRef.current = bestMaker.id;
  }, [bestMaker]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Swap</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Get competing live quotes from HyperEVM liquidity providers
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Swap Form */}
        <SwapForm
          tokenIn={tokenIn}
          tokenOut={tokenOut}
          amountIn={amountIn}
          visibility={visibility}
          selectedMakers={selectedMakers}
          onTokenInChange={setTokenIn}
          onTokenOutChange={setTokenOut}
          onAmountInChange={setAmountIn}
          onVisibilityChange={setVisibility}
          onSelectedMakersChange={setSelectedMakers}
          onFindPrice={handleFindPrice}
          onCancel={handleCancel}
          isSearching={isSearching}
          bestPrice={bestMaker?.price ?? null}
          mockUsdPerToken={usdPerToken}
        />

        {/* RIGHT — Live Quotes */}
        <LiveQuotesPanel
          makers={makerQuotes}
          expired={expiredQuotes}
          references={references}
          bestMaker={bestMaker}
          countdown={countdown}
          isLive={isSearching && makerQuotes.length > 0}
          isSearching={isSearching}
          tokenOut={tokenOut}
          bpsVsDex={bpsVsDex}
          bpsVsCore={bpsVsCore}
          refCountdown={refCountdown}
          newBestFlash={newBestFlash}
          bestAmountOut={selectedQuote && tokenOut ? formatAmount(selectedQuote.amountOut, tokenOut.decimals) : null}
          onExecute={handleExecute}
        />
      </div>

      {/* Wrap modal — shown when wrap gating triggers */}
      <WrapModal
        trigger={<span />}
        externalOpen={showWrapGating}
        onExternalClose={() => setShowWrapGating(false)}
        onWrapSuccess={() => setShowWrapGating(false)}
      />

      {/* Confirmation modal */}
      <ConfirmSwapModal
        open={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        onConfirm={handleConfirmExecute}
        quote={selectedQuote}
        tokenIn={tokenIn}
        tokenOut={tokenOut}
        amountInUsd={usdValueIn ?? null}
        amountOutUsd={
          selectedQuote && usdPriceOut
            ? Number(formatAmount(selectedQuote.amountOut, tokenOut?.decimals ?? 18)) * usdPriceOut
            : null
        }
        publicBestAmount={
          bestRoute?.amountOut
            ? formatAmount(
                BigInt(Math.round(bestRoute.amountOut * 10 ** (tokenOut?.decimals ?? 18))),
                tokenOut?.decimals ?? 18,
              )
            : null
        }
        feePips={feePips}
        txState={txState}
        needsApproval={needsApproval}
        onApprove={handleApproveFromModal}
        makerIssue={makerIssue}
      />

      {/* Footer */}
      <p className="text-center text-xs text-muted-foreground/70 mt-8">
        Makers compete to beat AMM pricing
      </p>
    </div>
  );
}
