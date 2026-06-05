/**
 * Project X (PRJX) On-Chain Quoter — Production Module
 *
 * Uses eth_call against the PRJX QuoterV2 contract (Uniswap V3 fork)
 * to get real swap quotes from on-chain concentrated liquidity pools.
 *
 * No gas cost, no API keys, no third-party dependencies.
 *
 * Used by:
 * - venueComparison.ts (production DEX venue reference)
 * - scripts/audit-routes.ts (route audit harness)
 */

import type { Token } from "@/types";
import { resolveSettlementToken } from "@/lib/native-wrap";

// ---------------------------------------------------------------------------
// Contract addresses — PRJX V2 deployment (current)
// ---------------------------------------------------------------------------

export const PRJX_QUOTER_V2 = "0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258";
export const PRJX_FACTORY_V3 = "0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072";

const WHYPE_ADDR = "0x5555555555555555555555555555555555555555";
const USDC_ADDR = "0xb88339cb7199b77e23db6e890353e22632ba630f";

/**
 * RPC endpoint. Server-side proxy preferred for production to avoid
 * CORS/rate-limit issues; falls back to public HyperEVM RPC.
 */
const RPC_URL = typeof window !== "undefined"
  ? "/api/hyperevm/rpc"  // client-side: use server-side proxy
  : (process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm");

/** Uniswap V3 fee tiers supported by PRJX */
const FEE_TIERS = [100, 500, 3000, 10000] as const;

// ---------------------------------------------------------------------------
// Low-level ABI encoding (minimal — no ethers/viem dependency)
// ---------------------------------------------------------------------------

function pad64(hex: string): string { return hex.padStart(64, "0"); }
function encodeAddr(a: string): string { return pad64(a.toLowerCase().replace("0x", "")); }
function encodeUint256(v: bigint): string { return pad64(v.toString(16)); }
function encodeUint24(v: number): string { return pad64(v.toString(16)); }

function encodeQuoteExactInputSingle(tokenIn: string, tokenOut: string, amountIn: bigint, fee: number): string {
  return "0xc6a5026a" + encodeAddr(tokenIn) + encodeAddr(tokenOut) + encodeUint256(amountIn) + encodeUint24(fee) + encodeUint256(0n);
}

function decodeUint256(hex: string): bigint | null {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length < 64) return null;
  return BigInt("0x" + clean.slice(0, 64));
}

// ---------------------------------------------------------------------------
// RPC helper
// ---------------------------------------------------------------------------

async function ethCall(to: string, data: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error) return null;
    return json.result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Quote — single fee tier
// ---------------------------------------------------------------------------

async function quoteSingleFee(
  tokenIn: string, tokenOut: string, amountIn: bigint, fee: number, signal?: AbortSignal,
): Promise<{ amountOut: bigint; fee: number } | null> {
  const result = await ethCall(PRJX_QUOTER_V2, encodeQuoteExactInputSingle(tokenIn, tokenOut, amountIn, fee), signal);
  if (!result || result === "0x") return null;
  const amountOut = decodeUint256(result);
  if (!amountOut || amountOut === 0n) return null;
  return { amountOut, fee };
}

// ---------------------------------------------------------------------------
// Quote — best across all fee tiers (parallel)
// ---------------------------------------------------------------------------

async function quoteBestDirect(
  tokenIn: string, tokenOut: string, amountIn: bigint, signal?: AbortSignal,
): Promise<{ amountOut: bigint; fee: number } | null> {
  const results = await Promise.all(
    FEE_TIERS.map(fee => quoteSingleFee(tokenIn, tokenOut, amountIn, fee, signal))
  );
  let best: { amountOut: bigint; fee: number } | null = null;
  for (const r of results) {
    if (r && (!best || r.amountOut > best.amountOut)) best = r;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public API — full route quote
// ---------------------------------------------------------------------------

export interface PrjxRouteResult {
  /** Route token symbols, e.g. ["HYPE", "USDC"] or ["KNTQ", "WHYPE", "kHYPE"] */
  route: string[];
  amountOut: bigint;
  /** Human-readable output amount (token units) */
  amountOutHuman: number;
  /** Fee tiers used */
  fees: number[];
  isDirect: boolean;
  status: "ok" | "high_slippage" | "no_pool";
  /** Slippage vs ideal mid-price output (%) */
  slippagePct: number;
  /** Short route description */
  message: string;
}

/**
 * Get the best PRJX swap quote with automatic routing.
 *
 * Routing priority:
 * 1. Direct pool (best fee tier)
 * 2. Via USDC intermediate
 * 3. Via WHYPE intermediate
 *
 * Returns the best route under 10% slippage, or the best high-slippage
 * direct route, or a no_pool failure.
 */
export async function quotePrjxRoute(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  /** Expected output at mid-price (for slippage calculation) */
  idealOutputTokens: number,
  signal?: AbortSignal,
): Promise<PrjxRouteResult> {
  // Always use ERC-20 addresses (HYPE → WHYPE)
  const sellAddr = resolveSettlementToken(tokenIn).address;
  const buyAddr = resolveSettlementToken(tokenOut).address;
  const symIn = tokenIn.symbol;
  const symOut = tokenOut.symbol;
  const decOut = tokenOut.decimals;

  const fail = (msg: string): PrjxRouteResult => ({
    route: [symIn, symOut], amountOut: 0n, amountOutHuman: 0, fees: [], isDirect: false, status: "no_pool", slippagePct: 0, message: msg,
  });

  const toHuman = (raw: bigint) => Number(raw) / 10 ** decOut;
  const calcSlip = (humanOut: number) => idealOutputTokens > 0 ? Math.max(0, ((idealOutputTokens - humanOut) / idealOutputTokens) * 100) : 0;

  // --- Direct ---
  const direct = await quoteBestDirect(sellAddr, buyAddr, amountIn, signal);
  if (direct) {
    const humanOut = toHuman(direct.amountOut);
    const slip = calcSlip(humanOut);
    if (slip <= 10) {
      return { route: [symIn, symOut], amountOut: direct.amountOut, amountOutHuman: humanOut, fees: [direct.fee], isDirect: true, status: "ok", slippagePct: slip, message: `Direct pool (${direct.fee / 10000}% fee)` };
    }
  }

  // --- Via USDC ---
  if (sellAddr.toLowerCase() !== USDC_ADDR && buyAddr.toLowerCase() !== USDC_ADDR) {
    const leg1 = await quoteBestDirect(sellAddr, USDC_ADDR, amountIn, signal);
    if (leg1 && leg1.amountOut > 0n) {
      const leg2 = await quoteBestDirect(USDC_ADDR, buyAddr, leg1.amountOut, signal);
      if (leg2) {
        const humanOut = toHuman(leg2.amountOut);
        const slip = calcSlip(humanOut);
        if (slip <= 10) {
          return { route: [symIn, "USDC", symOut], amountOut: leg2.amountOut, amountOutHuman: humanOut, fees: [leg1.fee, leg2.fee], isDirect: false, status: "ok", slippagePct: slip, message: `Via USDC` };
        }
      }
    }
  }

  // --- Via WHYPE ---
  if (sellAddr.toLowerCase() !== WHYPE_ADDR && buyAddr.toLowerCase() !== WHYPE_ADDR) {
    const leg1 = await quoteBestDirect(sellAddr, WHYPE_ADDR, amountIn, signal);
    if (leg1 && leg1.amountOut > 0n) {
      const leg2 = await quoteBestDirect(WHYPE_ADDR, buyAddr, leg1.amountOut, signal);
      if (leg2) {
        const humanOut = toHuman(leg2.amountOut);
        const slip = calcSlip(humanOut);
        if (slip <= 10) {
          return { route: [symIn, "HYPE", symOut], amountOut: leg2.amountOut, amountOutHuman: humanOut, fees: [leg1.fee, leg2.fee], isDirect: false, status: "ok", slippagePct: slip, message: `Via HYPE` };
        }
      }
    }
  }

  // --- High-slippage fallback ---
  if (direct) {
    const humanOut = toHuman(direct.amountOut);
    return { route: [symIn, symOut], amountOut: direct.amountOut, amountOutHuman: humanOut, fees: [direct.fee], isDirect: true, status: "high_slippage", slippagePct: calcSlip(humanOut), message: `High slippage` };
  }

  return fail("No PRJX pool");
}
