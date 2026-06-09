/**
 * Maker solvency / approval checks.
 *
 * A maker quote is only executable if the maker can actually deliver tokenOut:
 * they must HOLD amountOut and have APPROVED the RFQ contract to spend it.
 * (For both EXACT_IN and EXACT_OUT the contract transfers `amountOut` of
 * tokenOut from maker → taker.)
 *
 * All checks are on-chain reads (balanceOf / allowance) — never maker
 * self-reporting.
 */

import { ERC20_ABI, RFQ_CONTRACT_ADDRESS } from "@/config/contracts";

export type MakerIssue =
  | "maker_insufficient_balance"
  | "maker_approval_missing"
  | null;

export interface MakerSolvency {
  executable: boolean;
  issue: MakerIssue;
  /** Human label for UI */
  label: string;
  balance?: bigint;
  allowance?: bigint;
  /** True if the read itself failed (treat as "unknown", not "unexecutable") */
  unknown?: boolean;
}

const OK: MakerSolvency = { executable: true, issue: null, label: "Executable" };

interface SolvencyInput {
  maker: string;
  tokenOut: string;
  amountOut: bigint;
}

/**
 * Check a single maker's ability to settle a quote.
 * On read failure, returns { executable: true, unknown: true } so a transient
 * RPC error does not falsely hide a good quote — the pre-fill simulation is the
 * authoritative final gate.
 */
export async function checkMakerSolvency(q: SolvencyInput): Promise<MakerSolvency> {
  if (!q.maker || !q.tokenOut || q.amountOut <= 0n) {
    return { executable: false, issue: "maker_insufficient_balance", label: "Maker cannot settle" };
  }

  try {
    const { readContract } = await import("wagmi/actions");
    const { wagmiConfig } = await import("@/lib/wagmi");

    const [balance, allowance] = await Promise.all([
      readContract(wagmiConfig, {
        address: q.tokenOut as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [q.maker as `0x${string}`],
      }) as Promise<bigint>,
      readContract(wagmiConfig, {
        address: q.tokenOut as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [q.maker as `0x${string}`, RFQ_CONTRACT_ADDRESS],
      }) as Promise<bigint>,
    ]);

    if (balance < q.amountOut) {
      return { executable: false, issue: "maker_insufficient_balance", label: "Maker cannot settle", balance, allowance };
    }
    if (allowance < q.amountOut) {
      return { executable: false, issue: "maker_approval_missing", label: "Maker approval missing", balance, allowance };
    }
    return { ...OK, balance, allowance };
  } catch {
    // Read failed — don't penalize the quote; simulation will catch real issues.
    return { executable: true, issue: null, label: "Executable", unknown: true };
  }
}

/**
 * Batch version. Returns a Map keyed by quote signature.
 */
export async function checkMakerSolvencyBatch(
  quotes: { signature: string; maker: string; tokenOut: string; amountOut: bigint }[]
): Promise<Map<string, MakerSolvency>> {
  const out = new Map<string, MakerSolvency>();
  const results = await Promise.all(
    quotes.map((q) => checkMakerSolvency({ maker: q.maker, tokenOut: q.tokenOut, amountOut: q.amountOut }))
  );
  quotes.forEach((q, i) => out.set(q.signature, results[i]));
  return out;
}

/** Map a maker issue to the taker-facing message. */
export function makerIssueMessage(issue: MakerIssue): string {
  switch (issue) {
    case "maker_insufficient_balance":
      return "Maker cannot settle this quote right now.";
    case "maker_approval_missing":
      return "Maker has not approved this token for settlement.";
    default:
      return "";
  }
}
