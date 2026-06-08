/**
 * Wallet ownership verification for taker-authenticated endpoints.
 *
 * The client signs a deterministic EIP-191 (personal_sign) message with their
 * wallet; the server recovers the signer and checks it matches the expected
 * address (e.g. the RFQ's taker). This proves the caller controls the wallet
 * without any session/cookie infrastructure.
 */

import { verifyMessage } from "viem";

/**
 * Canonical message a taker signs to cancel their own RFQ.
 * Binding the rfqId means a captured signature can only cancel that one RFQ —
 * which the taker already authorized — so replay is harmless.
 */
export function cancelRfqMessage(rfqId: string): string {
  return `HyperQuote: cancel RFQ ${rfqId}`;
}

/**
 * Verify that `signature` over `message` was produced by `expectedAddress`.
 * Returns true only on a valid match. Supports EOA signatures (and EIP-1271
 * via viem's verifyMessage when a public client is available — here we use the
 * pure-EOA path which is sufficient for taker wallets).
 */
export async function verifyWalletSignature(
  expectedAddress: string,
  message: string,
  signature: string
): Promise<boolean> {
  if (!expectedAddress || !signature) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(expectedAddress)) return false;
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return false;

  try {
    return await verifyMessage({
      address: expectedAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
