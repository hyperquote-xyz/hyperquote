"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TokenSelector } from "@/components/TokenSelector";
import { OptionsQuoteCard } from "./OptionsQuoteCard";
import { OptionsExecutionPanel } from "./OptionsExecutionPanel";
import { OptionsDebugPanel } from "./OptionsDebugPanel";
import {
  Zap,
  Clock,
  Info,
  Activity,
  Loader2,
  X,
  MessageSquare,
} from "lucide-react";
import { Token } from "@/types";
import { DEFAULT_TOKENS, CORE_TOKENS, NATIVE_HYPE } from "@/config/tokens";
import { resolveSettlementToken, isNativeHype } from "@/lib/native-wrap";
import { formatAmount, cn, safeSymbol, secondsUntilExpiry } from "@/lib/utils";
import { useCountdown } from "@/hooks/useCountdown";
import {
  computeRfqId,
  rfqIdToSignableBytes,
  recoverRfqSigner,
  verifyQuoteSignature,
  recoverQuoteSigner,
  hashQuote,
  putCollateralRequired,
  callCollateralRequired,
  approvalAmount,
  futureExpiry08UTC,
  rfqToJson,
  parseDecimal,
} from "@/lib/options-protocol";
import type { QuoteForVerification } from "@/lib/options-protocol";
import type { Hex, Address } from "viem";
import type {
  OptionSide,
  OptionRFQ,
  OptionQuote,
  OptionQuoteWithMeta,
  OptionTxState,
} from "@/types/options";

// ---------------------------------------------------------------------------
// Config — matches relay/SDK defaults
// ---------------------------------------------------------------------------

const OPTIONS_CHAIN_ID = parseInt(
  process.env.NEXT_PUBLIC_OPTIONS_CHAIN_ID ?? "31337",
);
const OPTIONS_ENGINE_ADDRESS = (process.env.NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS ??
  "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_UNDERLYING =
  CORE_TOKENS.find((t) => t.symbol === "HYPE" && t.isNative) ?? DEFAULT_TOKENS[0];
const DEFAULT_COLLATERAL =
  CORE_TOKENS.find((t) => t.symbol === "USDC") ?? DEFAULT_TOKENS[1];

/** Format a unix timestamp as YYYY-MM-DD 08:00 UTC. */
function formatExpiryDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10) + " 08:00 UTC";
}

// ---------------------------------------------------------------------------
// Enrichment — uses canonical collateral math
// ---------------------------------------------------------------------------

function enrichOptionQuote(
  quote: OptionQuote,
  collateralDecimals: number,
  underlyingDecimals: number,
): OptionQuoteWithMeta {
  const expiresIn = secondsUntilExpiry(quote.deadline);
  const collateralRequired = quote.isCall
    ? callCollateralRequired(quote.quantity)
    : putCollateralRequired(
        quote.strike,
        quote.quantity,
        underlyingDecimals,
        collateralDecimals,
      );

  return {
    ...quote,
    premiumDisplay:
      Number(quote.premium) / 10 ** collateralDecimals,
    expiresIn,
    isExpired: expiresIn <= 0,
    collateralRequired,
    collateralDisplay:
      Number(collateralRequired) /
      10 ** (quote.isCall ? underlyingDecimals : collateralDecimals),
  };
}

// ---------------------------------------------------------------------------
// Debug state
// ---------------------------------------------------------------------------

export interface OptionsDebugInfo {
  rfqId: Hex | null;
  signedMessageHash: string | null;
  recoveredRequester: string | null;
  quoteHash: Hex | null;
  recoveredMaker: string | null;
  verifiedMaker: boolean | null;
}

// ---------------------------------------------------------------------------
// RFQ Prefill — from Terminal deep-link query params
// ---------------------------------------------------------------------------

export interface RfqPrefill {
  /** "csp" | "cc" */
  type?: string;
  /** Strike display value, e.g. "25" */
  strike?: string;
  /** Unix seconds or ISO date string */
  expiry?: string;
  /** Quantity, e.g. "1" */
  qty?: string;
  /** Min premium, e.g. "0.0412" */
  minPremium?: string;
  /** Collateral symbol key: "usdh" | "usdc" | "usdt0" */
  collateral?: string;
  /** Derive mid premium (read-only context), e.g. "0.0400" */
  deriveMid?: string;
  /** Derive mark IV (read-only context), e.g. "0.85" */
  deriveIv?: string;
}

/** Edge basis points for suggested min premium (matches Terminal panel). */
const EDGE_BPS = Number(process.env.NEXT_PUBLIC_RFQ_EDGE_BPS || "300");

/** Map collateral param key → token symbol for lookup. */
const COLLATERAL_PARAM_MAP: Record<string, string> = {
  usdh: "USDH",
  usdc: "USDC",
  usdt0: "USD\u20AE0",
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function OptionsInterface({ prefill }: { prefill?: RfqPrefill }) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  // ── Form state ──
  const [side, setSide] = useState<OptionSide>("put");
  const [underlying, setUnderlying] = useState<Token | null>(
    DEFAULT_UNDERLYING,
  );
  const [collateral, setCollateral] = useState<Token | null>(
    DEFAULT_COLLATERAL,
  );
  const [strike, setStrike] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiryDays, setExpiryDays] = useState("7");
  const [minPremium, setMinPremium] = useState("");

  // ── Apply prefill from Terminal deep-link (one-time) ──
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (!prefill || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;

    // Side
    if (prefill.type === "cc") setSide("call");
    else if (prefill.type === "csp") setSide("put");

    // Strike
    if (prefill.strike) setStrike(prefill.strike);

    // Quantity
    if (prefill.qty) setQuantity(prefill.qty);

    // Min premium
    if (prefill.minPremium) setMinPremium(prefill.minPremium);

    // Expiry: convert unix seconds to days from now
    if (prefill.expiry) {
      const ts = Number(prefill.expiry);
      if (!isNaN(ts) && ts > 0) {
        // Could be unix seconds or ISO — handle both
        const expiryMs = ts > 1e12 ? ts : ts * 1000;
        const daysOut = Math.max(
          1,
          Math.round((expiryMs - Date.now()) / (24 * 3600 * 1000)),
        );
        setExpiryDays(String(Math.min(daysOut, 90)));
      }
    }

    // Collateral token
    if (prefill.collateral) {
      const sym =
        COLLATERAL_PARAM_MAP[prefill.collateral.toLowerCase()] ??
        prefill.collateral.toUpperCase();
      const token = CORE_TOKENS.find(
        (t) => t.symbol.toLowerCase() === sym.toLowerCase(),
      );
      if (token) setCollateral(token);
    }
  }, [prefill]);

  // ── Parsed prefill market reference (read-only, never updates form) ──
  const prefillMarket = useMemo(() => {
    if (!prefill?.deriveMid && !prefill?.deriveIv) return null;
    const mid = prefill.deriveMid ? parseFloat(prefill.deriveMid) : null;
    const iv = prefill.deriveIv ? parseFloat(prefill.deriveIv) : null;
    const suggestedMin = mid != null ? mid * (1 + EDGE_BPS / 10_000) : null;
    return {
      mid: mid != null && !isNaN(mid) ? mid : null,
      iv: iv != null && !isNaN(iv) ? iv : null,
      suggestedMin: suggestedMin != null && !isNaN(suggestedMin) ? suggestedMin : null,
    };
  }, [prefill?.deriveMid, prefill?.deriveIv]);

  // ── RFQ + Quote state ──
  const [activeRFQ, setActiveRFQ] = useState<OptionRFQ | null>(null);
  const [receivedQuotes, setReceivedQuotes] = useState<OptionQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<OptionQuote | null>(null);
  const [txState, setTxState] = useState<OptionTxState>({ status: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Debug state ──
  const [debug, setDebug] = useState<OptionsDebugInfo>({
    rfqId: null,
    signedMessageHash: null,
    recoveredRequester: null,
    quoteHash: null,
    recoveredMaker: null,
    verifiedMaker: null,
  });

  // ── WebSocket ref ──
  const wsRef = useRef<WebSocket | null>(null);
  // Stable ref for the current rfqId so the WS callback always reads the latest
  const activeRfqIdRef = useRef<string | null>(null);

  // Computed expiry
  const resolvedExpiryDays = (() => {
    const parsed = parseInt(expiryDays, 10);
    return isNaN(parsed) || parsed < 1 ? 7 : Math.min(parsed, 90);
  })();
  const expiryBigInt = futureExpiry08UTC(resolvedExpiryDays);
  const expiryTs = Number(expiryBigInt);

  // Computed collateral required (for display in form — uses canonical math)
  const computedCollateral = (() => {
    if (!strike || !quantity || !underlying || !collateral) return null;
    try {
      const s = parseDecimal(strike, 18); // strike is always 1e18
      const q = parseDecimal(quantity, underlying.decimals);
      if (s <= 0n || q <= 0n) return null;
      return approvalAmount(
        side === "call",
        s,
        q,
        underlying.decimals,
        collateral.decimals,
      );
    } catch {
      return null;
    }
  })();

  // Enriched quotes
  const enrichedQuotes: OptionQuoteWithMeta[] = receivedQuotes
    .map((q) =>
      enrichOptionQuote(
        q,
        collateral?.decimals ?? 6,
        underlying?.decimals ?? 18,
      ),
    )
    .sort((a, b) => {
      // Highest premium first (best for seller)
      if (a.premium > b.premium) return -1;
      if (a.premium < b.premium) return 1;
      return 0;
    });

  const bestQuote = enrichedQuotes.find((q) => !q.isExpired) ?? null;

  const selectedEnriched =
    selectedQuote
      ? enrichOptionQuote(
          selectedQuote,
          collateral?.decimals ?? 6,
          underlying?.decimals ?? 18,
        )
      : null;

  // ── EIP-712 quote verification on incoming quotes ──
  const verifyIncomingQuote = useCallback(
    async (quote: OptionQuote) => {
      const qv: QuoteForVerification = {
        maker: quote.maker,
        taker: quote.taker,
        underlying: quote.underlying,
        collateral: quote.collateral,
        isCall: quote.isCall,
        isMakerSeller: quote.isMakerSeller,
        strike: quote.strike,
        quantity: quote.quantity,
        premium: quote.premium,
        expiry: BigInt(quote.expiry),
        deadline: BigInt(quote.deadline),
        nonce: quote.nonce,
      };

      try {
        const valid = await verifyQuoteSignature(
          qv,
          quote.signature,
          OPTIONS_CHAIN_ID,
          OPTIONS_ENGINE_ADDRESS,
        );
        if (!valid) {
          console.warn(
            `[Options] Invalid EIP-712 signature from maker ${quote.maker}`,
          );
        }

        // Update debug with the latest verified quote info
        const quoteDigest = hashQuote(
          qv,
          OPTIONS_CHAIN_ID,
          OPTIONS_ENGINE_ADDRESS,
        );
        const recoveredAddr = await recoverQuoteSigner(
          qv,
          quote.signature,
          OPTIONS_CHAIN_ID,
          OPTIONS_ENGINE_ADDRESS,
        );
        setDebug((prev) => ({
          ...prev,
          quoteHash: quoteDigest,
          recoveredMaker: recoveredAddr,
          verifiedMaker: valid,
        }));

        return valid;
      } catch (err) {
        console.warn("[Options] Quote signature verification failed:", err);
        return false;
      }
    },
    [],
  );

  // ── WebSocket connection for relay ──
  const connectRelay = useCallback(
    (rfqId: string) => {
      const relayWsUrl = process.env.NEXT_PUBLIC_RELAY_WS_URL || "ws://127.0.0.1:8080";
      if (!relayWsUrl) return;

      try {
        const ws = new WebSocket(relayWsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (
              msg.type === "QUOTE_BROADCAST" &&
              msg.data?.rfqId === activeRfqIdRef.current
            ) {
              const quote: OptionQuote = {
                rfqId: msg.data.rfqId,
                maker: msg.data.quote.maker,
                taker: msg.data.quote.taker,
                underlying: msg.data.quote.underlying,
                collateral: msg.data.quote.collateral,
                isCall: msg.data.quote.isCall,
                isMakerSeller: msg.data.quote.isMakerSeller,
                strike: BigInt(msg.data.quote.strike),
                quantity: BigInt(msg.data.quote.quantity),
                premium: BigInt(msg.data.quote.premium),
                expiry: Number(msg.data.quote.expiry),
                deadline: Number(msg.data.quote.deadline),
                nonce: BigInt(msg.data.quote.nonce),
                signature: msg.data.makerSig,
                createdAt: Math.floor(Date.now() / 1000),
              };

              // Verify EIP-712 signature before accepting
              verifyIncomingQuote(quote).then((valid) => {
                if (valid) {
                  setReceivedQuotes((prev) => {
                    if (prev.some((p) => p.signature === quote.signature))
                      return prev;
                    return [...prev, quote];
                  });
                }
              });
            }
          } catch {
            // ignore malformed messages
          }
        };

        ws.onerror = () => {
          console.warn("[Options] Relay WebSocket error");
        };

        ws.onclose = () => {
          wsRef.current = null;
        };
      } catch {
        // relay unavailable
      }
    },
    [verifyIncomingQuote],
  );

  // Clean up WS on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // ── Submit RFQ (async — signs with wallet) ──
  const handleSubmitRFQ = async () => {
    if (!isConnected || !address || !walletClient) return;
    if (!underlying || !collateral) return;
    if (!strike || !quantity) return;

    setIsSubmitting(true);

    try {
      // Parse inputs to canonical bigint representations
      const strikeBig = parseDecimal(strike, 18); // always 1e18 precision
      const quantityBig = parseDecimal(quantity, underlying.decimals);
      const minPremiumBig = minPremium
        ? parseDecimal(minPremium, collateral.decimals)
        : 0n;
      const timestampBig = BigInt(Math.floor(Date.now() / 1000));

      if (strikeBig <= 0n || quantityBig <= 0n) return;

      // Resolve native HYPE → wHYPE for on-chain settlement addresses
      const settlementUnderlying = resolveSettlementToken(underlying);
      const settlementCollateral = resolveSettlementToken(collateral);

      // 1. Compute deterministic rfqId (canonical — matches SDK/relay)
      const rfqFields = {
        requester: address,
        underlying: settlementUnderlying.address as string,
        collateral: settlementCollateral.address as string,
        isCall: side === "call",
        strike: strikeBig,
        quantity: quantityBig,
        expiry: expiryBigInt,
        minPremium: minPremiumBig,
        timestamp: timestampBig,
      };
      const rfqId = computeRfqId(rfqFields);

      // 2. EIP-191 personal_sign over the raw 32-byte rfqId hash
      const rawBytes = rfqIdToSignableBytes(rfqId);
      const userSig = await walletClient.signMessage({
        message: { raw: rawBytes },
      });

      // 3. Recover signer for debug verification
      const recovered = await recoverRfqSigner(
        rfqId,
        userSig as Hex,
      );

      setDebug((prev) => ({
        ...prev,
        rfqId,
        signedMessageHash: rfqId,
        recoveredRequester: recovered,
        quoteHash: null,
        recoveredMaker: null,
        verifiedMaker: null,
      }));

      // 4. Build the OptionRFQ (use settlement addresses for on-chain)
      const rfq: OptionRFQ = {
        rfqId,
        requester: address as `0x${string}`,
        underlying: settlementUnderlying.address,
        collateral: settlementCollateral.address,
        isCall: side === "call",
        strike: strikeBig,
        quantity: quantityBig,
        expiry: expiryTs,
        minPremium: minPremiumBig,
        timestamp: Number(timestampBig),
        userSig: userSig as `0x${string}`,
      };

      // 5. Set active RFQ + connect to relay
      activeRfqIdRef.current = rfqId;
      setActiveRFQ(rfq);
      setReceivedQuotes([]);
      setSelectedQuote(null);
      setTxState({ status: "idle" });

      connectRelay(rfqId);

      // 6. Submit to relay via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "RFQ_SUBMIT",
            data: {
              rfq: rfqToJson(rfqFields),
              userSig,
            },
          }),
        );
      } else {
        // WS may not be open yet — wait and retry
        const ws = wsRef.current;
        if (ws) {
          const onOpen = () => {
            ws.send(
              JSON.stringify({
                type: "RFQ_SUBMIT",
                data: {
                  rfq: rfqToJson(rfqFields),
                  userSig,
                },
              }),
            );
            ws.removeEventListener("open", onOpen);
          };
          ws.addEventListener("open", onOpen);
        }
      }
    } catch (err) {
      console.error("[Options] RFQ submission failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Reset ──
  const handleReset = () => {
    wsRef.current?.close();
    activeRfqIdRef.current = null;
    setActiveRFQ(null);
    setReceivedQuotes([]);
    setSelectedQuote(null);
    setTxState({ status: "idle" });
    setDebug({
      rfqId: null,
      signedMessageHash: null,
      recoveredRequester: null,
      quoteHash: null,
      recoveredMaker: null,
      verifiedMaker: null,
    });
  };

  return (
    <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ────────────────────────────────────────────────────────────────── */}
      {/* Left Column — RFQ Form */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Request Option Quote
              </CardTitle>
              <Tabs
                value={side}
                onValueChange={(v) => setSide(v as OptionSide)}
              >
                <TabsList>
                  <TabsTrigger value="put">Cash-Secured Put</TabsTrigger>
                  <TabsTrigger value="call">Covered Call</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Underlying */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">Underlying</Label>
              <TokenSelector
                selectedToken={underlying}
                onSelect={setUnderlying}
                excludeToken={collateral}
                label="Select underlying"
              />
              {underlying && isNativeHype(underlying) && (
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
            </div>

            {/* Collateral */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">Collateral</Label>
              <TokenSelector
                selectedToken={collateral}
                onSelect={setCollateral}
                excludeToken={underlying}
                label="Select collateral"
              />
              {collateral && isNativeHype(collateral) && (
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
            </div>

            {/* Strike */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                Strike Price ({safeSymbol(collateral)})
              </Label>
              <Input
                type="text"
                placeholder="0.0"
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                className="text-lg font-mono"
              />
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                Quantity ({safeSymbol(underlying)})
              </Label>
              <Input
                type="text"
                placeholder="0.0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="text-lg font-mono"
              />
            </div>

            {/* Expiry */}
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <Label className="text-sm text-muted-foreground whitespace-nowrap">
                Expiry
              </Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                className="w-[80px] h-8 text-sm font-mono"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                days — {formatExpiryDate(expiryTs)}
              </span>
            </div>

            {/* Market Reference — from Terminal prefill (read-only) */}
            {prefillMarket && (
              <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Activity className="h-3 w-3" />
                  Market Reference
                  <Badge
                    variant="outline"
                    className="ml-auto text-[10px] px-1.5 py-0"
                  >
                    Derive
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Mid</span>
                    <span className="font-mono font-medium">
                      {prefillMarket.mid != null
                        ? prefillMarket.mid.toFixed(4)
                        : "\u2014"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Mark IV</span>
                    <span className="font-mono font-medium">
                      {prefillMarket.iv != null
                        ? `${(prefillMarket.iv * 100).toFixed(1)}%`
                        : "\u2014"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">
                      Suggested Min
                    </span>
                    <span className="font-mono font-medium text-primary">
                      {prefillMarket.suggestedMin != null
                        ? prefillMarket.suggestedMin.toFixed(4)
                        : "\u2014"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Min Premium (optional) */}
            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">
                Min Premium ({safeSymbol(collateral)})
                <span className="text-muted-foreground/60 ml-1">
                  (optional)
                </span>
              </Label>
              <Input
                type="text"
                placeholder="No minimum"
                value={minPremium}
                onChange={(e) => setMinPremium(e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>

            {/* Collateral Info */}
            {computedCollateral != null && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-muted/30 text-sm">
                <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  {side === "put"
                    ? "Collateral required"
                    : "Underlying to lock"}
                  :{" "}
                  <span className="font-mono text-foreground">
                    {formatAmount(
                      computedCollateral,
                      side === "put"
                        ? (collateral?.decimals ?? 6)
                        : (underlying?.decimals ?? 18),
                    )}{" "}
                    {side === "put"
                      ? safeSymbol(collateral)
                      : safeSymbol(underlying)}
                  </span>
                </span>
              </div>
            )}

            {/* Info */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              <span>
                {side === "put"
                  ? "You sell a put: lock collateral, receive premium from maker."
                  : "You sell a call: lock underlying, receive premium from maker."}
              </span>
            </div>

            {/* Submit Button */}
            <Button
              size="lg"
              className="w-full"
              onClick={handleSubmitRFQ}
              loading={isSubmitting}
              disabled={
                isSubmitting ||
                !isConnected ||
                !walletClient ||
                !underlying ||
                !collateral ||
                !strike ||
                !quantity
              }
            >
              {isSubmitting
                ? "Signing…"
                : !isConnected
                  ? "Connect Wallet"
                  : !underlying || !collateral
                    ? "Select Tokens"
                    : !strike || !quantity
                      ? "Enter Parameters"
                      : "Request Option Quote"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Received Quotes ── */}
        {enrichedQuotes.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Received Quotes ({enrichedQuotes.length})
            </h3>
            <div className="grid gap-3">
              {enrichedQuotes.map((quote) => (
                <OptionsQuoteCard
                  key={quote.signature}
                  quote={quote}
                  collateral={collateral!}
                  underlying={underlying!}
                  isSelected={
                    selectedQuote?.signature === quote.signature
                  }
                  isBest={bestQuote?.signature === quote.signature}
                  onSelect={() => setSelectedQuote(quote)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* Right Column — Live RFQs + Execution + Debug */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Live RFQ panel */}
        {activeRFQ && (
          <LiveOptionRFQPanel
            rfq={activeRFQ}
            underlying={underlying}
            collateral={collateral}
            side={side}
            quoteCount={receivedQuotes.length}
            bestQuote={bestQuote}
            selectedQuoteSignature={selectedQuote?.signature ?? null}
            onSelectQuote={(q) => {
              const raw = receivedQuotes.find(
                (r) => r.signature === q.signature,
              );
              if (raw) setSelectedQuote(raw);
            }}
            onCancel={handleReset}
          />
        )}

        {/* Execution Panel */}
        <OptionsExecutionPanel
          quote={selectedEnriched}
          underlying={underlying!}
          collateral={collateral!}
          side={side}
          txState={txState}
        />

        {/* Debug Panel (dev only) */}
        {process.env.NODE_ENV === "development" && (
          <OptionsDebugPanel debug={debug} />
        )}

        {/* Reset */}
        {(activeRFQ ||
          receivedQuotes.length > 0 ||
          txState.status !== "idle") && (
          <Button variant="outline" className="w-full" onClick={handleReset}>
            New Option Request
          </Button>
        )}
      </div>
    </div>
  );
}

// ==========================================================================
// Live Option RFQ Panel — matches LiveRFQsPanel pattern from SwapInterface
// ==========================================================================

function LiveOptionRFQPanel({
  rfq,
  underlying,
  collateral,
  side,
  quoteCount,
  bestQuote,
  selectedQuoteSignature,
  onSelectQuote,
  onCancel,
}: {
  rfq: OptionRFQ;
  underlying: Token | null;
  collateral: Token | null;
  side: OptionSide;
  quoteCount: number;
  bestQuote: OptionQuoteWithMeta | null;
  selectedQuoteSignature: string | null;
  onSelectQuote: (q: OptionQuoteWithMeta) => void;
  onCancel: () => void;
}) {
  const { secondsLeft, isExpired, isUrgent } = useCountdown(rfq.expiry);

  const ttlLabel = (() => {
    if (isExpired) return "Expired";
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    return mins > 0
      ? `${mins}:${secs.toString().padStart(2, "0")}`
      : `${secs}s`;
  })();

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Your Option RFQ
          <Badge
            variant="outline"
            className={cn(
              "ml-auto text-xs font-mono",
              isUrgent && "border-yellow-500/50 text-yellow-500",
            )}
          >
            <Clock className="h-2.5 w-2.5 mr-1" />
            {ttlLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* RFQ Summary */}
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium truncate">
                {side === "put" ? "CSP" : "CC"}{" "}
                {safeSymbol(underlying)}/{safeSymbol(collateral)}
              </span>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 shrink-0"
              >
                {side === "put" ? "Put" : "Call"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
              <span className="font-mono">
                K={formatAmount(rfq.strike, 18)} Q=
                {formatAmount(rfq.quantity, 18)}
              </span>
              {quoteCount > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {quoteCount} quote{quoteCount !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Cancel */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Cancel this RFQ</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Maker Quotes section */}
        <div className="pt-2 mt-1 border-t border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Maker Quotes
            </span>
          </div>

          {quoteCount === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 px-2 rounded-lg bg-muted/30">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              Waiting for maker quotes…
            </div>
          ) : (
            <div className="space-y-1.5">
              {bestQuote && collateral && (
                <div
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs cursor-pointer transition-colors",
                    selectedQuoteSignature === bestQuote.signature
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/30 bg-card/50 hover:border-border/60",
                  )}
                  onClick={() => onSelectQuote(bestQuote)}
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] border-emerald-500/40 text-emerald-500"
                    >
                      Best
                    </Badge>
                    <span className="font-mono text-muted-foreground">
                      {bestQuote.maker.slice(0, 6)}…
                      {bestQuote.maker.slice(-4)}
                    </span>
                  </div>
                  <span className="font-mono font-medium">
                    {formatAmount(bestQuote.premium, collateral.decimals, 2)}{" "}
                    {safeSymbol(collateral)}
                  </span>
                </div>
              )}
              {quoteCount > 1 && (
                <p className="text-[11px] text-muted-foreground pl-1">
                  +{quoteCount - 1} more quote
                  {quoteCount - 1 !== 1 ? "s" : ""} received
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
