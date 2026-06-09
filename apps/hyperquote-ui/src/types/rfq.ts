/**
 * HyperQuote RFQ Types
 * Core type definitions for the RFQ system
 */

// Quote kind enum matching the smart contract
export enum QuoteKind {
  EXACT_IN = 0,
  EXACT_OUT = 1,
}

// RFQ visibility
export type RFQVisibility = "public" | "private";

// Token information
export interface Token {
  /** HyperEVM ERC-20 contract address (or 0x000…000 for native HYPE) */
  address: `0x${string}`;
  symbol: string;
  name: string;
  /** ERC-20 decimals — used for ALL settlement math */
  decimals: number;
  logoUrl?: string;
  tier?: "core" | "verified" | "unverified";
  verified?: boolean;
  verificationSource?: "manual" | "prjx" | "unit" | "explorer" | "spotMeta";
  isBridgePreferred?: boolean;
  explorerVerified?: boolean;
  explorerVerifiedAt?: number;

  // ── HyperCore awareness (from spotMeta) ──

  /** Exact l2Book coin identifier, validated at build time (e.g. "PURR", "@107") */
  hyperliquidCoin?: string;
  /** HyperCore token ID (shorter 32-hex-char address) */
  hypercoreAddress?: string;
  /** Spot token index from spotMeta */
  hlIndex?: number;
  /** HL internal wei decimals — NOT ERC-20 decimals */
  hlWeiDecimals?: number;
  /** Where the token is available */
  venue?: "hypercore" | "hyperevm" | "both";
  /** true for native HYPE (0x000…000) — display-only, not selectable for settlement */
  isNative?: boolean;
  /** For native tokens: the ERC-20 wrapper used for settlement (e.g. WHYPE for HYPE) */
  wrappedAddress?: `0x${string}`;
}

// RFQ Request - created by taker
export interface RFQRequest {
  id: string; // Unique request ID (client-generated UUID)
  kind: QuoteKind;
  taker: `0x${string}`;
  tokenIn: Token;
  tokenOut: Token;
  // For EXACT_IN: amountIn is fixed, amountOut is quoted by maker
  // For EXACT_OUT: amountOut is fixed, amountIn is quoted by maker
  amountIn?: bigint; // Set for EXACT_IN
  amountOut?: bigint; // Set for EXACT_OUT
  // Optional constraints
  minOut?: bigint; // For EXACT_IN: minimum acceptable output
  maxIn?: bigint; // For EXACT_OUT: maximum acceptable input
  expiry: number; // Unix timestamp when request expires
  createdAt: number; // Unix timestamp of creation
  // Visibility control
  visibility: RFQVisibility; // "public" = live feed, "private" = manual sharing only
  // v2-ready: allowed maker addresses for private RFQs
  allowedMakers?: `0x${string}`[];
}

// RFQ Quote - created by maker in response to request
export interface RFQQuote {
  // Quote fields matching smart contract struct
  kind: QuoteKind;
  maker: `0x${string}`;
  taker: `0x${string}`; // 0x0 for open quote, or specific taker address
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  expiry: number; // Unix timestamp
  nonce: bigint; // Maker's current nonce from contract

  // Metadata (not part of signed data)
  requestId: string; // Links to RFQRequest
  signature: `0x${string}`; // Raw ECDSA signature over getQuoteHash output
  createdAt: number;
}

// Serializable versions for JSON transport (bigint -> string)
export interface RFQRequestJSON {
  id: string;
  kind: QuoteKind;
  taker: string;
  tokenIn: Token;
  tokenOut: Token;
  amountIn?: string;
  amountOut?: string;
  minOut?: string;
  maxIn?: string;
  expiry: number;
  createdAt: number;
  visibility: RFQVisibility;
  allowedMakers?: string[];
}

export interface RFQQuoteJSON {
  kind: QuoteKind;
  maker: string;
  taker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  expiry: number;
  nonce: string;
  requestId: string;
  signature: string;
  createdAt: number;
}

// Quote with computed display values
export interface QuoteWithMeta extends RFQQuote {
  // Computed values for display
  price: number; // tokenOut per tokenIn
  priceInverse: number; // tokenIn per tokenOut
  feeAmount: bigint; // Fee in tokenIn
  netAmountIn: bigint; // Amount maker receives (amountIn - fee)
  expiresIn: number; // Seconds until expiry
  isExpired: boolean;
  // For comparison
  tokenInDecimals: number;
  tokenOutDecimals: number;
}

// AMM comparison data
export interface AMMEstimate {
  source: string; // e.g., "PRJX AMM", "HyperSwap AMM", "Hyperliquid Spot"
  amountOut: bigint; // Expected output
  priceImpact: number; // Percentage price impact (curve movement only, excludes fee)
  effectivePrice?: number; // Output per unit input (absent for routed estimates)
  poolLiquidity?: bigint;
  /** Symbol path, e.g. ["USDC","HYPE"] or ["USDC","USDH","HYPE"] */
  route?: string[];
  /** true when route.length === 2 (single pool, no intermediate hop) */
  isDirect?: boolean;
  /** Number of pool hops: route.length - 1 (1 = direct, 2 = one intermediate, etc.) */
  hops?: number;
}

// Trade comparison (RFQ vs AMM)
export interface TradeComparison {
  rfqQuote: QuoteWithMeta | null;
  ammEstimate: AMMEstimate | null;
  rfqAdvantage?: {
    absoluteDiff: bigint;
    percentageDiff: number;
    isBetter: boolean;
  };
}

// Transaction states
export type TransactionStatus =
  | "idle"
  | "approving"
  | "approved"
  | "simulating"      // 🔍 pre-flight simulation before sending the fill
  | "filling"
  | "finalizing"      // ⏳ on-chain confirmed; persisting fill records (retrying)
  | "syncing"         // ⚠️ on-chain confirmed but records still syncing
  | "success"
  | "error";

// ── Taker-side quote validation ──

/**
 * Validation status for a received quote.
 * Only "valid" quotes can be filled on-chain.
 *
 * State machine:
 *   validating → valid | expiring_soon | invalid_signature | expired | needs_approval | structural_mismatch
 */
export type QuoteValidationStatus =
  | "validating"       // async validation in progress
  | "valid"            // ✅ signature verified, not expired, fillable
  | "expiring_soon"    // ⚠️ valid but < 10s to expiry
  | "invalid_signature"// ❌ recovered signer ≠ quote.maker
  | "expired"          // ❌ quote.expiry <= now
  | "needs_approval"   // 🔒 taker must approve tokenIn first
  | "structural_mismatch" // ❌ quote doesn't match request params
  | "error";           // ❌ validation itself failed (RPC error etc.)

export interface QuoteValidationResult {
  status: QuoteValidationStatus;
  /** Human-readable error/warning for UI */
  message?: string;
  /** The on-chain quote hash (from getQuoteHash), if computed */
  quoteHash?: `0x${string}`;
  /** Recovered signer address, if computed */
  recoveredSigner?: `0x${string}`;
  /** Seconds until quote expiry */
  secondsLeft?: number;
}

export interface TransactionState {
  status: TransactionStatus;
  approvalTxHash?: `0x${string}`;
  fillTxHash?: `0x${string}`;
  error?: string;
}

// Conversion helpers
export function requestToJSON(request: RFQRequest): RFQRequestJSON {
  return {
    id: request.id,
    kind: request.kind,
    taker: request.taker,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn?.toString(),
    amountOut: request.amountOut?.toString(),
    minOut: request.minOut?.toString(),
    maxIn: request.maxIn?.toString(),
    expiry: request.expiry,
    createdAt: request.createdAt,
    visibility: request.visibility,
    allowedMakers: request.allowedMakers,
  };
}

export function requestFromJSON(json: RFQRequestJSON): RFQRequest {
  return {
    id: json.id,
    kind: json.kind,
    taker: json.taker as `0x${string}`,
    tokenIn: json.tokenIn,
    tokenOut: json.tokenOut,
    amountIn: json.amountIn ? BigInt(json.amountIn) : undefined,
    amountOut: json.amountOut ? BigInt(json.amountOut) : undefined,
    minOut: json.minOut ? BigInt(json.minOut) : undefined,
    maxIn: json.maxIn ? BigInt(json.maxIn) : undefined,
    expiry: json.expiry,
    createdAt: json.createdAt,
    visibility: json.visibility ?? "public",
    allowedMakers: json.allowedMakers as `0x${string}`[] | undefined,
  };
}

export function quoteToJSON(quote: RFQQuote): RFQQuoteJSON {
  return {
    kind: quote.kind,
    maker: quote.maker,
    taker: quote.taker,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    expiry: quote.expiry,
    nonce: quote.nonce.toString(),
    requestId: quote.requestId,
    signature: quote.signature,
    createdAt: quote.createdAt,
  };
}

export function quoteFromJSON(json: RFQQuoteJSON): RFQQuote {
  return {
    kind: json.kind,
    maker: json.maker as `0x${string}`,
    taker: json.taker as `0x${string}`,
    tokenIn: json.tokenIn as `0x${string}`,
    tokenOut: json.tokenOut as `0x${string}`,
    amountIn: BigInt(json.amountIn),
    amountOut: BigInt(json.amountOut),
    expiry: json.expiry,
    nonce: BigInt(json.nonce),
    requestId: json.requestId,
    signature: json.signature as `0x${string}`,
    createdAt: json.createdAt,
  };
}
