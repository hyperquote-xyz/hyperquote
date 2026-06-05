/**
 * HT.xyz R1 Quote Proxy
 *
 * GET /api/v1/bench/ht/quote?src=0x...&dst=0x...&amount=...&slippage=0.3&receiver=0x...
 *
 * Server-side proxy to HT R1 GET /quote.
 * Returns the full R1 response (toAmount, protocols, action, etc.)
 * Returns HTTP 200 even on upstream failure (error field populated).
 */

import { NextResponse } from "next/server";

const HT_BASE = "https://core.ht.xyz/api/v1/trade";
const HT_TIMEOUT_MS = 5_000;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const src = url.searchParams.get("src");
  const dst = url.searchParams.get("dst");
  const amount = url.searchParams.get("amount");
  const slippage = url.searchParams.get("slippage") ?? "0.3";
  const receiver = url.searchParams.get("receiver") ?? "0x0000000000000000000000000000000000000001";
  const includeHyperCore = url.searchParams.get("includeHyperCore") ?? "false";

  if (!src || !dst || !amount) {
    return NextResponse.json({ error: "Missing src, dst, or amount" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HT_TIMEOUT_MS);

    const params = new URLSearchParams({
      src, dst, amount, slippage, receiver, includeHyperCore,
    });

    const res = await fetch(`${HT_BASE}/quote?${params}`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({
        error: `HT R1 returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        toAmount: null,
      });
    }

    const json = await res.json();
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "HT R1 request timed out (5s)"
      : "HT R1 quote failed";

    return NextResponse.json({ error: message, toAmount: null });
  }
}
