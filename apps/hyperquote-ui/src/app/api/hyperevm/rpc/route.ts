/**
 * HyperEVM RPC Proxy — eth_call only
 *
 * POST /api/hyperevm/rpc
 *
 * Server-side proxy for eth_call requests to HyperEVM RPC.
 * Only allows eth_call (read-only) — rejects write methods.
 * Used by PRJX QuoterV2 for on-chain swap quotes.
 */

import { NextResponse } from "next/server";

const RPC_URL = process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";
const ALLOWED_METHODS = new Set(["eth_call"]);
const TIMEOUT_MS = 5_000;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();

    if (!body.method || !ALLOWED_METHODS.has(body.method)) {
      return NextResponse.json(
        { jsonrpc: "2.0", id: body.id ?? 1, error: { code: -32601, message: "Only eth_call is allowed" } },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "RPC request timed out"
      : "RPC proxy error";

    return NextResponse.json(
      { jsonrpc: "2.0", id: 1, error: { code: -32000, message } },
      { status: 502 },
    );
  }
}
