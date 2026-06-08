/**
 * On-chain fill verification.
 *
 * A fill record (and the points it awards) must be backed by a real,
 * successful `QuoteFilled` event emitted by the RFQ settlement contract.
 * This module fetches the transaction receipt and decodes that event so the
 * server can trust the on-chain values rather than client-supplied amounts.
 *
 * Dev escape hatch:
 *   When NODE_ENV !== "production" AND ALLOW_UNVERIFIED_FILLS === "true",
 *   verification is bypassed (for local simulation). This is impossible in
 *   production because NODE_ENV is "production" there.
 */

import { createPublicClient, http, parseEventLogs } from "viem";
import { RFQ_ABI, RFQ_CONTRACT_ADDRESS } from "@/config/contracts";

const RPC_URL =
  process.env.HYPEREVM_RPC_URL ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://rpc.hyperliquid.xyz/evm";

export interface VerifiedFill {
  quoteHash: string;
  maker: string;
  taker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  feeAmountIn: bigint;
}

/** True only in local/dev when explicitly opted in. Never true in production. */
export function allowUnverifiedFills(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_UNVERIFIED_FILLS === "true"
  );
}

let _client: ReturnType<typeof createPublicClient> | null = null;
function client() {
  if (!_client) {
    _client = createPublicClient({ transport: http(RPC_URL) });
  }
  return _client;
}

/**
 * Verify a fill transaction and return the decoded QuoteFilled event.
 *
 * Returns null if: tx not found, reverted, or contains no QuoteFilled event
 * emitted by the configured RFQ contract.
 */
export async function verifyFillTransaction(
  txHash: string
): Promise<VerifiedFill | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  if (!RFQ_CONTRACT_ADDRESS || RFQ_CONTRACT_ADDRESS === "0x0") return null;

  let receipt;
  try {
    receipt = await client().getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
  } catch {
    return null; // not mined / not found
  }

  if (!receipt || receipt.status !== "success") return null;

  // Only consider logs emitted by the RFQ settlement contract.
  const contractLogs = receipt.logs.filter(
    (l) => l.address.toLowerCase() === RFQ_CONTRACT_ADDRESS.toLowerCase()
  );
  if (contractLogs.length === 0) return null;

  let parsed;
  try {
    parsed = parseEventLogs({
      abi: RFQ_ABI,
      eventName: "QuoteFilled",
      logs: contractLogs,
    });
  } catch {
    return null;
  }

  if (!parsed || parsed.length === 0) return null;

  // Use the first QuoteFilled event in the tx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = (parsed[0] as any).args;
  if (!args) return null;

  return {
    quoteHash: String(args.quoteHash),
    maker: String(args.maker).toLowerCase(),
    taker: String(args.taker).toLowerCase(),
    tokenIn: String(args.tokenIn).toLowerCase(),
    tokenOut: String(args.tokenOut).toLowerCase(),
    amountIn: BigInt(args.amountIn),
    amountOut: BigInt(args.amountOut),
    feeAmountIn: BigInt(args.feeAmountIn),
  };
}
