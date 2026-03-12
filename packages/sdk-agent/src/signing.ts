/**
 * HyperQuote Agent SDK — Signing Helpers
 *
 * Spot contract uses getQuoteHash() → raw signMessage({ raw }).
 * This is different from the options contract which uses EIP-712 typed data.
 */

import { ethers } from "ethers";
import type { SpotQuote, QuoteKind } from "./types.js";

// Minimal ABI for getQuoteHash and makerNonce
const RFQ_ABI_FRAGMENT = [
  {
    inputs: [
      {
        components: [
          { name: "kind", type: "uint8" },
          { name: "maker", type: "address" },
          { name: "taker", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOut", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
        name: "quote",
        type: "tuple",
      },
    ],
    name: "getQuoteHash",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "address" }],
    name: "makerNonce",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Get the maker's current nonce from the RFQ contract.
 */
export async function getMakerNonce(
  provider: ethers.Provider,
  contractAddress: string,
  makerAddress: string
): Promise<bigint> {
  const contract = new ethers.Contract(
    contractAddress,
    RFQ_ABI_FRAGMENT,
    provider
  );
  const nonce: bigint = await contract.makerNonce(makerAddress);
  return nonce;
}

/**
 * Build the quote tuple for the smart contract.
 */
export function buildQuoteTuple(quote: {
  kind: QuoteKind | number;
  maker: string;
  taker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint | string;
  amountOut: bigint | string;
  expiry: number | bigint;
  nonce: bigint | string;
}): [number, string, string, string, string, bigint, bigint, bigint, bigint] {
  return [
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
}

/**
 * Sign a spot quote using the RFQ contract's getQuoteHash.
 *
 * @param wallet - ethers Wallet with the maker's private key
 * @param quote  - Quote parameters
 * @param contractAddress - RFQ contract address
 * @returns The ECDSA signature string (0x...)
 */
export async function signSpotQuote(
  wallet: ethers.Wallet,
  quote: {
    kind: QuoteKind | number;
    maker: string;
    taker: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint | string;
    amountOut: bigint | string;
    expiry: number | bigint;
    nonce: bigint | string;
  },
  contractAddress: string
): Promise<string> {
  if (!wallet.provider) {
    throw new Error("Wallet must be connected to a provider");
  }

  const contract = new ethers.Contract(
    contractAddress,
    RFQ_ABI_FRAGMENT,
    wallet.provider
  );

  const tuple = buildQuoteTuple(quote);
  const hash: string = await contract.getQuoteHash(tuple);

  // Sign the raw hash bytes (NOT ethers.hashMessage which adds EIP-191 prefix)
  // The contract uses _hashTypedDataV4 internally — we sign the raw output
  const signature = await wallet.signMessage(ethers.getBytes(hash));

  return signature;
}

/**
 * Build a full SpotQuote JSON object ready for submission.
 */
export function buildSpotQuoteJSON(params: {
  kind: QuoteKind | number;
  maker: string;
  taker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  expiry: number;
  nonce: bigint;
  requestId: string;
  signature: string;
}): SpotQuote {
  return {
    kind: params.kind as QuoteKind,
    maker: params.maker,
    taker: params.taker,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn.toString(),
    amountOut: params.amountOut.toString(),
    expiry: params.expiry,
    nonce: params.nonce.toString(),
    requestId: params.requestId,
    signature: params.signature,
    createdAt: Math.floor(Date.now() / 1000),
  };
}
