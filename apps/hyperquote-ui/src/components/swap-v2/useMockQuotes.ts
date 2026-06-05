"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Token } from "@/types";
import { safeSymbol } from "@/lib/utils";
import { getMockDexRoute } from "./mockRouting";

export interface MakerQuote {
  id: string;
  address: string;
  price: number;
  amountOut: string; // Formatted total output amount (e.g. "415")
  status: "live" | "refreshing";
}

export interface ExpiredQuote {
  id: string;
  address: string;
  price: number;
  expiredAgo: number;
}

export interface MarketReference {
  id: string;
  label: string;
  /** Output amount in human-readable token units */
  price: number;
  /** Approximate USD value of the output */
  usdValue?: number;
  /** Sub-label showing route/source info */
  routeDescription: string;
  /** Second sub-label (e.g. "1 KNTQ = 0.004134 HYPE") */
  rateDescription?: string;
  /** true if the venue reference has no viable route */
  noRoute?: boolean;
  /** Standardised route status */
  status?: string;
  /** Short user-facing message */
  userMessage?: string;
  /** Confidence label */
  confidence?: string;
  /** Source attribution (e.g. "HT Aggregator", "HyperCore") */
  source?: string;
}

export type QuotePhase =
  | "idle"
  | "broadcasting"
  | "responding"
  | "found";

interface UseMockQuotesOptions {
  tokenIn: Token | null;
  tokenOut: Token | null;
  amountIn: string;
  enabled: boolean;
}

const MAKER_ADDRESSES = [
  "0x8d8a…6045",
  "0x1f98…f984",
  "0x6b17…1d0f",
  "0xa4e3…b72c",
];

const EXPIRED_ADDRESSES = [
  "0x3c44…93e7",
  "0xf39f…2266",
];

const MOCK_USD_PER_HYPE = 25.391;
const REF_CYCLE_SECONDS = 4;

function jitter(base: number, pct: number): number {
  return base * (1 + (Math.random() - 0.5) * 2 * pct);
}

function buildMakers(output: number): MakerQuote[] {
  return MAKER_ADDRESSES.map((addr, i) => {
    const spread = 0.0002 + Math.random() * 0.0012;
    const p = jitter(output * (1 + spread), 0.001);
    return {
      id: `maker-${i}`,
      address: addr,
      price: p,
      amountOut: p.toFixed(4),
      status: "live" as const,
    };
  }).sort((a, b) => b.price - a.price);
}

function buildExpired(output: number): ExpiredQuote[] {
  return EXPIRED_ADDRESSES.map((addr, i) => ({
    id: `expired-${i}`,
    address: addr,
    price: jitter(output * (0.998 - i * 0.001), 0.001),
    expiredAgo: 12 + i * 6,
  }));
}

function buildReferences(
  output: number,
  tokenIn: Token | null,
  tokenOut: Token | null,
  amountUsd: number
): MarketReference[] {
  const symIn = tokenIn ? safeSymbol(tokenIn) : "?";
  const symOut = tokenOut ? safeSymbol(tokenOut) : "?";

  // HyperCore — always order-book based
  const hypercoreRoute = `Order book: ${symIn} → ${symOut}`;

  // DEX — use mock routing logic
  const dexResult = getMockDexRoute(tokenIn, tokenOut, amountUsd);
  let dexPrice: number;
  let dexRoute: string;
  let dexNoRoute = false;

  if (dexResult.reason === "no_route") {
    dexPrice = 0;
    dexRoute = "No viable DEX route";
    dexNoRoute = true;
  } else {
    dexPrice = output * 0.9986;
    dexRoute = `Route: ${dexResult.route.join(" → ")}`;
  }

  // Theoretical — route description includes the live price
  const theoreticalPrice = output * 0.9995;
  const theoreticalRoute = `Derived from last traded price on HyperCore`;

  // Determine DEX status/message
  const dexStatus = dexNoRoute ? "NO_ROUTE" : dexResult.isDirect ? "OK_DIRECT"
    : dexResult.reason === "fallback_via_usdc" ? "OK_ROUTED_USDC" : "OK_DIRECT";
  const dexMessage = dexNoRoute ? "No viable route"
    : dexResult.isDirect ? "Valid direct route" : "Routed through USDC";

  return [
    {
      id: "hypercore",
      label: "HyperCore Spot",
      price: output * 0.9992,
      routeDescription: hypercoreRoute,
      status: "OK_DIRECT",
      userMessage: "Valid direct route",
    },
    {
      id: "dex",
      label: "HyperEVM DEX",
      price: dexPrice,
      routeDescription: dexRoute,
      noRoute: dexNoRoute,
      status: dexStatus,
      userMessage: dexMessage,
    },
    {
      id: "last-trade",
      label: "Theoretical",
      price: theoreticalPrice,
      routeDescription: theoreticalRoute,
      status: "OK_DIRECT",
      userMessage: "Valid direct route",
    },
  ];
}

export function useMockQuotes({ tokenIn, tokenOut, amountIn, enabled }: UseMockQuotesOptions) {
  const [makers, setMakers] = useState<MakerQuote[]>([]);
  const [expired, setExpired] = useState<ExpiredQuote[]>([]);
  const [references, setReferences] = useState<MarketReference[]>([]);
  const [countdown, setCountdown] = useState(30);
  const [isLive, setIsLive] = useState(false);
  const [phase, setPhase] = useState<QuotePhase>("idle");
  const [respondingCount, setRespondingCount] = useState(0);
  const [refCountdown, setRefCountdown] = useState(REF_CYCLE_SECONDS);
  const [prevBestId, setPrevBestId] = useState<string | null>(null);
  const [newBestFlash, setNewBestFlash] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const refTickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const generate = useCallback(() => {
    const amount = parseFloat(amountIn) || 0;
    if (amount <= 0) return;
    const output = amount * MOCK_USD_PER_HYPE;
    const amountUsd = amount * MOCK_USD_PER_HYPE;

    setMakers(buildMakers(output));
    setExpired(buildExpired(output));
    setReferences(buildReferences(output, tokenIn, tokenOut, amountUsd));
    setRefCountdown(REF_CYCLE_SECONDS);
    setCountdown(30);
    setIsLive(true);
  }, [amountIn, tokenIn, tokenOut]);

  useEffect(() => {
    if (!enabled) {
      setMakers([]);
      setExpired([]);
      setReferences([]);
      setIsLive(false);
      setCountdown(30);
      setPhase("idle");
      setRespondingCount(0);
      setPrevBestId(null);
      setNewBestFlash(false);
      setRefCountdown(REF_CYCLE_SECONDS);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      if (refTickRef.current) clearInterval(refTickRef.current);
      return;
    }

    setPhase("broadcasting");
    setRespondingCount(0);

    const t1 = setTimeout(() => {
      setPhase("responding");
      setRespondingCount(1);
    }, 400);

    const t2 = setTimeout(() => setRespondingCount(2), 700);
    const t3 = setTimeout(() => setRespondingCount(3), 950);

    const t4 = setTimeout(() => {
      generate();
      setRespondingCount(4);
      setPhase("found");
    }, 1200);

    intervalRef.current = setInterval(() => {
      generate();
    }, 30_000);

    tickRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 30 : c - 1));

      setExpired((prev) =>
        prev.map((q) => ({ ...q, expiredAgo: q.expiredAgo + 1 }))
      );

      if (Math.random() > 0.6) {
        setMakers((prev) =>
          prev
            .map((q) => ({
              ...q,
              price: jitter(q.price, 0.0005),
              status: (Math.random() > 0.75 ? "refreshing" : "live") as MakerQuote["status"],
            }))
            .sort((a, b) => b.price - a.price)
        );
      }
    }, 1000);

    refTickRef.current = setInterval(() => {
      setRefCountdown((c) => {
        if (c <= 1) {
          setReferences((prev) =>
            prev.map((r) =>
              r.noRoute ? r : { ...r, price: jitter(r.price, 0.0002) }
            )
          );
          return REF_CYCLE_SECONDS;
        }
        return c - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      if (refTickRef.current) clearInterval(refTickRef.current);
    };
  }, [enabled, generate]);

  const bestMaker = makers.length > 0
    ? makers.reduce((best, q) => (q.price > best.price ? q : best), makers[0])
    : null;

  useEffect(() => {
    if (!bestMaker) return;
    if (prevBestId && prevBestId !== bestMaker.id) {
      setNewBestFlash(true);
      const t = setTimeout(() => setNewBestFlash(false), 800);
      return () => clearTimeout(t);
    }
    setPrevBestId(bestMaker.id);
  }, [bestMaker, prevBestId]);

  const dexRef = references.find((r) => r.id === "dex");
  const coreRef = references.find((r) => r.id === "hypercore");

  const bpsVsDex = bestMaker && dexRef && !dexRef.noRoute
    ? Math.round(((bestMaker.price - dexRef.price) / dexRef.price) * 10000)
    : 0;
  const bpsVsCore = bestMaker && coreRef
    ? Math.round(((bestMaker.price - coreRef.price) / coreRef.price) * 10000)
    : 0;

  return {
    makers,
    expired,
    references,
    bestMaker,
    countdown,
    isLive,
    phase,
    respondingCount,
    refCountdown,
    bpsVsDex,
    bpsVsCore,
    newBestFlash,
    mockUsdPerToken: MOCK_USD_PER_HYPE,
  };
}
