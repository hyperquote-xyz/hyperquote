import { NextRequest, NextResponse } from "next/server";
import { registerRFQ, getActiveCount } from "@/lib/rfqRegistry";
import type { RFQRequestJSON, RFQVisibility } from "@/types";

/**
 * POST /api/rfq — Register a new RFQ with server-side limit enforcement.
 *
 * Body: { wallet: string, visibility: "public"|"private", expiry: number, rfqData: RFQRequestJSON }
 * Returns: { allowed: true, shareToken, activeCount } or { allowed: false, reason }
 */
export async function POST(request: NextRequest) {
  let body: {
    wallet: string;
    visibility: RFQVisibility;
    expiry: number;
    rfqData: RFQRequestJSON;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { allowed: false, reason: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Validate required fields
  if (
    !body.wallet ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.wallet) ||
    !body.visibility ||
    !body.expiry ||
    !body.rfqData
  ) {
    return NextResponse.json(
      { allowed: false, reason: "Missing or invalid required fields" },
      { status: 400 }
    );
  }

  // Extract IP from headers
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  console.log("[POST /api/rfq] validated, calling registerRFQ...", {
    wallet: body.wallet.slice(0, 10),
    visibility: body.visibility,
    rfqId: body.rfqData?.id?.slice(0, 8),
    ip: ip.slice(0, 10),
  });

  let result;
  try {
    result = await registerRFQ({
      wallet: body.wallet,
      visibility: body.visibility,
      expiry: body.expiry,
      rfqData: body.rfqData,
      ip,
    });
    console.log("[POST /api/rfq] registerRFQ returned:", JSON.stringify(result).slice(0, 200));
  } catch (err) {
    console.error("[POST /api/rfq] registerRFQ THREW:", err);
    return NextResponse.json(
      { allowed: false, reason: "Internal error: " + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    );
  }

  if (!result.allowed) {
    return NextResponse.json(result, { status: 429 });
  }

  return NextResponse.json(result);
}

/**
 * GET /api/rfq?wallet=0x... — Get active RFQ count for a wallet.
 *
 * Returns: { public: number, private: number }
 */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json(
      { error: "Invalid or missing wallet parameter" },
      { status: 400 }
    );
  }

  console.log("[GET /api/rfq] calling getActiveCount for", wallet.slice(0, 10));
  try {
    const count = await getActiveCount(wallet);
    console.log("[GET /api/rfq] result:", count);
    return NextResponse.json(count);
  } catch (err) {
    console.error("[GET /api/rfq] THREW:", err instanceof Error ? err.message : err);
    console.error("[GET /api/rfq] error type:", err?.constructor?.name);
    console.error("[GET /api/rfq] code:", (err as any)?.code);
    console.error("[GET /api/rfq] full:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
