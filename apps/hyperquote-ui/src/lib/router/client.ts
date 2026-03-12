/**
 * Viem Public Client — Server-side RPC access
 *
 * Singleton public client for on-chain reads (event logs, contract calls).
 * Uses the same chain config as the frontend wagmi setup.
 */

import { createPublicClient, http } from "viem";
import { hyperEVM } from "@/config/chains";

const globalForClient = globalThis as unknown as {
  viemClient: ReturnType<typeof createPublicClient> | undefined;
};

function createClient() {
  return createPublicClient({
    chain: hyperEVM,
    transport: http(
      process.env.SOR_RPC_URL ||
        process.env.NEXT_PUBLIC_RPC_URL ||
        "https://rpc.hyperliquid.xyz/evm"
    ),
    batch: {
      multicall: true,
    },
  });
}

export const publicClient =
  globalForClient.viemClient ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForClient.viemClient = publicClient;
}
