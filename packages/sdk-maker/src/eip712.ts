import { TypedDataDomain, TypedDataField, TypedDataEncoder } from "ethers";
import { Quote } from "./types.js";

// ---------------------------------------------------------------
// EIP-712 Domain — matches OptionsEngine constructor:
//   EIP712("HyperQuote Options", "1")
// ---------------------------------------------------------------

/**
 * Build the EIP-712 domain for quote signing.
 * Must match the Solidity EIP712("HyperQuote Options", "1") constructor.
 */
export function buildDomain(
  chainId: number,
  verifyingContract: string,
): TypedDataDomain {
  return {
    name: "HyperQuote Options",
    version: "1",
    chainId,
    verifyingContract,
  };
}

// ---------------------------------------------------------------
// EIP-712 Types — matches QuoteLib.QUOTE_TYPEHASH exactly
// ---------------------------------------------------------------

/**
 * The QUOTE_TYPEHASH string from Solidity:
 * "Quote(address maker,address taker,address underlying,address collateral,
 *  bool isCall,bool isMakerSeller,uint256 strike,uint256 quantity,
 *  uint256 premium,uint256 expiry,uint256 deadline,uint256 nonce)"
 *
 * Field order in the types array MUST match this string.
 */
export const QUOTE_TYPES: Record<string, TypedDataField[]> = {
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
};

// ---------------------------------------------------------------
// Quote → EIP-712 value object
// ---------------------------------------------------------------

/**
 * Convert a Quote into the value object expected by ethers TypedDataEncoder.
 * bigints are kept as-is — ethers v6 handles them natively.
 */
export function quoteToTypedDataValue(q: Quote): Record<string, unknown> {
  return {
    maker: q.maker,
    taker: q.taker,
    underlying: q.underlying,
    collateral: q.collateral,
    isCall: q.isCall,
    isMakerSeller: q.isMakerSeller,
    strike: q.strike,
    quantity: q.quantity,
    premium: q.premium,
    expiry: q.expiry,
    deadline: q.deadline,
    nonce: q.nonce,
  };
}

/**
 * Compute the EIP-712 struct hash of a Quote (without domain).
 * Useful for computing quoteHash / digest for verification.
 */
export function hashQuoteStruct(q: Quote): string {
  return TypedDataEncoder.hashStruct("Quote", QUOTE_TYPES, quoteToTypedDataValue(q));
}

/**
 * Compute the full EIP-712 hash (with domain separator).
 * This is the digest that gets signed.
 */
export function hashQuoteTypedData(
  domain: TypedDataDomain,
  q: Quote,
): string {
  return TypedDataEncoder.hash(domain, QUOTE_TYPES, quoteToTypedDataValue(q));
}
