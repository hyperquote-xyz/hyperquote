import { verifyTypedData } from "ethers";
import { Quote } from "./types.js";
import { buildDomain, QUOTE_TYPES, quoteToTypedDataValue } from "./eip712.js";

/**
 * Verify that a quote signature was produced by the claimed maker.
 *
 * @param quote     the Quote struct
 * @param signature 65-byte hex signature
 * @param chainId   chain ID for domain
 * @param engineAddress OptionsEngine contract address
 * @returns true if signature is valid and signer matches quote.maker
 */
export function verifyQuoteSignature(
  quote: Quote,
  signature: string,
  chainId: number,
  engineAddress: string,
): boolean {
  const domain = buildDomain(chainId, engineAddress);
  const value = quoteToTypedDataValue(quote);

  try {
    const recovered = verifyTypedData(domain, QUOTE_TYPES, value, signature);
    return recovered.toLowerCase() === quote.maker.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Recover the signer address from a quote signature.
 */
export function recoverQuoteSigner(
  quote: Quote,
  signature: string,
  chainId: number,
  engineAddress: string,
): string {
  const domain = buildDomain(chainId, engineAddress);
  const value = quoteToTypedDataValue(quote);
  return verifyTypedData(domain, QUOTE_TYPES, value, signature);
}
