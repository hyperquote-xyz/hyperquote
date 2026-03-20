"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Select removed — TTL uses a plain numeric input now
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { TokenSelector } from "./TokenSelector";
import { VisibilitySelector } from "./VisibilitySelector";
import { ExportRFQPanel } from "./PrivateSharePanel";
import { QuoteCard } from "./QuoteCard";
// ComparisonCard removed — replaced by inline QuoteComparisonPanel
import { QuoteComparisonPanel } from "./swap/QuoteComparisonPanel";
import { RFQDebugPanel } from "./swap/RFQDebugPanel";
import { LiveRFQsPanel } from "./swap/LiveRFQsPanel";
import { ExecutionPanel } from "./ExecutionPanel";
// JSONExchange import removed — manual quote copy/paste UI removed from production
import { BlockTradeCTA } from "./BlockTradeCTA";
import { FavoriteMakerPills } from "./FavoriteMakerPills";
import { useFavoriteMakers } from "@/hooks/useFavoriteMakers";
import { useAMMBaseline } from "@/hooks/useAMMBaseline";
import { useTakerRFQ } from "@/hooks/useRFQ";
import {
  useQuoteValidatorBatch,
  useQuoteValidator,
} from "@/hooks/useQuoteValidator";
import { useUsdEstimate } from "@/hooks/useUsdEstimate";
import {
  QuoteKind,
  RFQVisibility,
  RFQRequest,
  RFQRequestJSON,
  Token,
  RFQQuote,
  QuoteWithMeta,
  requestToJSON,
} from "@/types";
import { DEFAULT_TOKENS, getTokenByAddress } from "@/config/tokens";
import { resolveSettlementToken, isNativeHype } from "@/lib/native-wrap";
import { validateLaunchPair, isSameTokenPair } from "@/lib/pairValidation";
import { useWrapUnwrap } from "@/hooks/useWrapUnwrap";
import { WrapModal } from "@/components/WrapModal";
import {
  parseAmount,
  formatAmount,
  toDecimalStr,
  formatUsd,
  enrichQuote,
  calculateFee,
  cn,
  safeSymbol,
} from "@/lib/utils";
import { useVenueComparison } from "@/hooks/useVenueComparison";
import { RFQ_CONTRACT_ADDRESS } from "@/config/contracts";
import {
  ArrowDownUp,
  AlertTriangle,
  Info,
  Clock,
  Zap,
  Globe,
  Lock,
  X,
  Users,
} from "lucide-react";

// ---------------------------------------------------------------------------
// TTL config — min 10s, max 86,400s (24 h)
// ---------------------------------------------------------------------------
const TTL_MIN = 10;
const TTL_MAX = 86_400;

function clampTTL(seconds: number): number {
  return Math.max(TTL_MIN, Math.min(TTL_MAX, Math.floor(seconds)));
}

// ---------------------------------------------------------------------------
// Token pair helpers
// ---------------------------------------------------------------------------
/** True when both tokens resolve to the same settlement address (HYPE ↔ WHYPE = same pair). */
// Pair validation is centralized in src/lib/pairValidation.ts
// isSameTokenPair and validateLaunchPair imported above

// ---------------------------------------------------------------------------
// Address validation helper for private RFQ recipients
// ---------------------------------------------------------------------------
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function validateAddresses(
  input: string
): { valid: `0x${string}`[]; error: string | null } {
  if (!input.trim()) return { valid: [], error: null };
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  const invalid: string[] = [];
  const valid: `0x${string}`[] = [];
  for (const part of parts) {
    if (ADDR_RE.test(part)) {
      valid.push(part as `0x${string}`);
    } else {
      invalid.push(part.length > 12 ? part.slice(0, 12) + "…" : part);
    }
  }
  if (invalid.length > 0) {
    return { valid, error: `Invalid address${invalid.length > 1 ? "es" : ""}: ${invalid.join(", ")}` };
  }
  return { valid, error: null };
}

// ---------------------------------------------------------------------------
// Venue estimate refresh intervals
// ---------------------------------------------------------------------------
// Venue comparison is handled by useVenueComparison hook (unified service).
// Refresh cadence:
//   • On input change: 1.2s debounce then fetch
//   • While active RFQ: poll every 30s (live comparison)
//   • No active RFQ: no polling (data from last fetch persists)
// On refresh, only successful results overwrite the previous value.
// Failed fetches preserve the last known good value.
const VENUE_POLL_MS = 30_000; // poll every 30s while active RFQ

// Whale nudge — suggest private mode for large trades to reduce info leakage
// TODO: make this configurable per-pair or API-driven
const WHALE_NUDGE_THRESHOLD_USD = 100_000;

interface SwapInterfaceProps {
  initialParams?: {
    tokenIn?: string;    // address
    tokenOut?: string;   // address
    amountIn?: string;   // raw BigInt string
    amountOut?: string;  // raw BigInt string
    mode?: "EXACT_IN" | "EXACT_OUT";
  };
}

export function SwapInterface({ initialParams }: SwapInterfaceProps = {}) {
  const { address, isConnected } = useAccount();
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

  // Form state
  const [mode, setMode] = useState<"EXACT_IN" | "EXACT_OUT">("EXACT_IN");
  const [tokenIn, setTokenIn] = useState<Token | null>(DEFAULT_TOKENS[1]);
  const [tokenOut, setTokenOut] = useState<Token | null>(DEFAULT_TOKENS[0]);
  const [amountIn, setAmountIn] = useState("");
  const [amountOut, setAmountOut] = useState("");
  const [minOut, setMinOut] = useState("");
  const [maxIn, setMaxIn] = useState("");
  const [ttlInput, setTtlInput] = useState("60");
  const [needsApproval, setNeedsApproval] = useState(true);
  const [visibility, setVisibility] = useState<RFQVisibility>("public");

  // ── Deep-link prefill from query params ──
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!initialParams || prefilled) return;

    if (initialParams.mode) {
      setMode(initialParams.mode);
    }

    if (initialParams.tokenIn) {
      const t = getTokenByAddress(initialParams.tokenIn);
      if (t) setTokenIn(t);
    }

    if (initialParams.tokenOut) {
      const t = getTokenByAddress(initialParams.tokenOut);
      if (t) setTokenOut(t);
    }

    if (initialParams.amountIn) {
      const t = initialParams.tokenIn
        ? getTokenByAddress(initialParams.tokenIn)
        : null;
      if (t) {
        try {
          setAmountIn(
            formatAmount(BigInt(initialParams.amountIn), t.decimals, 6),
          );
        } catch {
          /* ignore bad input */
        }
      }
    }

    if (initialParams.amountOut) {
      const t = initialParams.tokenOut
        ? getTokenByAddress(initialParams.tokenOut)
        : null;
      if (t) {
        try {
          setAmountOut(
            formatAmount(BigInt(initialParams.amountOut), t.decimals, 6),
          );
        } catch {
          /* ignore bad input */
        }
      }
    }

    setPrefilled(true);
  }, [initialParams, prefilled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Private RFQ recipients ──
  const [recipients, setRecipients] = useState<`0x${string}`[]>([]);
  const [recipientsInput, setRecipientsInput] = useState("");
  const [recipientsError, setRecipientsError] = useState<string | null>(null);

  // ── Favorite makers ──
  const { favorites, removeFavorite, addMultiple, loaded: favoritesLoaded } = useFavoriteMakers();
  const [selectedFavorites, setSelectedFavorites] = useState<Set<string>>(new Set());
  const [blockTradeActivated, setBlockTradeActivated] = useState(false);
  const recipientsRef = useRef<HTMLDivElement>(null);

  // Clear recipients + selected favorites when switching to public
  useEffect(() => {
    if (visibility === "public") {
      setRecipients([]);
      setRecipientsInput("");
      setRecipientsError(null);
      setSelectedFavorites(new Set());
      setBlockTradeActivated(false);
    }
  }, [visibility]);

  // Active RFQ count (server-side limit tracking)
  const [activeRfqCount, setActiveRfqCount] = useState<{ public: number; private: number } | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);

  // ── HYPE wrap/unwrap ──
  const { whypeBalance, refetch: refetchWrapBalances } = useWrapUnwrap();
  const [showWrapGating, setShowWrapGating] = useState(false);
  const [wrapGatingAction, setWrapGatingAction] = useState<"request" | "fill" | null>(null);
  const [showUnwrapNudge, setShowUnwrapNudge] = useState(false);
  // Store token context when gating triggers — retry is discarded if tokens change
  const wrapGatingContextRef = useRef<{ tokenInAddr: string; tokenOutAddr: string } | null>(null);

  // Clear wrap gating when tokens change
  useEffect(() => {
    setShowWrapGating(false);
    setWrapGatingAction(null);
    setShowUnwrapNudge(false);
  }, [tokenIn?.address, tokenOut?.address]);

  // USD price estimates (reusable hook)
  const { usdValue: usdValueIn } = useUsdEstimate(tokenIn, amountIn);
  const { usdValue: usdValueOut } = useUsdEstimate(tokenOut, amountOut);

  // Selected RFQ for quote comparison — driven by clicking rows in LiveRFQsPanel.
  // Declared before venue comparison so the hook receives the selected RFQ's params.
  const [selectedRfqId, setSelectedRfqId] = useState<string | null>(null);

  // Auto-select: default to most recent active RFQ, fall back when selected expires/cancels
  useEffect(() => {
    const active = trackedRequests.filter((t) => t.status === "active");
    if (active.length === 0) {
      setSelectedRfqId((prev) => (prev !== null ? null : prev));
      return;
    }
    setSelectedRfqId((prev) => {
      const stillActive = active.some((t) => t.request.id === prev);
      if (stillActive) return prev; // keep current selection
      return active[0].request.id; // fall back to most recent
    });
  }, [trackedRequests]);

  // Venue comparison uses the SELECTED active RFQ's parameters — switching
  // RFQs immediately clears stale data and reloads for the new selection.
  const selectedActiveTracked = trackedRequests.find(
    (t) => t.request.id === selectedRfqId && t.status === "active"
  );
  const hasActiveRFQ = selectedActiveTracked != null;

  const venueTokenIn  = selectedActiveTracked?.request.tokenIn  ?? null;
  const venueTokenOut = selectedActiveTracked?.request.tokenOut  ?? null;
  const venueAmountIn = selectedActiveTracked?.request.amountIn != null
    ? toDecimalStr(selectedActiveTracked.request.amountIn, selectedActiveTracked.request.tokenIn.decimals)
    : "";

  const {
    result: venueResult,
    loading: venueLoading,
    everFetched: venueEverFetched,
    updatedAt: venueUpdatedAt,
    refresh: refreshVenues,
  } = useVenueComparison({
    tokenIn:  venueTokenIn,
    tokenOut: venueTokenOut,
    amountIn: venueAmountIn,
    rfqId: selectedRfqId,
    pollIntervalMs: hasActiveRFQ ? VENUE_POLL_MS : 0,
    enabled: hasActiveRFQ && !isSameTokenPair(venueTokenIn, venueTokenOut),
  });
  // Convenience accessors for downstream components
  const hlEstimate = venueResult?.hypercore.ok === true ? venueResult.hypercore.estimate : null;
  const hsEstimate = venueResult?.dex.ok === true ? venueResult.dex.estimate : null;
  const midPriceRef = venueResult?.midRef ?? null;

  // ── AMM Baseline (SOR) ──
  const baseline = useAMMBaseline(tokenIn, tokenOut, amountIn);

  // ── Validation ──
  const validationResults = useQuoteValidatorBatch(
    currentRequest,
    receivedQuotes
  );
  const selectedValidation = useQuoteValidator(
    currentRequest,
    selectedQuote
  );

  // Enrich quotes
  const enrichedQuotes: QuoteWithMeta[] = receivedQuotes
    .filter((q) => tokenIn && tokenOut)
    .map((q) => enrichQuote(q, tokenIn!, tokenOut!, feePips));

  // Best quote — only among validated
  const bestQuote =
    enrichedQuotes.length > 0
      ? enrichedQuotes.reduce((best, current) => {
          if (current.isExpired) return best;
          const vr = validationResults.get(current.signature);
          const isValid =
            vr?.status === "valid" || vr?.status === "expiring_soon";
          if (!isValid) return best;
          if (!best) return current;
          const bestVr = validationResults.get(best.signature);
          const bestIsValid =
            bestVr?.status === "valid" || bestVr?.status === "expiring_soon";
          if (!bestIsValid) return current;
          if (mode === "EXACT_IN") {
            return current.amountOut > best.amountOut ? current : best;
          } else {
            return current.amountIn < best.amountIn ? current : best;
          }
        }, null as QuoteWithMeta | null)
      : null;

  const selectedEnriched =
    selectedQuote && tokenIn && tokenOut
      ? enrichQuote(selectedQuote, tokenIn, tokenOut, feePips)
      : null;

  // Compute price improvement of selected quote vs best venue (for success overlay)
  const priceImprovementBps = (() => {
    if (!selectedEnriched) return null;
    const venueAmounts: bigint[] = [];
    if (hlEstimate && hlEstimate.amountOut > 0n) venueAmounts.push(hlEstimate.amountOut);
    if (hsEstimate && hsEstimate.amountOut > 0n) venueAmounts.push(hsEstimate.amountOut);
    if (venueAmounts.length === 0) return null;
    const bestVenue = venueAmounts.reduce((a, b) => (a > b ? a : b));
    if (bestVenue <= 0n) return null;
    return Number(selectedEnriched.amountOut - bestVenue) / Number(bestVenue) * 10000;
  })();

  // ---------------------------------------------------------------------------
  // Active RFQ count — fetch from server when wallet or request changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!address) {
      setActiveRfqCount(null);
      return;
    }
    fetch(`/api/rfq?wallet=${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.public === "number") setActiveRfqCount(data);
      })
      .catch(() => {}); // graceful degradation
  }, [address, currentRequest]);

  // Venue estimates are now managed by useVenueComparison hook above.
  // The hook handles: debounce, retry, AbortController, polling, last-known-good.

  /** Resolved TTL in seconds (clamped to 10–86,400) */
  const resolvedTtl = (() => {
    const parsed = parseInt(ttlInput, 10);
    return isNaN(parsed) ? 60 : clampTTL(parsed);
  })();

  // Swap tokens (flip pair + mode) — clear all derived state to avoid leakage
  const handleSwapTokens = () => {
    const tempToken = tokenIn;
    setTokenIn(tokenOut);
    setTokenOut(tempToken);
    const tempAmount = amountIn;
    setAmountIn(amountOut);
    setAmountOut(tempAmount);
    setMode(mode === "EXACT_IN" ? "EXACT_OUT" : "EXACT_IN");
    // Clear constraints — they reference the old pair direction
    setMinOut("");
    setMaxIn("");
    // Venue estimates auto-clear via useVenueComparison's token-change detection
  };

  // Mode tab switch — clear the non-editable field, the now-irrelevant
  // constraint, AND any derived state to prevent stale / inconsistent values.
  //   EXACT_IN  → amountIn editable, amountOut quoted  → clear amountOut + maxIn
  //   EXACT_OUT → amountOut editable, amountIn quoted   → clear amountIn  + minOut
  const handleModeChange = (newMode: "EXACT_IN" | "EXACT_OUT") => {
    if (newMode === mode) return;
    setMode(newMode);
    if (newMode === "EXACT_IN") {
      setAmountOut("");
      setMaxIn("");
    } else {
      setAmountIn("");
      setMinOut("");
    }
    // Venue estimates auto-clear when amountIn changes (useVenueComparison handles this)
  };

  // Create request
  const handleCreateRequest = async () => {
    console.log("[HyperQuote] handleCreateRequest called", {
      tokenIn: tokenIn?.symbol,
      tokenOut: tokenOut?.symbol,
      amountIn,
      amountOut,
      address,
      walletConnected: !!address,
    });

    // Centralized pair validation
    const pairCheck = validateLaunchPair(tokenIn, tokenOut);
    if (!pairCheck.valid) {
      toast({
        title: "Invalid pair",
        description: pairCheck.message ?? "Please select a valid token pair",
        variant: "destructive",
      });
      return;
    }

    // TypeScript narrowing: validateLaunchPair guarantees both are non-null if valid
    if (!tokenIn || !tokenOut) return;

    const kind =
      mode === "EXACT_IN" ? QuoteKind.EXACT_IN : QuoteKind.EXACT_OUT;

    let parsedAmountIn: bigint | undefined;
    let parsedAmountOut: bigint | undefined;
    let parsedMinOut: bigint | undefined;
    let parsedMaxIn: bigint | undefined;

    try {
      if (mode === "EXACT_IN") {
        if (!amountIn) {
          toast({
            title: "Enter amount",
            description: "Please enter the amount you want to swap",
            variant: "destructive",
          });
          return;
        }
        parsedAmountIn = parseAmount(amountIn, tokenIn.decimals);
        parsedMinOut = minOut ? parseAmount(minOut, tokenOut.decimals) : 0n;
      } else {
        if (!amountOut) {
          toast({
            title: "Enter amount",
            description: "Please enter the amount you want to receive",
            variant: "destructive",
          });
          return;
        }
        parsedAmountOut = parseAmount(amountOut, tokenOut.decimals);
        parsedMaxIn = maxIn
          ? parseAmount(maxIn, tokenIn.decimals)
          : BigInt(
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            );
      }
    } catch {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid number",
        variant: "destructive",
      });
      return;
    }

    // ── Wrap gating: if tokenIn is native HYPE, check wHYPE balance ──
    const settlementTokenIn = resolveSettlementToken(tokenIn);
    const settlementTokenOut = resolveSettlementToken(tokenOut);

    if (isNativeHype(tokenIn) && parsedAmountIn) {
      const freshBalances = await refetchWrapBalances();
      if (freshBalances.whypeBalance < parsedAmountIn) {
        wrapGatingContextRef.current = { tokenInAddr: tokenIn.address, tokenOutAddr: tokenOut.address };
        setShowWrapGating(true);
        setWrapGatingAction("request");
        return;
      }
    }

    // ── Server-side limit check + registration ──
    // Generate the canonical RFQ ID here so both server and client use the same value.
    const rfqId = crypto.randomUUID();
    const expiryTs = Math.floor(Date.now() / 1000) + resolvedTtl;
    const walletAddr = address ?? "0x0000000000000000000000000000000000000000";
    try {
      const limitRes = await fetch("/api/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddr,
          visibility,
          expiry: expiryTs,
          rfqData: {
            id: rfqId,
            kind,
            taker: walletAddr,
            tokenIn: settlementTokenIn,
            tokenOut: settlementTokenOut,
            amountIn: parsedAmountIn?.toString(),
            amountOut: parsedAmountOut?.toString(),
            minOut: parsedMinOut?.toString(),
            maxIn: parsedMaxIn?.toString(),
            expiry: expiryTs,
            createdAt: Math.floor(Date.now() / 1000),
            visibility,
            ...(visibility === "private" && effectiveRecipients.length > 0
              ? { allowedMakers: effectiveRecipients }
              : {}),
          } satisfies RFQRequestJSON,
        }),
      });
      const limitResult = await limitRes.json();
      console.log("[HyperQuote] Limit check result:", limitResult);
      if (!limitResult.allowed) {
        console.warn("[HyperQuote] Request blocked by limit check:", limitResult.reason);
        toast({
          title: "Request limit reached",
          description: limitResult.reason ?? "Too many active RFQs",
          variant: "destructive",
        });
        return;
      }
      // Store share token for private requests
      if (limitResult.shareToken) setShareToken(limitResult.shareToken);
      if (limitResult.activeCount) setActiveRfqCount(limitResult.activeCount);
    } catch {
      // API unreachable — proceed anyway (graceful degradation)
      console.warn("[HyperQuote] RFQ limit API unreachable, proceeding without server validation");
    }

    console.log("[HyperQuote] Calling createRequest...", { address, walletConnected: !!address });
    const request = createRequest({
      id: rfqId, // Use the same ID registered with the server
      kind,
      tokenIn: settlementTokenIn,
      tokenOut: settlementTokenOut,
      amountIn: parsedAmountIn,
      amountOut: parsedAmountOut,
      minOut: parsedMinOut,
      maxIn: parsedMaxIn,
      ttlSeconds: resolvedTtl,
      visibility,
      allowedMakers: visibility === "private" && effectiveRecipients.length > 0 ? effectiveRecipients : undefined,
      // Pass current AMM baseline for persistence (captured from displayed state)
      baseline: baseline.data && baseline.data.summary.amountOut !== "0"
        ? {
            amountOut: baseline.data.summary.amountOut,
            effectivePrice: baseline.data.summary.effectivePrice,
            priceImpactBps: baseline.data.summary.priceImpactBps,
            blockNumber: baseline.data.meta.asOfBlock,
            timestamp: baseline.data.meta.timestamp,
            routes: baseline.data.routes.map((r) => ({
              protocol: r.hops[0]?.protocol ?? "unknown",
              poolType: r.hops[0]?.poolType ?? "unknown",
              fractionPct: r.fractionPct,
            })),
          }
        : null,
    });

    console.log("[HyperQuote] createRequest returned:", request ? `id=${request.id}` : "null (wallet not connected?)");

    if (request) {
      const isPrivate = visibility === "private";
      toast({
        title: isPrivate ? "Private request created!" : "Request created!",
        description: isPrivate
          ? "Share the request directly with your preferred makers"
          : "Your request is live on the public feed",
      });

      // Trigger venue comparison refresh after RFQ creation
      refreshVenues();
    }
  };

  // Import quote handler — retained for future use (relay quote import, CLI paste, etc.)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleImportQuote = (json: string): boolean => {
    const quote = importQuoteJSON(json);
    if (quote) {
      toast({
        title: "Quote imported",
        description: "Validating signature…",
      });
    } else {
      toast({
        title: "Invalid quote",
        description: "Could not parse the pasted JSON.",
        variant: "destructive",
      });
    }
    return quote !== null;
  };

  // Check allowance when quote is selected — always use settlement token (WHYPE for HYPE)
  useEffect(() => {
    if (selectedQuote && tokenIn && address) {
      const settlement = resolveSettlementToken(tokenIn);
      checkAllowance(settlement.address, selectedQuote.amountIn).then(
        (hasAllowance) => {
          setNeedsApproval(!hasAllowance);
        }
      );
    }
  }, [selectedQuote, tokenIn, address, checkAllowance]);

  const handleApprove = async () => {
    if (!selectedQuote || !tokenIn) return;
    const settlement = resolveSettlementToken(tokenIn);
    const ok = await approveToken(settlement.address, selectedQuote.amountIn);
    if (ok) {
      setNeedsApproval(false);
      selectedValidation.revalidate();
    }
  };

  const handleFill = async () => {
    if (!selectedQuote) return;

    const sv = selectedValidation.status;
    if (sv !== "valid" && sv !== "expiring_soon" && sv !== "needs_approval") {
      toast({
        title: "Cannot fill",
        description:
          sv === "invalid_signature"
            ? "Quote signature is invalid or does not match maker."
            : sv === "expired"
              ? "Quote has expired."
              : "Quote validation has not completed.",
        variant: "destructive",
      });
      return;
    }

    // ── Wrap gating before fill (if tokenIn is HYPE) ──
    if (tokenIn && isNativeHype(tokenIn)) {
      const freshBalances = await refetchWrapBalances();
      if (freshBalances.whypeBalance < selectedQuote.amountIn) {
        wrapGatingContextRef.current = { tokenInAddr: tokenIn.address, tokenOutAddr: tokenOut?.address ?? "" };
        setShowWrapGating(true);
        setWrapGatingAction("fill");
        return;
      }
    }

    let constraint: bigint;
    if (selectedQuote.kind === QuoteKind.EXACT_IN) {
      constraint =
        minOut && tokenOut
          ? parseAmount(minOut, tokenOut.decimals)
          : selectedQuote.amountOut;
    } else {
      constraint =
        maxIn && tokenIn
          ? parseAmount(maxIn, tokenIn.decimals)
          : selectedQuote.amountIn;
    }

    const ok = await fillQuote(selectedQuote, constraint, { amountInUsd: usdValueIn ?? 0, visibility });

    // Show unwrap nudge if tokenOut was native HYPE (user received wHYPE)
    if (ok && tokenOut && isNativeHype(tokenOut)) {
      setShowUnwrapNudge(true);
    }
  };

  // ── Block Trade CTA handler ──
  const handleStartBlockTrade = useCallback(() => {
    setVisibility("private");
    setBlockTradeActivated(true);
    // Scroll to recipients area after React re-render
    setTimeout(() => {
      recipientsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, []);

  // ── Favorite makers callbacks ──
  const handleToggleFavorite = useCallback((addr: `0x${string}`) => {
    setSelectedFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) {
        next.delete(addr);
      } else {
        next.add(addr);
      }
      return next;
    });
  }, []);

  const handleSaveRecipientsToFavorites = useCallback(() => {
    if (recipients.length > 0) {
      addMultiple(recipients);
    }
  }, [recipients, addMultiple]);

  const handleClearFavoriteSelection = useCallback(() => {
    setSelectedFavorites(new Set());
  }, []);

  // ── Effective recipients = union(manual, selected favorites) — deduplicated ──
  const effectiveRecipients = useMemo(() => {
    const set = new Set<`0x${string}`>(recipients);
    for (const addr of selectedFavorites) {
      set.add(addr as `0x${string}`);
    }
    return Array.from(set);
  }, [recipients, selectedFavorites]);

  const showMinOutWarning = mode === "EXACT_IN" && !minOut && amountIn;
  const showMaxInWarning = mode === "EXACT_OUT" && !maxIn && amountOut;
  const isPrivateRequest = currentRequest?.visibility === "private";

  // Derive the selected tracked RFQ for the export panel
  const selectedTracked = trackedRequests.find((t) => t.request.id === selectedRfqId);
  const selectedRequest = selectedTracked?.request ?? null;
  // isSelectedPrivate removed — was only used by JSONExchange block

  // Formatted labels for the export panel context line
  const selectedPairLabel = selectedRequest
    ? `${safeSymbol(selectedRequest.tokenIn)} → ${safeSymbol(selectedRequest.tokenOut)}`
    : undefined;
  const selectedSizeLabel = (() => {
    if (!selectedRequest) return undefined;
    const isExactIn = selectedRequest.kind === QuoteKind.EXACT_IN;
    if (isExactIn && selectedRequest.amountIn != null) {
      return `${formatAmount(selectedRequest.amountIn, selectedRequest.tokenIn.decimals, 2)} ${safeSymbol(selectedRequest.tokenIn)}`;
    }
    if (!isExactIn && selectedRequest.amountOut != null) {
      return `${formatAmount(selectedRequest.amountOut!, selectedRequest.tokenOut.decimals, 2)} ${safeSymbol(selectedRequest.tokenOut)}`;
    }
    return undefined;
  })();

  return (
    <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column - Swap Form */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Request Quote
              </CardTitle>
              <Tabs
                value={mode}
                onValueChange={(v) =>
                  handleModeChange(v as "EXACT_IN" | "EXACT_OUT")
                }
              >
                <TabsList>
                  <TabsTrigger value="EXACT_IN">Exact In</TabsTrigger>
                  <TabsTrigger value="EXACT_OUT">Exact Out</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ── RFQ Visibility (top of form — first decision) ── */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                RFQ Visibility
              </Label>
              <VisibilitySelector
                value={visibility}
                onChange={setVisibility}
              />
            </div>

            {/* ── Allowed Makers + Favorites (private mode only) ── */}
            {visibility === "private" && (
              <>
                <div ref={recipientsRef} className="rounded-lg border border-border/50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Allowed Makers</Label>
                  </div>
                  <Input
                    placeholder="0xabc…, 0xdef…"
                    value={recipientsInput}
                    onChange={(e) => {
                      setRecipientsInput(e.target.value);
                      const { valid, error } = validateAddresses(e.target.value);
                      setRecipients(valid);
                      setRecipientsError(error);
                    }}
                    className="h-9 text-sm font-mono"
                  />
                  {recipientsError && (
                    <p className="text-xs text-destructive">{recipientsError}</p>
                  )}
                  {effectiveRecipients.length > 0 && !recipientsError && (
                    <p className="text-xs text-muted-foreground">
                      Recipients: {effectiveRecipients.length} address{effectiveRecipients.length !== 1 ? "es" : ""} will be allowed to quote
                    </p>
                  )}
                  {effectiveRecipients.length === 0 && !recipientsInput && (
                    <p className="text-xs text-muted-foreground">
                      Optional. Leave empty to create a private request and share it manually.
                    </p>
                  )}
                </div>

                {/* ── Favorite Makers ── */}
                <FavoriteMakerPills
                  favorites={favorites}
                  selectedFavorites={selectedFavorites}
                  onToggle={handleToggleFavorite}
                  onRemove={removeFavorite}
                  onSaveCurrentRecipients={handleSaveRecipientsToFavorites}
                  onClear={handleClearFavoriteSelection}
                  hasManualRecipients={recipients.length > 0}
                />

                {/* Block Trade confirmation helper */}
                {blockTradeActivated && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Lock className="h-3 w-3" />
                    Not broadcast to the public feed. Only selected makers can see it.
                  </p>
                )}
              </>
            )}

            {/* ── Whale nudge — suggest private for large trades ── */}
            {visibility === "public" && usdValueIn != null && usdValueIn >= WHALE_NUDGE_THRESHOLD_USD && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <p className="text-sm font-medium text-amber-600">
                    Large trade detected
                  </p>
                  <p className="text-xs text-amber-600/80">
                    Trades over $100k may benefit from private RFQs to reduce information leakage and get better pricing.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                    onClick={handleStartBlockTrade}
                  >
                    <Lock className="h-3 w-3 mr-1" />
                    Prefer privacy? Start a Block Trade &rarr;
                  </Button>
                </div>
              </div>
            )}

            {/* Token In */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {mode === "EXACT_IN" ? "Sell (Fixed)" : "Sell"}
              </Label>
              <div className="flex gap-2">
                <TokenSelector
                  selectedToken={tokenIn}
                  onSelect={setTokenIn}
                  excludeToken={tokenOut}
                  mode="rfq"
                />
                <Input
                  type="text"
                  placeholder="0.0"
                  value={amountIn}
                  onChange={(e) => setAmountIn(e.target.value)}
                  disabled={mode === "EXACT_OUT"}
                  className={cn(
                    "flex-1 text-lg font-mono",
                    mode === "EXACT_OUT" && "opacity-50"
                  )}
                />
              </div>
              {tokenIn && isNativeHype(tokenIn) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-primary/70 pl-1 cursor-help flex items-center gap-1">
                        Settles as wHYPE
                        <Info className="h-3 w-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-[220px]">
                        HYPE is wrapped to wHYPE (ERC-20) for on-chain settlement. You can wrap/unwrap anytime from the header.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {usdValueIn != null && (
                <span className="text-xs text-muted-foreground pl-1">
                  ≈ {formatUsd(usdValueIn)} (est)
                </span>
              )}
              {mode === "EXACT_OUT" && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">
                      Max In
                    </Label>
                    <Input
                      type="text"
                      placeholder="No limit"
                      value={maxIn}
                      onChange={(e) => setMaxIn(e.target.value)}
                      className="h-8 text-sm font-mono"
                    />
                    {showMaxInWarning && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="h-4 w-4 text-warning" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              Setting no maxIn may expose you to unfavorable rates
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 pl-0.5">
                    Maximum you&apos;re willing to pay (slippage protection)
                  </p>
                  {maxIn && amountIn && (() => {
                    const maxInNum = parseFloat(maxIn);
                    const amountInNum = parseFloat(amountIn);
                    if (!isFinite(maxInNum) || !isFinite(amountInNum) || amountInNum === 0) return null;
                    const slippagePct = ((maxInNum - amountInNum) / amountInNum) * 100;
                    if (slippagePct < 0) return (
                      <span className="text-[11px] text-blue-400 pl-0.5">
                        Max is below your requested amount
                      </span>
                    );
                    return (
                      <span className={cn(
                        "text-[11px] pl-0.5",
                        slippagePct > 5 ? "text-amber-400" : "text-muted-foreground"
                      )}>
                        {slippagePct > 5 && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                        Slippage tolerance: {slippagePct.toFixed(2)}%
                        {slippagePct > 5 && " — high slippage"}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Swap Button */}
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSwapTokens}
                className="rounded-full border border-border/50 hover:border-primary hover:bg-primary/10"
              >
                <ArrowDownUp className="h-4 w-4" />
              </Button>
            </div>

            {/* Token Out */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {mode === "EXACT_OUT"
                  ? "Buy (Fixed)"
                  : "Buy"}
              </Label>
              <div className="flex gap-2">
                <TokenSelector
                  selectedToken={tokenOut}
                  onSelect={setTokenOut}
                  excludeToken={tokenIn}
                  mode="rfq"
                />
                <Input
                  type="text"
                  placeholder="0.0"
                  value={amountOut}
                  onChange={(e) => setAmountOut(e.target.value)}
                  disabled={mode === "EXACT_IN"}
                  className={cn(
                    "flex-1 text-lg font-mono",
                    mode === "EXACT_IN" && "opacity-50"
                  )}
                />
              </div>
              {tokenOut && isNativeHype(tokenOut) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-primary/70 pl-1 cursor-help flex items-center gap-1">
                        Settles as wHYPE
                        <Info className="h-3 w-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-[220px]">
                        You will receive wHYPE (ERC-20). You can unwrap to native HYPE anytime from the header.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {usdValueOut != null && (
                <span className="text-xs text-muted-foreground pl-1">
                  ≈ {formatUsd(usdValueOut)} (est)
                </span>
              )}
              {mode === "EXACT_IN" && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">
                      Min Out
                    </Label>
                    <Input
                      type="text"
                      placeholder="No minimum"
                      value={minOut}
                      onChange={(e) => setMinOut(e.target.value)}
                      className="h-8 text-sm font-mono"
                    />
                    {showMinOutWarning && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="h-4 w-4 text-warning" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              Setting no minOut may result in a worse rate than
                              expected
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 pl-0.5">
                    Minimum output to accept (slippage protection)
                  </p>
                  {minOut && amountOut && (() => {
                    const minOutNum = parseFloat(minOut);
                    const amountOutNum = parseFloat(amountOut);
                    if (!isFinite(minOutNum) || !isFinite(amountOutNum) || amountOutNum === 0) return null;
                    const slippagePct = ((amountOutNum - minOutNum) / amountOutNum) * 100;
                    if (slippagePct < 0) return (
                      <span className="text-[11px] text-blue-400 pl-0.5">
                        Min is above your requested amount
                      </span>
                    );
                    return (
                      <span className={cn(
                        "text-[11px] pl-0.5",
                        slippagePct > 5 ? "text-amber-400" : "text-muted-foreground"
                      )}>
                        {slippagePct > 5 && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                        Slippage tolerance: {slippagePct.toFixed(2)}%
                        {slippagePct > 5 && " — high slippage"}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* TTL — single numeric input, clamped 10–86,400s */}
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <Label className="text-sm text-muted-foreground whitespace-nowrap">
                Quote TTL
              </Label>
              <Input
                type="number"
                min={TTL_MIN}
                max={TTL_MAX}
                value={ttlInput}
                onChange={(e) => setTtlInput(e.target.value)}
                className="w-[100px] h-8 text-sm font-mono"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                seconds ({TTL_MIN}–{TTL_MAX.toLocaleString()})
              </span>
            </div>

            {/* Fee Info */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              <span>
                Protocol fee: 2.5 bps (0.025%) on input token. Gas paid by
                taker.
              </span>
            </div>

            {/* ── Visibility Confirmation ── */}
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                visibility === "public"
                  ? "bg-primary/5 text-primary"
                  : "bg-muted/50 text-muted-foreground"
              )}
            >
              {visibility === "public" ? (
                <>
                  <Globe className="h-4 w-4 shrink-0" />
                  <span>This RFQ will be visible on the public feed.</span>
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>This RFQ will NOT be visible publicly.</span>
                </>
              )}
            </div>

            {/* Active RFQ Count */}
            {activeRfqCount && (
              <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                <span>Active: {activeRfqCount.public}/3 public</span>
                <span className="text-border">|</span>
                <span>{activeRfqCount.private}/5 private</span>
              </div>
            )}

            {/* ── Wrap gating callout ── */}
            {showWrapGating && tokenIn && isNativeHype(tokenIn) && (() => {
              const requiredRaw = wrapGatingAction === "fill" && selectedQuote
                ? selectedQuote.amountIn
                : amountIn
                  ? (() => { try { return parseAmount(amountIn, tokenIn.decimals); } catch { return 0n; } })()
                  : 0n;
              const missing = requiredRaw > whypeBalance ? requiredRaw - whypeBalance : 0n;
              const missingHuman = formatAmount(missing, 18);
              return (
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2">
                  <div className="flex items-start gap-2 text-sm text-amber-600">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Wrap required</div>
                      <div className="text-xs text-amber-600/80 mt-0.5">
                        This trade settles in wHYPE. You need to wrap {missingHuman} HYPE to continue.
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <WrapModal
                      trigger={
                        <Button size="sm" className="flex-1">
                          Wrap &amp; Continue
                        </Button>
                      }
                      defaultTab="wrap"
                      defaultAmount={missingHuman}
                      onWrapSuccess={() => {
                        setShowWrapGating(false);
                        // Auto-retry the blocked action — but only if tokens haven't changed
                        const ctx = wrapGatingContextRef.current;
                        const tokensMatch = ctx
                          && tokenIn?.address === ctx.tokenInAddr
                          && tokenOut?.address === ctx.tokenOutAddr;
                        if (tokensMatch && wrapGatingAction === "request") {
                          setTimeout(() => handleCreateRequest(), 300);
                        } else if (tokensMatch && wrapGatingAction === "fill") {
                          setTimeout(() => handleFill(), 300);
                        }
                        wrapGatingContextRef.current = null;
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowWrapGating(false);
                        setWrapGatingAction(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* Inline pair validation message */}
            {tokenIn && tokenOut && (() => {
              const v = validateLaunchPair(tokenIn, tokenOut);
              if (v.valid || !v.message) return null;
              return (
                <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {v.message}
                </div>
              );
            })()}

            {/* Request Button */}
            <Button
              size="lg"
              className="w-full"
              onClick={handleCreateRequest}
              disabled={
                !isConnected ||
                (!amountIn && !amountOut) ||
                !validateLaunchPair(tokenIn, tokenOut).valid
              }
            >
              {!isConnected
                ? "Connect wallet"
                : !tokenIn || !tokenOut
                  ? "Select tokens"
                  : isSameTokenPair(tokenIn, tokenOut)
                    ? "Select two different tokens"
                    : mode === "EXACT_IN" && !amountIn
                      ? "Enter amount"
                      : mode === "EXACT_OUT" && !amountOut
                        ? "Enter amount"
                        : visibility === "private"
                          ? `Create private request${effectiveRecipients.length > 0 ? ` (${effectiveRecipients.length})` : ""}`
                          : "Request quote"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Post-Request Panels — driven by selectedRfqId ── */}
        <ExportRFQPanel
          requestJSON={selectedRequest ? JSON.stringify(requestToJSON(selectedRequest), null, 2) : null}
          requestId={selectedRequest?.id}
          shareToken={selectedRequest?.id === currentRequest?.id ? shareToken : null}
          pairLabel={selectedPairLabel}
          sizeLabel={selectedSizeLabel}
          visibility={selectedRequest?.visibility}
        />
        {/* JSONExchange (manual quote copy/paste) removed — quote delivery
            is handled by the relay. Import logic retained in handleImportQuote
            for potential future use. */}

        {/* Received Quotes */}
        {enrichedQuotes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Received Quotes ({enrichedQuotes.length})
            </h3>
            <div className="grid gap-3">
              {enrichedQuotes.map((quote) => (
                <QuoteCard
                  key={quote.signature}
                  quote={quote}
                  tokenIn={tokenIn!}
                  tokenOut={tokenOut!}
                  validation={validationResults.get(quote.signature)}
                  isSelected={
                    selectedQuote?.signature === quote.signature
                  }
                  isBest={bestQuote?.signature === quote.signature}
                  onSelect={() => setSelectedQuote(quote)}
                  baselineAmountOut={
                    baseline.data?.summary.amountOut !== "0"
                      ? baseline.data?.summary.amountOut ?? null
                      : null
                  }
                  midPriceRef={midPriceRef}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Column - Comparison & Execution */}
      <div className="space-y-6">
        {/* ── Block Trade CTA — hidden when already in private mode ── */}
        {visibility !== "private" && (
          <BlockTradeCTA onStartBlockTrade={handleStartBlockTrade} />
        )}

        {/* ── Contract Warning Banner ── */}
        {RFQ_CONTRACT_ADDRESS === ("0x0" as `0x${string}`) && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Contract not configured</strong> — Set <code className="font-mono">NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS</code> in .env.local for on-chain execution.
            </span>
          </div>
        )}

        {/* ── Your Live RFQs + Maker Quotes ── */}
        <LiveRFQsPanel
          trackedRequests={trackedRequests}
          currentRequestId={currentRequest?.id ?? null}
          onCancel={cancelRFQ}
          enrichedQuotes={enrichedQuotes}
          bestQuote={bestQuote}
          selectedQuoteSignature={selectedQuote?.signature ?? null}
          onSelectQuote={setSelectedQuote}
          receivedQuotes={receivedQuotes}
          validationResults={validationResults}
          tokenIn={tokenIn}
          tokenOut={tokenOut}
          selectedRfqId={selectedRfqId}
          onSelectRfq={setSelectedRfqId}
          baselineAmountOut={
            baseline.data?.summary.amountOut !== "0"
              ? baseline.data?.summary.amountOut ?? null
              : null
          }
          midPriceRef={midPriceRef}
        />

        <ExecutionPanel
          quote={selectedEnriched}
          tokenIn={tokenIn!}
          tokenOut={tokenOut!}
          txState={txState}
          needsApproval={needsApproval}
          validation={
            selectedQuote ? selectedValidation : undefined
          }
          minOut={
            minOut && tokenOut
              ? parseAmount(minOut, tokenOut.decimals)
              : selectedEnriched?.amountOut ?? 0n
          }
          maxIn={
            maxIn && tokenIn
              ? parseAmount(maxIn, tokenIn.decimals)
              : selectedEnriched?.amountIn ??
                BigInt(
                  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
                )
          }
          onApprove={handleApprove}
          onFill={handleFill}
          onReset={reset}
          priceImprovementBps={priceImprovementBps}
        />

        {/* ── Venue Comparison — always visible, fetches only after RFQ submit ── */}
        <QuoteComparisonPanel
          venueResult={venueResult}
          tokenIn={tokenIn}
          tokenOut={tokenOut}
          loading={venueLoading}
          everFetched={venueEverFetched}
          updatedAt={venueUpdatedAt}
          bestQuote={bestQuote}
          hasActiveRFQ={hasActiveRFQ}
        />

        {/* ── Unwrap nudge after receiving wHYPE ── */}
        {showUnwrapNudge && txState.status === "success" && tokenOut && isNativeHype(tokenOut) && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-sm">
            <span className="flex-1 text-muted-foreground">
              You received wHYPE.{" "}
            </span>
            <WrapModal
              trigger={
                <Button variant="outline" size="sm">
                  Unwrap to HYPE
                </Button>
              }
              defaultTab="unwrap"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUnwrapNudge(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {(currentRequest ||
          receivedQuotes.length > 0 ||
          txState.status !== "idle") && (
          <Button variant="outline" className="w-full" onClick={reset}>
            New Quote Request
          </Button>
        )}

        {/* ── RFQ Debug (Advanced — collapsible) ── */}
        {(currentRequest || selectedEnriched) && (
          <RFQDebugPanel
            mode={mode}
            request={currentRequest}
            selectedQuote={selectedEnriched}
            tokenIn={tokenIn}
            tokenOut={tokenOut}
            minOut={minOut}
            maxIn={maxIn}
          />
        )}
      </div>

    </div>
  );
}

