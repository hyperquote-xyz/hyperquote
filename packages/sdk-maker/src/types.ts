// ---------------------------------------------------------------
// Core Types — matches Solidity QuoteLib.Quote exactly
// ---------------------------------------------------------------

/**
 * EIP-712 Quote struct — mirrors QuoteLib.Quote in Solidity.
 * Field order and types must match the Solidity struct exactly.
 */
export interface Quote {
  maker: string; // address — buyer in V1
  taker: string; // address — seller in V1 (address(0) = open)
  underlying: string; // address — WHYPE in V1
  collateral: string; // address — USDH/USDC/USDT0
  isCall: boolean; // true = Covered Call, false = Cash-Secured Put
  isMakerSeller: boolean; // V1: must be false
  strike: bigint; // 1e18 fixed-point USD per underlying
  quantity: bigint; // underlying base units (10^uDec)
  premium: bigint; // collateral base units (10^cDec)
  expiry: bigint; // option expiry timestamp (must be 08:00 UTC)
  deadline: bigint; // quote validity deadline (unix timestamp)
  nonce: bigint; // maker nonce for replay protection
}

/**
 * RFQ submitted by a user (potential seller in V1).
 * The user wants to sell options and is requesting quotes from makers.
 */
export interface RFQ {
  requester: string; // address — the user requesting quotes
  underlying: string; // address — asset for the option
  collateral: string; // address — collateral token
  isCall: boolean; // true = CC, false = CSP
  strike: bigint; // 1e18 fixed-point
  quantity: bigint; // underlying base units
  expiry: bigint; // must be 08:00 UTC
  minPremium: bigint; // minimum acceptable premium in collateral units
  timestamp: bigint; // when the RFQ was created (unix)
}

/**
 * Serializable RFQ for JSON transport (bigints as hex strings).
 */
export interface RFQJson {
  requester: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  strike: string; // hex
  quantity: string; // hex
  expiry: string; // hex
  minPremium: string; // hex
  timestamp: string; // hex
}

/**
 * Serializable Quote for JSON transport.
 */
export interface QuoteJson {
  maker: string;
  taker: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  isMakerSeller: boolean;
  strike: string; // hex
  quantity: string; // hex
  premium: string; // hex
  expiry: string; // hex
  deadline: string; // hex
  nonce: string; // hex
}

/**
 * Preview of a position that would be created if the quote is executed.
 */
export interface PositionPreview {
  isCall: boolean;
  strike: bigint;
  quantity: bigint;
  premium: bigint;
  expiry: bigint;
  collateralRequired: bigint; // what the seller must lock
  maxLoss: bigint; // worst-case for seller
  breakeven: bigint; // strike +/- premium adjusted
  notional: bigint; // strike * quantity in collateral units
}

/**
 * Maker configuration.
 */
export interface MakerConfig {
  /** Private key (hex, with or without 0x prefix) */
  privateKey: string;
  /** Chain ID for EIP-712 domain */
  chainId: number;
  /** OptionsEngine contract address */
  engineAddress: string;
  /** JSON-RPC endpoint for reading chain state (optional — not needed for offline/mock mode) */
  rpcUrl?: string;
  /** Relay WebSocket URL (optional — not needed for offline/mock mode) */
  relayWsUrl?: string;
  /** Allowed underlying tokens (V1: just WHYPE) */
  allowedUnderlying: string[];
  /** Allowed collateral tokens with decimals */
  collateralTokens: Record<string, { decimals: number; symbol: string }>;
  /** Risk limits */
  risk: RiskConfig;
  /** Quote deadline offset in seconds (how long the quote is valid) */
  quoteDeadlineSecs: number;
}

/**
 * Risk configuration for the maker.
 */
export interface RiskConfig {
  /** Max notional per collateral token (in collateral base units) */
  maxNotionalPerCollateral: Record<string, bigint>;
  /** Max tenor in seconds (default: 90 days) */
  maxTenorSecs: number;
  /** Max strike deviation from spot as a fraction (e.g., 0.5 = 50%) */
  maxStrikeDeviationPct: number;
  /** Max delta exposure per expiry bucket */
  maxDeltaPerExpiry: number;
  /** Minimum premium in collateral units per collateral token */
  minPremium: Record<string, bigint>;
}

// ---------------------------------------------------------------
// Relay Message Types
// ---------------------------------------------------------------

export type RelayMessageType =
  | "RFQ_SUBMIT"
  | "RFQ_BROADCAST"
  | "QUOTE_SUBMIT"
  | "QUOTE_BROADCAST"
  | "PING"
  | "PONG"
  | "ERROR";

export interface RelayMessage {
  type: RelayMessageType;
  data: unknown;
}

export interface RFQBroadcastMessage {
  type: "RFQ_BROADCAST";
  data: {
    rfqId: string;
    rfq: RFQJson;
  };
}

export interface QuoteSubmitMessage {
  type: "QUOTE_SUBMIT";
  data: {
    rfqId: string;
    quote: QuoteJson;
    makerSig: string;
  };
}

export interface QuoteBroadcastMessage {
  type: "QUOTE_BROADCAST";
  data: {
    rfqId: string;
    quote: QuoteJson;
    makerSig: string;
  };
}

// ---------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------

export function quoteToJson(q: Quote): QuoteJson {
  return {
    maker: q.maker,
    taker: q.taker,
    underlying: q.underlying,
    collateral: q.collateral,
    isCall: q.isCall,
    isMakerSeller: q.isMakerSeller,
    strike: "0x" + q.strike.toString(16),
    quantity: "0x" + q.quantity.toString(16),
    premium: "0x" + q.premium.toString(16),
    expiry: "0x" + q.expiry.toString(16),
    deadline: "0x" + q.deadline.toString(16),
    nonce: "0x" + q.nonce.toString(16),
  };
}

export function quoteFromJson(j: QuoteJson): Quote {
  return {
    maker: j.maker,
    taker: j.taker,
    underlying: j.underlying,
    collateral: j.collateral,
    isCall: j.isCall,
    isMakerSeller: j.isMakerSeller,
    strike: BigInt(j.strike),
    quantity: BigInt(j.quantity),
    premium: BigInt(j.premium),
    expiry: BigInt(j.expiry),
    deadline: BigInt(j.deadline),
    nonce: BigInt(j.nonce),
  };
}

export function rfqToJson(r: RFQ): RFQJson {
  return {
    requester: r.requester,
    underlying: r.underlying,
    collateral: r.collateral,
    isCall: r.isCall,
    strike: "0x" + r.strike.toString(16),
    quantity: "0x" + r.quantity.toString(16),
    expiry: "0x" + r.expiry.toString(16),
    minPremium: "0x" + r.minPremium.toString(16),
    timestamp: "0x" + r.timestamp.toString(16),
  };
}

export function rfqFromJson(j: RFQJson): RFQ {
  return {
    requester: j.requester,
    underlying: j.underlying,
    collateral: j.collateral,
    isCall: j.isCall,
    strike: BigInt(j.strike),
    quantity: BigInt(j.quantity),
    expiry: BigInt(j.expiry),
    minPremium: BigInt(j.minPremium),
    timestamp: BigInt(j.timestamp),
  };
}
