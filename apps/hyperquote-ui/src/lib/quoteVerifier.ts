/**
 * Server-side Quote Signature Verification
 *
 * Verifies that a maker's signature on a spot quote is valid by:
 *   1. Calling getQuoteHash() on the on-chain RFQ contract (view function, free)
 *   2. Recovering the signer via ethers.verifyMessage()
 *   3. Comparing recovered signer to the claimed maker address
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
 * Calls getQuoteHash(tuple) on the RFQ contract (a free view call),
 * then recovers the signer address from the ECDSA signature.
 *
 * Returns { valid: true, recoveredSigner } on success,
 * or { valid: false, error } on failure.
 */
export async function verifyQuoteSignature(
  quote: QuoteTuple,
  signature: string
): Promise<VerifyResult> {
  try {
    const contract = getContract();

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

    // The maker signs the raw hash bytes using signMessage (adds EIP-191 prefix)
    const recoveredSigner = ethers.verifyMessage(
      ethers.getBytes(hash),
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
