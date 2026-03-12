import { Wallet } from "ethers";
import { Quote } from "./types.js";
import { buildDomain, QUOTE_TYPES, quoteToTypedDataValue } from "./eip712.js";

/**
 * Sign a Quote using EIP-712 typed data signing (ethers v6).
 *
 * @param wallet  ethers.Wallet with private key
 * @param quote   the Quote struct to sign
 * @param chainId chain ID for EIP-712 domain
 * @param engineAddress OptionsEngine contract address
 * @returns 65-byte hex signature (r + s + v)
 */
export async function signQuote(
  wallet: Wallet,
  quote: Quote,
  chainId: number,
  engineAddress: string,
): Promise<string> {
  const domain = buildDomain(chainId, engineAddress);
  const value = quoteToTypedDataValue(quote);

  // ethers v6: wallet.signTypedData(domain, types, value)
  const signature = await wallet.signTypedData(domain, QUOTE_TYPES, value);
  return signature;
}

/**
 * Convenience: create a Wallet from a private key hex string and sign.
 */
export async function signQuoteWithKey(
  privateKey: string,
  quote: Quote,
  chainId: number,
  engineAddress: string,
): Promise<string> {
  const wallet = new Wallet(privateKey);
  return signQuote(wallet, quote, chainId, engineAddress);
}
