/**
 * GET /api/v1/agent/contract — Get RFQ contract info (role: monitor)
 *
 * Returns the contract address, ABI, and chain details needed to
 * interact with the on-chain settlement contract.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent, requireRole, logActivity } from "@/lib/agentAuth";
import { RFQ_CONTRACT_ADDRESS, RFQ_ABI, ERC20_ABI } from "@/config/contracts";

export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "monitor");
  if (roleError) return roleError;

  logActivity(agent, "contract.info");

  return NextResponse.json({
    rfq: {
      address: RFQ_CONTRACT_ADDRESS,
      abi: RFQ_ABI,
      chainId: 999, // HyperEVM
      rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    },
    erc20: {
      abi: ERC20_ABI,
    },
    signing: {
      // Spot contract uses raw hash signing (NOT EIP-712 typed data from client)
      // The contract computes EIP-712 internally via _hashTypedDataV4
      method: "getQuoteHash",
      description:
        "Call getQuoteHash(quote) on the contract to get the hash, then sign the raw bytes with signMessage({ raw: hash })",
    },
  });
}
