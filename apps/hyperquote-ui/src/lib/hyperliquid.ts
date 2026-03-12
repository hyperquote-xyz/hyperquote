import { AMMEstimate, Token } from "@/types";
import { ALL_TOKENS } from "@/config/tokens";

// ---------------------------------------------------------------------------
// USD price oracle — stable detection + Hyperliquid mid-price fallback
// ---------------------------------------------------------------------------

export const USD_STABLES = new Set(["USDC", "USD₮0", "USDH", "USDT", "USDT0", "DAI", "FEUSD"]);

interface PriceCacheEntry {
  price: number | null;
  fetchedAt: number;
}

const priceCache = new Map<string, PriceCacheEntry>();
const PRICE_CACHE_TTL_MS = 20_000; // 20s

/**
 * Return estimated USD price for a token, or null if unavailable.
 * • Stables → 1.0
 * • Others → Hyperliquid mid-price (best bid + best ask / 2)
 * Cached for ~20s per symbol.
 */
export async function getUsdPrice(token: Token): Promise<number | null> {
  if (USD_STABLES.has(token.symbol)) return 1.0;

  // Use the strict mapping if available, otherwise fall back to the raw
  // token symbol.  This allows non-core tokens (e.g. PURR) to get a price
  // if their symbol happens to match a Hyperliquid spot coin name.
  const coin = tokenToHLCoin(token) ?? token.symbol;

  const now = Date.now();
  const cached = priceCache.get(coin);
  if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin }),
    });
    if (!response.ok) {
      priceCache.set(coin, { price: null, fetchedAt: now });
      return null;
    }
    const data = await response.json();
    const levels = data?.levels;
    if (
      !levels ||
      !Array.isArray(levels) ||
      levels.length < 2 ||
      !levels[0]?.[0] ||
      !levels[1]?.[0]
    ) {
      priceCache.set(coin, { price: null, fetchedAt: now });
      return null;
    }
    // HL API: levels[0] = bids, levels[1] = asks
    const bestBid = parseFloat(levels[0][0].px);
    const bestAsk = parseFloat(levels[1][0].px);
    if (isNaN(bestBid) || isNaN(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
      priceCache.set(coin, { price: null, fetchedAt: now });
      return null;
    }
    const mid = (bestBid + bestAsk) / 2;
    priceCache.set(coin, { price: mid, fetchedAt: now });
    return mid;
  } catch {
    priceCache.set(coin, { price: null, fetchedAt: now });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token → Hyperliquid Spot Coin Mapping
// ---------------------------------------------------------------------------
// Auto-generated from token config (spotMeta + manual overrides).
// Maps HyperEVM token symbols to validated l2Book coin identifiers.

/**
 * HyperEVM symbol → Hyperliquid l2Book coin identifier.
 * Auto-populated from ALL_TOKENS that have a `hyperliquidCoin` field.
 * Includes both canonical names ("PURR") and @index format ("@107").
 */
const SYMBOL_TO_HL_COIN: Record<string, string> = Object.fromEntries(
  ALL_TOKENS
    .filter((t) => t.hyperliquidCoin)
    .map((t) => [t.symbol, t.hyperliquidCoin!])
);

/**
 * Map a HyperEVM token to a Hyperliquid spot coin name.
 * Returns null if the token has no HL spot market.
 */
export function tokenToHLCoin(token: Token): string | null {
  return SYMBOL_TO_HL_COIN[token.symbol] ?? null;
}

// ---------------------------------------------------------------------------
// Hyperliquid Spot Orderbook Estimation — LIVE via server-side proxy
// ---------------------------------------------------------------------------

interface OrderbookLevel {
  price: number;
  size: number;
}

interface OrderbookSnapshot {
  asks: OrderbookLevel[];
  bids: OrderbookLevel[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// nSigFigs — HL L2 book aggregation levels
// ---------------------------------------------------------------------------

type NSigFigs = 2 | 3 | 4 | 5;

/**
 * Aggregation levels to try, from most precise to most aggregated.
 * - undefined = full precision (best VWAP accuracy, ~20 raw levels)
 * - 3 = moderate aggregation (each of 20 levels covers wider price range)
 * - 2 = maximum aggregation (20 levels span orders of magnitude more depth)
 */
const DEPTH_LADDER: (NSigFigs | undefined)[] = [undefined, 3, 2];

// ---------------------------------------------------------------------------
// Simulation result — supports partial fills
// ---------------------------------------------------------------------------

interface SimulationResult {
  /** Tokens received (buy) or USD received (sell) */
  filled: number;
  /** Average execution price (VWAP) */
  avgPrice: number;
  /** Slippage vs mid-price (%) */
  slippagePct: number;
  /** Mid-price reference */
  midPrice: number;
  /** Best ask (buy) or best bid (sell) */
  bestLevel: number;
  /** Bid-ask spread (%) */
  spread: number;
  /** Number of orderbook levels consumed */
  levelsConsumed: number;
  /** Fraction of the order that was filled (0.0–1.0) */
  filledPct: number;
  /** Whether the order was completely filled */
  isFull: boolean;
}

// ---------------------------------------------------------------------------
// Slippage helper — single source of truth for buy/sell direction
// ---------------------------------------------------------------------------

/**
 * Compute execution slippage as a positive percentage vs orderbook mid-price.
 *
 * For BUY:  you pay MORE per token than mid → (avgPrice − midPrice) / midPrice
 * For SELL: you receive LESS per token than mid → (midPrice − avgPrice) / midPrice
 *
 * Matches Hyperliquid UI "Est slippage" semantics. Always ≥ 0.
 */
export function computeSlippagePct(
  side: "buy" | "sell",
  avgPrice: number,
  midPrice: number,
): number {
  if (midPrice <= 0) return 0;
  const raw = side === "buy"
    ? ((avgPrice - midPrice) / midPrice) * 100
    : ((midPrice - avgPrice) / midPrice) * 100;
  return Math.max(0, raw);
}

// ---------------------------------------------------------------------------
// Rich estimation result — exposes partial fills to callers
// ---------------------------------------------------------------------------

export interface PartialFillInfo {
  /** Fraction of the order filled (0.0–1.0) */
  filledPct: number;
  /** Tokens received (buy) or USD received (sell) */
  filledTokens: number;
  /** USD spent (buy) or tokens sold (sell) */
  filledUsd: number;
  /** Average execution price (VWAP) */
  avgPrice: number;
  /** Slippage vs mid-price (%) */
  slippagePct: number;
  /** Mid-price reference */
  midPrice: number;
}

export type HypercoreEstimateResult =
  | { full: true; estimate: AMMEstimate }
  | { full: false; partial: PartialFillInfo; isDirect?: boolean }
  | null;

// ---------------------------------------------------------------------------
// Cache — prevents aggressive polling (client-side, 2s TTL)
// Keyed by (coin, nSigFigs) — e.g. "PURR" or "PURR:3"
// ---------------------------------------------------------------------------

function obCacheKey(coin: string, nSigFigs?: NSigFigs): string {
  return nSigFigs ? `${coin}:${nSigFigs}` : coin;
}

const orderbookCache = new Map<
  string,
  { data: OrderbookSnapshot; fetchedAt: number }
>();
const OB_CACHE_TTL_MS = 2_000; // 2s — fast refresh for live quotes

/**
 * Fetch L2 orderbook via our server-side proxy (avoids CORS).
 * GET /api/hyperliquid/orderbook?coin=HYPE&nSigFigs=3
 *
 * Optional nSigFigs aggregates levels for deeper effective depth.
 */
async function fetchOrderbook(
  coin: string,
  nSigFigs?: NSigFigs,
): Promise<OrderbookSnapshot | null> {
  const cacheKey = obCacheKey(coin, nSigFigs);
  const now = Date.now();
  const cached = orderbookCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < OB_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const params = new URLSearchParams({ coin });
    if (nSigFigs !== undefined) {
      params.set("nSigFigs", String(nSigFigs));
    }

    const response = await fetch(
      `/api/hyperliquid/orderbook?${params.toString()}`
    );
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.asks || !data.bids) return null;

    // HL l2Book levels[0]=bids (descending, best/highest first),
    //            levels[1]=asks (ascending, best/lowest first).
    // The proxy normalises to { asks, bids } with the correct labels.
    // Sort asks ascending (best/lowest first) for simulateMarketBuy,
    // and bids descending (best/highest first) for simulateMarketSell.
    const snapshot: OrderbookSnapshot = {
      asks: data.asks
        .map((l: { px: string; sz: string }) => ({
          price: parseFloat(l.px),
          size: parseFloat(l.sz),
        }))
        .sort((a: OrderbookLevel, b: OrderbookLevel) => a.price - b.price),
      bids: data.bids
        .map((l: { px: string; sz: string }) => ({
          price: parseFloat(l.px),
          size: parseFloat(l.sz),
        }))
        .sort((a: OrderbookLevel, b: OrderbookLevel) => b.price - a.price),
      timestamp: data.timestamp ?? now,
    };

    orderbookCache.set(cacheKey, { data: snapshot, fetchedAt: now });
    return snapshot;
  } catch (error) {
    console.error(
      `[hyperliquid] Failed to fetch orderbook for ${coin}${nSigFigs ? ` (nSigFigs=${nSigFigs})` : ""}:`,
      error
    );
    return null;
  }
}

/**
 * Return the HyperCore orderbook mid-price for a coin, or null.
 * Uses the same 2s-cached proxy path as simulateMarketBuy/Sell.
 */
export async function getOrderbookMid(
  coin: string
): Promise<number | null> {
  const ob = await fetchOrderbook(coin);
  if (!ob || ob.bids.length === 0 || ob.asks.length === 0) return null;
  return (ob.bids[0].price + ob.asks[0].price) / 2;
}

// ---------------------------------------------------------------------------
// VWAP simulation — walk one side of the book
// ---------------------------------------------------------------------------

/**
 * Walk asks to simulate a market buy of `usdAmount` worth of `coin`.
 * Returns SimulationResult with partial-fill support.
 *
 * Reference price: mid = (bestBid + bestAsk) / 2
 * This matches Hyperliquid UI's slippage calculation (includes half-spread).
 */
function simulateMarketBuy(
  asks: OrderbookLevel[],
  bids: OrderbookLevel[],
  usdAmount: number,
): SimulationResult | null {
  if (asks.length === 0 || bids.length === 0 || usdAmount <= 0) return null;

  let usdRemaining = usdAmount;
  let tokensReceived = 0;
  let levelsConsumed = 0;
  const bestAsk = asks[0].price;
  const bestBid = bids[0].price;
  if (bestAsk <= 0 || bestBid <= 0) return null;

  const midPrice = (bestBid + bestAsk) / 2;

  for (const level of asks) {
    if (level.price <= 0 || level.size <= 0) continue;
    const levelUsd = level.price * level.size;
    levelsConsumed++;
    if (levelUsd >= usdRemaining) {
      tokensReceived += usdRemaining / level.price;
      usdRemaining = 0;
      break;
    }
    tokensReceived += level.size;
    usdRemaining -= levelUsd;
  }

  // Return null only for truly empty/invalid inputs; partial fills return result
  if (tokensReceived <= 0) return null;

  const usdFilled = usdAmount - usdRemaining;
  const filledPct = usdFilled / usdAmount;
  const isFull = usdRemaining === 0;

  const avgPrice = usdFilled / tokensReceived;
  const slippagePct = computeSlippagePct("buy", avgPrice, midPrice);
  const spread = ((bestAsk - bestBid) / midPrice) * 100;

  return {
    filled: tokensReceived,
    avgPrice,
    slippagePct,
    midPrice,
    bestLevel: bestAsk,
    spread,
    levelsConsumed,
    filledPct,
    isFull,
  };
}

/**
 * Walk bids to simulate a market sell of `tokenAmount` of `coin`.
 * Returns SimulationResult with partial-fill support.
 *
 * Reference price: mid = (bestBid + bestAsk) / 2
 * This matches Hyperliquid UI's slippage calculation (includes half-spread).
 */
function simulateMarketSell(
  bids: OrderbookLevel[],
  asks: OrderbookLevel[],
  tokenAmount: number,
): SimulationResult | null {
  if (bids.length === 0 || asks.length === 0 || tokenAmount <= 0) return null;

  let remaining = tokenAmount;
  let usdReceived = 0;
  let levelsConsumed = 0;
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  if (bestBid <= 0 || bestAsk <= 0) return null;

  const midPrice = (bestBid + bestAsk) / 2;

  for (const level of bids) {
    if (level.price <= 0 || level.size <= 0) continue;
    levelsConsumed++;
    if (level.size >= remaining) {
      usdReceived += remaining * level.price;
      remaining = 0;
      break;
    }
    usdReceived += level.size * level.price;
    remaining -= level.size;
  }

  // Return null only for truly empty/invalid inputs; partial fills return result
  if (usdReceived <= 0) return null;

  const tokensFilled = tokenAmount - remaining;
  const filledPct = tokensFilled / tokenAmount;
  const isFull = remaining === 0;

  const avgPrice = usdReceived / tokensFilled;
  const slippagePct = computeSlippagePct("sell", avgPrice, midPrice);
  const spread = ((bestAsk - bestBid) / midPrice) * 100;

  return {
    filled: usdReceived,
    avgPrice,
    slippagePct,
    midPrice,
    bestLevel: bestBid,
    spread,
    levelsConsumed,
    filledPct,
    isFull,
  };
}

// ---------------------------------------------------------------------------
// Rich adaptive depth helpers — return HypercoreEstimateResult with partials
// ---------------------------------------------------------------------------

/** Helper: build PartialFillInfo from a SimulationResult for buy simulation. */
function buyPartialInfo(result: SimulationResult, usdAmount: number): PartialFillInfo {
  const usdFilled = usdAmount * result.filledPct;
  return {
    filledPct: result.filledPct,
    filledTokens: result.filled,
    filledUsd: usdFilled,
    avgPrice: result.avgPrice,
    slippagePct: result.slippagePct,
    midPrice: result.midPrice,
  };
}

/** Helper: build PartialFillInfo from a SimulationResult for sell simulation. */
function sellPartialInfo(result: SimulationResult, tokenAmount: number): PartialFillInfo {
  const tokensFilled = tokenAmount * result.filledPct;
  return {
    filledPct: result.filledPct,
    filledTokens: tokensFilled,
    filledUsd: result.filled,
    avgPrice: result.avgPrice,
    slippagePct: result.slippagePct,
    midPrice: result.midPrice,
  };
}

/**
 * Rich buy with adaptive depth — returns full estimate or best partial.
 */
async function estimateBuyRich(
  coin: string,
  usdAmount: number,
  tokenIn: Token,
  tokenOut: Token,
): Promise<HypercoreEstimateResult> {
  let bestPartial: PartialFillInfo | null = null;

  for (const nSigFigs of DEPTH_LADDER) {
    const ob = await fetchOrderbook(coin, nSigFigs);
    if (!ob) continue;

    const result = simulateMarketBuy(ob.asks, ob.bids, usdAmount);
    if (!result) continue;

    if (process.env.NODE_ENV === "development") {
      console.debug("[hyperliquid] buy rich adaptive", {
        coin,
        nSigFigs: nSigFigs ?? "full",
        levels: ob.asks.length,
        filledPct: (result.filledPct * 100).toFixed(1) + "%",
        isFull: result.isFull,
        levelsConsumed: result.levelsConsumed,
      });
    }

    if (result.isFull) {
      if (process.env.NODE_ENV === "development" && coin === "PURR") {
        console.debug("[hyperliquid] PURR buy slippage check", {
          usdAmount,
          midPrice: result.midPrice,
          avgPrice: result.avgPrice,
          slippagePct: result.slippagePct,
          tokensReceived: result.filled,
        });
      }

      const amountOut = BigInt(
        Math.floor(result.filled * 10 ** tokenOut.decimals)
      );
      // Direct only when trading USDC itself; other stables use the
      // PURR/USDC book with an implicit 1:1 conversion.
      const isDirect = tokenIn.symbol === "USDC";
      const route = isDirect
        ? [tokenIn.symbol, tokenOut.symbol]
        : [tokenIn.symbol, "USDC", tokenOut.symbol];
      return {
        full: true,
        estimate: {
          source: "Hyperliquid Spot",
          amountOut,
          priceImpact: Math.min(99.99, result.slippagePct),
          effectivePrice: result.avgPrice,
          poolLiquidity: 0n,
          route,
          isDirect,
          hops: route.length - 1,
        },
      };
    }

    // Track best partial
    const partial = buyPartialInfo(result, usdAmount);
    if (!bestPartial || partial.filledPct > bestPartial.filledPct) {
      bestPartial = partial;
    }
  }

  if (bestPartial) return { full: false, partial: bestPartial, isDirect: tokenIn.symbol === "USDC" };
  return null;
}

/**
 * Rich sell with adaptive depth — returns full estimate or best partial.
 */
async function estimateSellRich(
  coin: string,
  tokenAmount: number,
  tokenIn: Token,
  tokenOut: Token,
): Promise<HypercoreEstimateResult> {
  let bestPartial: PartialFillInfo | null = null;

  for (const nSigFigs of DEPTH_LADDER) {
    const ob = await fetchOrderbook(coin, nSigFigs);
    if (!ob) continue;

    const result = simulateMarketSell(ob.bids, ob.asks, tokenAmount);
    if (!result) continue;

    if (process.env.NODE_ENV === "development") {
      console.debug("[hyperliquid] sell rich adaptive", {
        coin,
        nSigFigs: nSigFigs ?? "full",
        levels: ob.bids.length,
        filledPct: (result.filledPct * 100).toFixed(1) + "%",
        isFull: result.isFull,
        levelsConsumed: result.levelsConsumed,
      });
    }

    if (result.isFull) {
      const amountOut = BigInt(
        Math.floor(result.filled * 10 ** tokenOut.decimals)
      );
      // Direct only when receiving USDC itself; other stables require
      // an implicit USDC → stable conversion after the book sell.
      const isDirect = tokenOut.symbol === "USDC";
      const route = isDirect
        ? [tokenIn.symbol, tokenOut.symbol]
        : [tokenIn.symbol, "USDC", tokenOut.symbol];
      return {
        full: true,
        estimate: {
          source: "Hyperliquid Spot",
          amountOut,
          priceImpact: Math.min(99.99, result.slippagePct),
          effectivePrice: result.avgPrice,
          poolLiquidity: 0n,
          route,
          isDirect,
          hops: route.length - 1,
        },
      };
    }

    // Track best partial
    const partial = sellPartialInfo(result, tokenAmount);
    if (!bestPartial || partial.filledPct > bestPartial.filledPct) {
      bestPartial = partial;
    }
  }

  if (bestPartial) return { full: false, partial: bestPartial, isDirect: tokenOut.symbol === "USDC" };
  return null;
}

/**
 * Rich two-leg synthetic swap with adaptive depth.
 * Returns full estimate or best partial from either leg.
 */
async function estimateTwoLegRich(
  coinIn: string,
  coinOut: string,
  normalizedIn: number,
  tokenIn: Token,
  tokenOut: Token,
): Promise<HypercoreEstimateResult> {
  let bestPartial: PartialFillInfo | null = null;

  for (const nSigFigs of DEPTH_LADDER) {
    const [obIn, obOut] = await Promise.all([
      fetchOrderbook(coinIn, nSigFigs),
      fetchOrderbook(coinOut, nSigFigs),
    ]);
    if (!obIn || !obOut) continue;

    // Leg 1: Sell tokenIn → USD
    const leg1 = simulateMarketSell(obIn.bids, obIn.asks, normalizedIn);
    if (!leg1) continue;

    if (!leg1.isFull) {
      // Leg 1 is the bottleneck — use its partial info
      const partial = sellPartialInfo(leg1, normalizedIn);
      if (!bestPartial || partial.filledPct > bestPartial.filledPct) {
        bestPartial = partial;
      }
      continue;
    }

    // Leg 2: Buy tokenOut with USD proceeds
    const leg2 = simulateMarketBuy(obOut.asks, obOut.bids, leg1.filled);
    if (!leg2) continue;

    if (!leg2.isFull) {
      // Leg 2 is the bottleneck — compute overall partial fill
      // leg1 was full, but leg2 could only buy a fraction of what we got from leg1
      const overallFilledPct = leg2.filledPct; // fraction of USD proceeds used
      const partial: PartialFillInfo = {
        filledPct: overallFilledPct,
        filledTokens: leg2.filled,
        filledUsd: leg1.filled * overallFilledPct,
        avgPrice: leg2.avgPrice,
        slippagePct: leg1.slippagePct + leg2.slippagePct,
        midPrice: leg2.midPrice,
      };
      if (!bestPartial || partial.filledPct > bestPartial.filledPct) {
        bestPartial = partial;
      }
      continue;
    }

    if (process.env.NODE_ENV === "development") {
      console.debug("[hyperliquid] two-leg rich adaptive", {
        coinIn,
        coinOut,
        nSigFigs: nSigFigs ?? "full",
        leg1FilledPct: (leg1.filledPct * 100).toFixed(1) + "%",
        leg2FilledPct: (leg2.filledPct * 100).toFixed(1) + "%",
      });
    }

    const amountOut = BigInt(
      Math.floor(leg2.filled * 10 ** tokenOut.decimals)
    );

    const route = [tokenIn.symbol, "USDC", tokenOut.symbol];
    return {
      full: true,
      estimate: {
        source: "Hyperliquid Spot",
        amountOut,
        priceImpact: Math.min(99.99, leg1.slippagePct + leg2.slippagePct),
        effectivePrice: leg2.avgPrice,
        poolLiquidity: 0n,
        route,
        isDirect: false,
        hops: route.length - 1,
      },
    };
  }

  if (bestPartial) return { full: false, partial: bestPartial };
  return null;
}

// ---------------------------------------------------------------------------
// Main estimation function — LIVE with adaptive orderbook depth
// ---------------------------------------------------------------------------

/**
 * Estimate Hyperliquid spot execution for a swap.
 *
 * Thin wrapper over `estimateHyperliquidSpotRich` that returns only full fills
 * (discards partials). Preserved for legacy callers.
 */
export async function estimateHyperliquidSpot(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
): Promise<AMMEstimate | null> {
  const result = await estimateHyperliquidSpotRich(tokenIn, tokenOut, amountIn);
  if (result?.full) return result.estimate;
  return null;
}

/**
 * Rich estimation — returns full AMMEstimate or best partial fill info.
 *
 * Same routing logic as `estimateHyperliquidSpot` but exposes partial fills
 * when the orderbook can't fully satisfy the order at any depth level.
 */
export async function estimateHyperliquidSpotRich(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
): Promise<HypercoreEstimateResult> {
  const coinIn = tokenToHLCoin(tokenIn);
  const coinOut = tokenToHLCoin(tokenOut);
  const inIsStable = USD_STABLES.has(tokenIn.symbol);
  const outIsStable = USD_STABLES.has(tokenOut.symbol);

  const normalizedIn = Number(amountIn) / 10 ** tokenIn.decimals;
  if (normalizedIn <= 0) return null;

  // Case 1: Stable → HL-listed token (buy tokenOut with USD)
  if (inIsStable && coinOut) {
    return estimateBuyRich(coinOut, normalizedIn, tokenIn, tokenOut);
  }

  // Case 2: HL-listed token → Stable (sell tokenIn for USD)
  if (coinIn && outIsStable) {
    return estimateSellRich(coinIn, normalizedIn, tokenIn, tokenOut);
  }

  // Case 3: HL-listed → HL-listed (two-leg synthetic via USD)
  if (coinIn && coinOut) {
    return estimateTwoLegRich(coinIn, coinOut, normalizedIn, tokenIn, tokenOut);
  }

  // No HL spot market for this pair
  return null;
}
