import type { Token } from "@/types";

export const WHYPE_ADDRESS =
  "0x5555555555555555555555555555555555555555" as const satisfies `0x${string}`;

/** Standard WETH ABI — deposit() wraps native→ERC20, withdraw() unwraps */
export const WHYPE_ABI = [
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "wad", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** True if token is native HYPE (address 0x000…000). */
export function isNativeHype(token: Token): boolean {
  return token.address.toLowerCase() === ZERO_ADDRESS;
}

/**
 * Resolve a user-facing token to its settlement token.
 * HYPE (native) → WHYPE (ERC-20). All others pass through unchanged.
 */
export function resolveSettlementToken(token: Token): Token {
  if (!isNativeHype(token)) return token;
  return {
    ...token,
    address: WHYPE_ADDRESS,
    symbol: "WHYPE",
    name: "Wrapped HYPE",
    isNative: false,
  };
}

/** True when the user selected native HYPE and would need to wrap before spending. */
export function needsWrap(token: Token): boolean {
  return isNativeHype(token);
}
