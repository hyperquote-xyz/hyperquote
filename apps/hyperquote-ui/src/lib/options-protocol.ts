/**
 * Canonical Options Protocol Logic
 *
 * Implements the same rfqId, EIP-191, EIP-712, and collateral math used by
 * the SDK (packages/sdk-maker) and relay (services/relay).
 *
 * Uses viem (already a project dep) — no ethers dependency required.
 */

import {
  encodeAbiParameters,
  keccak256,
  hashMessage,
  recoverMessageAddress,
  verifyTypedData,
  recoverTypedDataAddress,
  hashTypedData,
  type Hex,
  type Address,
} from "viem";

// -----------------------------------------------------------------------
// 1. rfqId — deterministic hash, matches sdk-maker/rfqHash.ts exactly
// -----------------------------------------------------------------------

/**
 * Canonical ABI parameter types for rfqId computation.
 * Matches: keccak256(abi.encode(requester, underlying, collateral, isCall,
 *   strike, quantity, expiry, minPremium, timestamp))
 */
const RFQ_ABI_PARAMS = [
  { type: "address" as const },
  { type: "address" as const },
  { type: "address" as const },
  { type: "bool" as const },
  { type: "uint256" as const },
  { type: "uint256" as const },
  { type: "uint256" as const },
  { type: "uint256" as const },
  { type: "uint256" as const },
] as const;

export function computeRfqId(rfq: {
  requester: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  strike: bigint;
  quantity: bigint;
  expiry: bigint;
  minPremium: bigint;
  timestamp: bigint;
}): Hex {
  const encoded = encodeAbiParameters(RFQ_ABI_PARAMS, [
    rfq.requester as Address,
    rfq.underlying as Address,
    rfq.collateral as Address,
    rfq.isCall,
    rfq.strike,
    rfq.quantity,
    rfq.expiry,
    rfq.minPremium,
    rfq.timestamp,
  ]);
  return keccak256(encoded);
}

// -----------------------------------------------------------------------
// 2. EIP-191 RFQ signing — personal_sign over the raw 32-byte rfqId hash
// -----------------------------------------------------------------------

/**
 * Produce the EIP-191 message that the relay expects.
 * The user signs the raw 32-byte rfqId with personal_sign.
 * In viem terms: walletClient.signMessage({ message: { raw: rfqIdBytes } })
 *
 * This returns the raw bytes (Uint8Array) to pass as `message.raw`.
 */
export function rfqIdToSignableBytes(rfqId: Hex): Uint8Array {
  // Strip 0x prefix, decode hex to bytes
  const hex = rfqId.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Recover the signer of an RFQ personal_sign signature.
 * Matches relay server.ts verifyRfqSignature().
 */
export async function recoverRfqSigner(
  rfqId: Hex,
  signature: Hex,
): Promise<Address> {
  const raw = rfqIdToSignableBytes(rfqId);
  return recoverMessageAddress({
    message: { raw },
    signature,
  });
}

/**
 * Verify an RFQ signature matches the claimed requester.
 */
export async function verifyRfqSignature(
  rfqId: Hex,
  signature: Hex,
  requester: Address,
): Promise<boolean> {
  try {
    const recovered = await recoverRfqSigner(rfqId, signature);
    return recovered.toLowerCase() === requester.toLowerCase();
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------
// 3. EIP-712 Quote verification — matches sdk-maker/eip712.ts + verifyQuote.ts
// -----------------------------------------------------------------------

/**
 * EIP-712 domain — matches OptionsEngine("HyperQuote Options", "1").
 */
export function buildEip712Domain(chainId: number, engineAddress: Address) {
  return {
    name: "HyperQuote Options" as const,
    version: "1" as const,
    chainId,
    verifyingContract: engineAddress,
  } as const;
}

/**
 * EIP-712 Quote type definition — matches QuoteLib.QUOTE_TYPEHASH exactly.
 * Field order MUST match the Solidity typehash string.
 */
export const QUOTE_EIP712_TYPES = {
  Quote: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "underlying", type: "address" },
    { name: "collateral", type: "address" },
    { name: "isCall", type: "bool" },
    { name: "isMakerSeller", type: "bool" },
    { name: "strike", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "premium", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface QuoteForVerification {
  maker: Address;
  taker: Address;
  underlying: Address;
  collateral: Address;
  isCall: boolean;
  isMakerSeller: boolean;
  strike: bigint;
  quantity: bigint;
  premium: bigint;
  expiry: bigint;
  deadline: bigint;
  nonce: bigint;
}

/**
 * Compute the EIP-712 typed data hash for a quote.
 */
export function hashQuote(
  quote: QuoteForVerification,
  chainId: number,
  engineAddress: Address,
): Hex {
  const domain = buildEip712Domain(chainId, engineAddress);
  return hashTypedData({
    domain,
    types: QUOTE_EIP712_TYPES,
    primaryType: "Quote",
    message: quote,
  });
}

/**
 * Recover the signer of an EIP-712 quote signature.
 * Matches relay server.ts verifyQuoteSignature() and sdk-maker recoverQuoteSigner().
 */
export async function recoverQuoteSigner(
  quote: QuoteForVerification,
  signature: Hex,
  chainId: number,
  engineAddress: Address,
): Promise<Address> {
  const domain = buildEip712Domain(chainId, engineAddress);
  return recoverTypedDataAddress({
    domain,
    types: QUOTE_EIP712_TYPES,
    primaryType: "Quote",
    message: quote,
    signature,
  });
}

/**
 * Verify that a quote signature was produced by the claimed maker.
 */
export async function verifyQuoteSignature(
  quote: QuoteForVerification,
  signature: Hex,
  chainId: number,
  engineAddress: Address,
): Promise<boolean> {
  try {
    const recovered = await recoverQuoteSigner(quote, signature, chainId, engineAddress);
    return recovered.toLowerCase() === quote.maker.toLowerCase();
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------
// 4. Collateral math — matches Solidity CollateralMath.sol exactly
// -----------------------------------------------------------------------

/**
 * Ceiling division — matches CollateralMath.ceilDiv.
 * Returns ceil(a / b). Reverts (throws) if b == 0.
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("ceilDiv: division by zero");
  if (a === 0n) return 0n;
  return ((a - 1n) / b) + 1n;
}

/**
 * Collateral required for a Cash-Secured Put.
 * Matches CollateralMath.putCollateralRequired.
 *
 * Formula: ceilDiv(strike * quantity, 10^(18 + uDec - cDec))
 *
 * @param strike   1e18 fixed-point strike price
 * @param quantity Underlying base units (10^uDec)
 * @param uDec     Underlying token decimals (e.g. 18 for WHYPE)
 * @param cDec     Collateral token decimals (e.g. 6 for USDC)
 * @returns Collateral in base units (10^cDec), rounded UP
 */
export function putCollateralRequired(
  strike: bigint,
  quantity: bigint,
  uDec: number,
  cDec: number,
): bigint {
  const product = strike * quantity;
  const exponent = 18 + uDec - cDec;
  const divisor = 10n ** BigInt(exponent);
  return ceilDiv(product, divisor);
}

/**
 * Collateral required for a Covered Call.
 * The seller locks `quantity` of the underlying token.
 *
 * @param quantity Underlying base units (10^uDec)
 * @returns quantity unchanged — seller locks the actual underlying
 */
export function callCollateralRequired(quantity: bigint): bigint {
  return quantity;
}

/**
 * Compute the correct approval amount for the seller.
 * CSP: approve collateralToken for putCollateralRequired (ceil-rounded)
 * CC:  approve underlyingToken for quantity
 */
export function approvalAmount(
  isCall: boolean,
  strike: bigint,
  quantity: bigint,
  uDec: number,
  cDec: number,
): bigint {
  return isCall
    ? callCollateralRequired(quantity)
    : putCollateralRequired(strike, quantity, uDec, cDec);
}

// -----------------------------------------------------------------------
// 5. Expiry snap — matches relay validation
// -----------------------------------------------------------------------

/**
 * Compute 08:00 UTC snap N days from now.
 * Relay validates: expiry % 86400 === 28800.
 */
export function futureExpiry08UTC(daysOut: number): bigint {
  const now = Math.floor(Date.now() / 1000);
  const daySeconds = 86400;
  const eightAM = 28800;
  const todayMidnight = now - (now % daySeconds);
  const expiry = todayMidnight + eightAM + daysOut * daySeconds;
  return BigInt(expiry > now ? expiry : expiry + daySeconds);
}

// -----------------------------------------------------------------------
// 6. JSON transport — matches SDK rfqToJson format (hex strings)
// -----------------------------------------------------------------------

export function rfqToJson(rfq: {
  requester: string;
  underlying: string;
  collateral: string;
  isCall: boolean;
  strike: bigint;
  quantity: bigint;
  expiry: bigint;
  minPremium: bigint;
  timestamp: bigint;
}): Record<string, unknown> {
  return {
    requester: rfq.requester,
    underlying: rfq.underlying,
    collateral: rfq.collateral,
    isCall: rfq.isCall,
    strike: "0x" + rfq.strike.toString(16),
    quantity: "0x" + rfq.quantity.toString(16),
    expiry: "0x" + rfq.expiry.toString(16),
    minPremium: "0x" + rfq.minPremium.toString(16),
    timestamp: "0x" + rfq.timestamp.toString(16),
  };
}

// -----------------------------------------------------------------------
// 7. Decimal parsing — safe bigint conversion from human input
// -----------------------------------------------------------------------

/**
 * Parse a human-readable decimal string (e.g. "25.5") to a fixed-point
 * bigint with the given number of decimals.
 *
 * "25"    + 18 dec → 25000000000000000000n
 * "0.001" +  6 dec → 1000n
 */
export function parseDecimal(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!trimmed || trimmed === ".") return 0n;

  const [whole = "0", frac = ""] = trimmed.split(".");
  const paddedFrac = frac.slice(0, decimals).padEnd(decimals, "0");
  const combined = whole + paddedFrac;
  // Remove leading zeros (but keep at least "0")
  return BigInt(combined.replace(/^0+(?=\d)/, ""));
}
