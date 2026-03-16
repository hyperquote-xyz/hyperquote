/**
 * Server-side Quote Signature Verification
 *
 * Verifies that a maker's signature on a spot quote is valid by:
 *   1. Calling getQuoteHash() on the on-chain RFQ contract (view function, free)
 *   2. Recovering the signer via ethers.recoverAddress() (EIP-712 recovery)
 *   3. Comparing recovered signer to the claimed maker address
 *
 * The maker signs via EIP-712 signTypedData, so the contract (and this verifier)
 * recover using the raw EIP-712 typed data hash — NOT the EIP-191 message hash.
 *
 * Uses a lazy singleton provider + contract instance.
 */

import { ethers } from "ethers";
import { RFQ_CONTRACT_ADDRESS, RFQ_ABI } from "@/config/contracts";

// ---------------------------------------------------------------------------
// Lazy singleton provider + contract
// ---------------------------------------------------------------------------

let _provider: ethers.JsonRpcProvider | null = null;
let _contract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const rpcUrl =
      process.env.SOR_RPC_URL ||
      process.env.NEXT_PUBLIC_RPC_URL ||
      "https://rpc.hyperliquid.xyz/evm";
    _provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return _provider;
}

function getContract(): ethers.Contract {
  if (!_contract) {
    _contract = new ethers.Contract(
      RFQ_CONTRACT_ADDRESS,
      RFQ_ABI,
      getProvider()
    );
  }
  return _contract;
}

// ---------------------------------------------------------------------------
// Quote tuple type (matches contract struct)
// ---------------------------------------------------------------------------

export interface QuoteTuple {
  kind: number;
  maker: string;
  taker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string | bigint;
  amountOut: string | bigint;
  expiry: number | bigint;
  nonce: string | bigint;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyResult {
  valid: boolean;
  recoveredSigner?: string;
  error?: string;
}

/**
 * Verify a maker's quote signature against the on-chain contract.
 *
 * Performs three checks:
 *   1. Expiry — rejects quotes that have already expired (client-side)
 *   2. Nonce — rejects quotes whose nonce is below the maker's on-chain nonce
 *      (i.e. the maker called cancelAllQuotes since signing)
 *   3. Signature — calls getQuoteHash(tuple) on-chain, then recovers the signer
 *
 * Returns { valid: true, recoveredSigner } on success,
 * or { valid: false, error } on failure.
 */
export async function verifyQuoteSignature(
  quote: QuoteTuple,
  signature: string
): Promise<VerifyResult> {
  try {
    // Pre-flight: reject expired quotes before hitting the chain
    const now = Math.floor(Date.now() / 1000);
    if (Number(quote.expiry) <= now) {
      return { valid: false, error: "Quote expired" };
    }

    const contract = getContract();

    // Pre-flight: reject stale quotes (maker cancelled via cancelAllQuotes)
    const currentNonce: bigint = await contract.makerNonce(quote.maker);
    if (BigInt(quote.nonce) < currentNonce) {
      return { valid: false, error: "Quote nonce too low (maker cancelled)" };
    }

    // Build the tuple in the order the contract expects
    const tuple = [
      Number(quote.kind),
      quote.maker,
      quote.taker,
      quote.tokenIn,
      quote.tokenOut,
      BigInt(quote.amountIn),
      BigInt(quote.amountOut),
      BigInt(quote.expiry),
      BigInt(quote.nonce),
    ];

    // Call on-chain view function (free, no gas)
    const hash: string = await contract.getQuoteHash(tuple);

    // The maker signs via EIP-712 signTypedData — recover from the raw hash
    // (NOT verifyMessage, which would add an EIP-191 prefix mismatch)
    const recoveredSigner = ethers.recoverAddress(
      hash,
      signature
    ).toLowerCase();

    return { valid: true, recoveredSigner };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Signature verification failed",
    };
  }
}
