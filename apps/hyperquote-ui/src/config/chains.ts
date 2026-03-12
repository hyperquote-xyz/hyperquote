import { defineChain } from "viem";

/**
 * HyperEVM Chain Configuration
 */
export const hyperEVM = defineChain({
  id: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || "999999"),
  name: process.env.NEXT_PUBLIC_CHAIN_NAME || "HyperEVM",
  nativeCurrency: {
    decimals: 18,
    name: "HYPE",
    symbol: "HYPE",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.hyperevm.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "HyperEVM Explorer",
      url: process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL || "https://explorer.hyperevm.io",
    },
  },
});
