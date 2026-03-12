/**
 * Position State Derivation — HyperQuote Options Positions
 *
 * Pure utility module for computing display state from on-chain Position structs.
 * No React, no side-effects — just types and functions.
 */

import type { Address } from "viem";

// ---------------------------------------------------------------------------
// On-chain Position struct (matches OptionsEngine.getPosition output)
// ---------------------------------------------------------------------------

export interface RawPosition {
  seller: Address;
  buyer: Address;
  underlying: Address;
  collateral: Address;
  isCall: boolean;
  strike: bigint;
  quantity: bigint;
  premium: bigint;
  expiry: bigint;
  collateralLocked: bigint;
  /** 0 = Active, 1 = Settled, 2 = Expired */
  state: number;
}

// ---------------------------------------------------------------------------
// Display-enriched position
// ---------------------------------------------------------------------------

export type PositionLifecycle = "active" | "pending_expiry" | "expired" | "settled";
export type Moneyness = "ITM" | "OTM" | "ATM";
export type PositionRole = "seller" | "buyer";

export interface EnrichedPosition {
  positionId: number;
  raw: RawPosition;
  role: PositionRole;

  // Display values
  strategyLabel: string; // "Covered Call" | "Cash-Secured Put"
  strikeDisplay: number;
  quantityDisplay: number;
  premiumDisplay: number;
  collateralLockedDisplay: number;

  // Collateral context
  collateralSymbol: string; // underlying symbol for CC, collateral symbol for CSP
  collateralDecimals: number;

  // Lifecycle
  lifecycle: PositionLifecycle;
  expiryDate: Date;
  expiryTs: number; // unix seconds

  // Moneyness (requires spot)
  moneyness: Moneyness | null;
  spot: number | null;

  // Outcome (for expired/settled)
  outcomeLabel: string | null;
}

// ---------------------------------------------------------------------------
// OptionsEngine ABI — getPosition + positionCount
// ---------------------------------------------------------------------------

export const OPTIONS_ENGINE_ABI = [
  {
    name: "getPosition",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "positionId", type: "uint256" as const }],
    outputs: [
      {
        name: "",
        type: "tuple" as const,
        components: [
          { name: "seller", type: "address" as const },
          { name: "buyer", type: "address" as const },
          { name: "underlying", type: "address" as const },
          { name: "collateral", type: "address" as const },
          { name: "isCall", type: "bool" as const },
          { name: "strike", type: "uint256" as const },
          { name: "quantity", type: "uint256" as const },
          { name: "premium", type: "uint256" as const },
          { name: "expiry", type: "uint256" as const },
          { name: "collateralLocked", type: "uint256" as const },
          { name: "state", type: "uint8" as const },
        ],
      },
    ],
  },
  {
    name: "positionCount",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" as const }],
  },
] as const;

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

// Underlying tokens are assumed 18 decimals for V1 (HYPE, ETH, BTC all use 18).
// If a non-18-decimal underlying is added, extend UNDERLYING_DECIMALS_MAP below.
const UNDERLYING_DECIMALS = 18;

/** Map known underlying addresses to symbols. Configurable at build time. */
const UNDERLYING_SYMBOL_MAP: Record<string, string> = {};
if (process.env.NEXT_PUBLIC_UNDERLYING_SYMBOL_MAP) {
  for (const entry of process.env.NEXT_PUBLIC_UNDERLYING_SYMBOL_MAP.split(",")) {
    const [addr, sym] = entry.split("=");
    if (addr && sym) UNDERLYING_SYMBOL_MAP[addr.toLowerCase().trim()] = sym.trim();
  }
}

/**
 * Collateral decimals resolved dynamically to support 6-decimal and 18-decimal stablecoins.
 *
 * Build-time config: NEXT_PUBLIC_COLLATERAL_DECIMALS_MAP="0xAddr=6,0xAddr2=18"
 * Fallback: 6 (USDC default) if address not found in map.
 */
const COLLATERAL_DECIMALS_MAP: Record<string, number> = {};
if (process.env.NEXT_PUBLIC_COLLATERAL_DECIMALS_MAP) {
  for (const entry of process.env.NEXT_PUBLIC_COLLATERAL_DECIMALS_MAP.split(",")) {
    const [addr, dec] = entry.split("=");
    if (addr && dec) {
      const parsed = Number(dec.trim());
      if (!Number.isNaN(parsed)) {
        COLLATERAL_DECIMALS_MAP[addr.toLowerCase().trim()] = parsed;
      }
    }
  }
}
const DEFAULT_COLLATERAL_DECIMALS = 6; // USDC default

function resolveCollateralDecimals(collateralAddr: string): number {
  return COLLATERAL_DECIMALS_MAP[collateralAddr.toLowerCase()] ?? DEFAULT_COLLATERAL_DECIMALS;
}

export function resolveUnderlyingSymbol(addr: string): string {
  return UNDERLYING_SYMBOL_MAP[addr.toLowerCase()] ?? "HYPE";
}

/** Convert 1e18 bigint to human-readable number. */
function wei18(v: bigint): number {
  return Number(v) / 1e18;
}

/** Convert collateral bigint to human-readable number. */
function weiCol(v: bigint, dec: number): number {
  return Number(v) / 10 ** dec;
}

// ---------------------------------------------------------------------------
// Lifecycle derivation
// ---------------------------------------------------------------------------

export function deriveLifecycle(raw: RawPosition): PositionLifecycle {
  // State enum from contract: 0 = Active, 1 = Settled, 2 = Expired
  if (raw.state === 1) return "settled";
  if (raw.state === 2) return "expired";

  // If state is still 0 but expiry has passed, the keeper hasn't finalized yet.
  // Mark as pending_expiry — kept in the active table with a muted badge.
  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(raw.expiry) <= nowSec) return "pending_expiry";

  return "active";
}

// ---------------------------------------------------------------------------
// Moneyness derivation
// ---------------------------------------------------------------------------

export function deriveMoneyness(
  isCall: boolean,
  strikeDisplay: number,
  spot: number | null,
): Moneyness | null {
  if (spot == null || spot <= 0) return null;

  const threshold = strikeDisplay * 0.001; // 0.1% band for ATM
  const diff = spot - strikeDisplay;

  if (Math.abs(diff) <= threshold) return "ATM";

  if (isCall) {
    // CC: ITM if spot > strike
    return spot > strikeDisplay ? "ITM" : "OTM";
  }
  // CSP: ITM if spot < strike
  return spot < strikeDisplay ? "ITM" : "OTM";
}

// ---------------------------------------------------------------------------
// Outcome label (for expired/settled positions)
// ---------------------------------------------------------------------------

export function deriveOutcomeLabel(
  lifecycle: PositionLifecycle,
  isCall: boolean,
  moneyness: Moneyness | null,
): string | null {
  // No outcome while active or awaiting keeper finalization
  if (lifecycle === "active" || lifecycle === "pending_expiry") return null;

  // If we can't determine moneyness, we can't determine outcome
  if (moneyness == null) return "Outcome pending";

  if (moneyness === "OTM" || moneyness === "ATM") {
    return "Kept Premium";
  }

  // ITM
  if (isCall) return "Sold at Strike";
  return "Bought at Strike";
}

// ---------------------------------------------------------------------------
// Full enrichment
// ---------------------------------------------------------------------------

export function enrichPosition(
  positionId: number,
  raw: RawPosition,
  wallet: string,
  spot: number | null,
): EnrichedPosition {
  const role: PositionRole =
    raw.seller.toLowerCase() === wallet.toLowerCase() ? "seller" : "buyer";

  const strikeDisplay = wei18(raw.strike);
  const quantityDisplay = wei18(raw.quantity);
  // Collateral decimals resolved dynamically to support 6-decimal and 18-decimal stablecoins.
  const cDec = resolveCollateralDecimals(raw.collateral);
  const premiumDisplay = weiCol(raw.premium, cDec);

  // Collateral context
  const isCall = raw.isCall;
  const collateralSymbol = isCall
    ? resolveUnderlyingSymbol(raw.underlying)
    : "USDC";
  const collateralDecimals = isCall ? UNDERLYING_DECIMALS : cDec;
  const collateralLockedDisplay = isCall
    ? wei18(raw.collateralLocked)
    : weiCol(raw.collateralLocked, cDec);

  const lifecycle = deriveLifecycle(raw);
  const expiryTs = Number(raw.expiry);
  const expiryDate = new Date(expiryTs * 1000);

  const moneyness = deriveMoneyness(isCall, strikeDisplay, spot);
  const outcomeLabel = deriveOutcomeLabel(lifecycle, isCall, moneyness);

  const strategyLabel = isCall ? "Covered Call" : "Cash-Secured Put";

  return {
    positionId,
    raw,
    role,
    strategyLabel,
    strikeDisplay,
    quantityDisplay,
    premiumDisplay,
    collateralLockedDisplay,
    collateralSymbol,
    collateralDecimals,
    lifecycle,
    expiryDate,
    expiryTs,
    moneyness,
    spot,
    outcomeLabel,
  };
}

// ---------------------------------------------------------------------------
// Summary aggregation
// ---------------------------------------------------------------------------

export interface PositionsSummary {
  activeCount: number;
  totalPremiumCollected: number;
  totalCollateralLocked: number;
}

export function computeSummary(positions: EnrichedPosition[]): PositionsSummary {
  // pending_expiry positions are still "active" from the user's perspective
  // (collateral not yet released, keeper hasn't finalized).
  const active = positions.filter(
    (p) => p.lifecycle === "active" || p.lifecycle === "pending_expiry",
  );
  return {
    activeCount: active.length,
    totalPremiumCollected: positions.reduce(
      (sum, p) => sum + p.premiumDisplay,
      0,
    ),
    totalCollateralLocked: active.reduce(
      (sum, p) => sum + p.collateralLockedDisplay,
      0,
    ),
  };
}
