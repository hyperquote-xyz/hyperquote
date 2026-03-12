/**
 * HyperQuote Options Types
 * Type definitions for the Options RFQ system.
 *
 * Maps to the on-chain OptionsEngine (EIP-712 Quote struct)
 * and the off-chain relay protocol.
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/** Option side — CSP (put) or CC (call). */
export type OptionSide = "put" | "call";

// ---------------------------------------------------------------------------
// Option RFQ — created by seller (taker), broadcast to makers
// ---------------------------------------------------------------------------

export interface OptionRFQ {
  /** Deterministic keccak256 of abi.encode(rfq fields). */
  rfqId: string;
  /** Seller (taker) address. */
  requester: `0x${string}`;
  /** Underlying token address (e.g. WHYPE). */
  underlying: `0x${string}`;
  /** Collateral token address (e.g. USDC). */
  collateral: `0x${string}`;
  /** true = Covered Call, false = Cash-Secured Put. */
  isCall: boolean;
  /** Strike price (18 decimal underlying precision). */
  strike: bigint;
  /** Quantity of contracts (18 decimal). */
  quantity: bigint;
  /** Option expiry (unix timestamp, 08:00 UTC snap). */
  expiry: number;
  /** Minimum acceptable premium (collateral decimals). */
  minPremium: bigint;
  /** When this RFQ was created (unix timestamp). */
  timestamp: number;
  /** EIP-191 signature over rfqId bytes. */
  userSig: `0x${string}`;
}

// ---------------------------------------------------------------------------
// Option Quote — created by maker (buyer), signed via EIP-712
// ---------------------------------------------------------------------------

export interface OptionQuote {
  /** Links back to OptionRFQ.rfqId. */
  rfqId: string;
  /** Maker (buyer) address — signs the EIP-712 typed data. */
  maker: `0x${string}`;
  /** Taker (seller) address — msg.sender on execute(). */
  taker: `0x${string}`;
  /** Underlying token. */
  underlying: `0x${string}`;
  /** Collateral token. */
  collateral: `0x${string}`;
  /** Call or put. */
  isCall: boolean;
  /** V1: always false (maker is buyer, taker is seller). */
  isMakerSeller: boolean;
  /** Strike price (18 dec). */
  strike: bigint;
  /** Quantity (18 dec). */
  quantity: bigint;
  /** Premium offered by maker (collateral decimals). */
  premium: bigint;
  /** Option expiry. */
  expiry: number;
  /** Quote deadline (unix timestamp). */
  deadline: number;
  /** Maker nonce from OptionsEngine. */
  nonce: bigint;
  /** EIP-712 signature. */
  signature: `0x${string}`;
  /** When maker created the quote. */
  createdAt: number;
}

/** Quote enriched with computed display values. */
export interface OptionQuoteWithMeta extends OptionQuote {
  /** Premium as a human-readable number (collateral decimals). */
  premiumDisplay: number;
  /** Seconds until deadline. */
  expiresIn: number;
  /** Whether deadline has passed. */
  isExpired: boolean;
  /** Collateral required by seller (computed from strike × quantity). */
  collateralRequired: bigint;
  /** Collateral display value. */
  collateralDisplay: number;
}

// ---------------------------------------------------------------------------
// JSON transport (bigint → string)
// ---------------------------------------------------------------------------

export interface OptionRFQJson {
  rfqId: string;
  requester: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  strike: string;
  quantity: string;
  expiry: string;
  minPremium: string;
  timestamp: string;
  userSig: string;
}

export interface OptionQuoteJson {
  rfqId: string;
  maker: string;
  taker: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  isMakerSeller: boolean;
  strike: string;
  quantity: string;
  premium: string;
  expiry: string;
  deadline: string;
  nonce: string;
  signature: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Relay WebSocket message types
// ---------------------------------------------------------------------------

export type OptionsRelayMessageType =
  | "RFQ_SUBMIT"
  | "RFQ_BROADCAST"
  | "QUOTE_SUBMIT"
  | "QUOTE_BROADCAST"
  | "ERROR";

export interface OptionsRelayMessage {
  type: OptionsRelayMessageType;
  data: unknown;
}

// ---------------------------------------------------------------------------
// UI state types
// ---------------------------------------------------------------------------

export type OptionTxStatus =
  | "idle"
  | "approving"
  | "approved"
  | "executing"
  | "success"
  | "error";

export interface OptionTxState {
  status: OptionTxStatus;
  approvalTxHash?: `0x${string}`;
  executeTxHash?: `0x${string}`;
  positionId?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function optionRfqFromJson(json: OptionRFQJson): OptionRFQ {
  return {
    rfqId: json.rfqId,
    requester: json.requester as `0x${string}`,
    underlying: json.underlying as `0x${string}`,
    collateral: json.collateral as `0x${string}`,
    isCall: json.isCall,
    strike: BigInt(json.strike),
    quantity: BigInt(json.quantity),
    expiry: Number(json.expiry),
    minPremium: BigInt(json.minPremium),
    timestamp: Number(json.timestamp),
    userSig: json.userSig as `0x${string}`,
  };
}

export function optionQuoteFromJson(json: OptionQuoteJson): OptionQuote {
  return {
    rfqId: json.rfqId,
    maker: json.maker as `0x${string}`,
    taker: json.taker as `0x${string}`,
    underlying: json.underlying as `0x${string}`,
    collateral: json.collateral as `0x${string}`,
    isCall: json.isCall,
    isMakerSeller: json.isMakerSeller,
    strike: BigInt(json.strike),
    quantity: BigInt(json.quantity),
    premium: BigInt(json.premium),
    expiry: Number(json.expiry),
    deadline: Number(json.deadline),
    nonce: BigInt(json.nonce),
    signature: json.signature as `0x${string}`,
    createdAt: json.createdAt,
  };
}
