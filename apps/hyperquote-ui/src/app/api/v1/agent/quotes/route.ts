/**
 * POST /api/v1/agent/quotes — Submit a signed quote for an RFQ (role: maker)
 *
 * Body:
 *   rfqId       — RFQ request ID to quote against
 *   kind        — QuoteKind (0=EXACT_IN, 1=EXACT_OUT)
 *   maker       — Maker address (must match agent wallet)
 *   taker       — Taker address (from RFQ request)
 *   tokenIn     — Input token address
 *   tokenOut    — Output token address
 *   amountIn    — Raw BigInt string
 *   amountOut   — Raw BigInt string
 *   expiry      — Unix timestamp for quote expiry
 *   nonce       — Maker's current nonce from contract
 *   signature   — Raw ECDSA signature over getQuoteHash output
 *   shareToken  — Optional, required for private RFQs
 *
 * Delegates to rfqRegistry.submitQuote().
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAgent,
  requireRole,
  logActivity,
  getClientIp,
} from "@/lib/agentAuth";
import { submitQuote } from "@/lib/rfqRegistry";
import { verifyQuoteSignature } from "@/lib/quoteVerifier";
import type { RFQQuoteJSON } from "@/types";

interface QuoteBody {
  rfqId: string;
  kind: number;
  maker: string;
  taker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  expiry: number;
  nonce: string;
  signature: string;
  shareToken?: string;
}

export async function POST(request: NextRequest) {
  const { agent, error } = await authenticateAgent(request);
  if (error) return error;

  const roleError = requireRole(agent, "maker");
  if (roleError) return roleError;

  let body: QuoteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ── Validate required fields ──

  if (!body.rfqId) {
    return NextResponse.json(
      { error: "rfqId is required" },
      { status: 400 }
    );
  }

  if (
    !body.maker ||
    !/^0x[0-9a-fA-F]{40}$/.test(body.maker)
  ) {
    return NextResponse.json(
      { error: "Invalid maker address" },
      { status: 400 }
    );
  }

  // Maker must match agent wallet
  if (body.maker.toLowerCase() !== agent.wallet.toLowerCase()) {
    return NextResponse.json(
      {
        error: "maker address must match your agent wallet",
        agentWallet: agent.wallet,
        providedMaker: body.maker.toLowerCase(),
      },
      { status: 403 }
    );
  }

  if (!body.signature || body.signature.length < 130) {
    return NextResponse.json(
      { error: "signature is required (at least 130 hex chars)" },
      { status: 400 }
    );
  }

  // Validate BigInt strings
  try {
    BigInt(body.amountIn);
    BigInt(body.amountOut);
    BigInt(body.nonce);
  } catch {
    return NextResponse.json(
      { error: "amountIn, amountOut, and nonce must be valid BigInt strings" },
      { status: 400 }
    );
  }

  // ── Verify signature cryptographically ──
  // Calls getQuoteHash() on-chain (free view call) then recovers signer

  const verifyResult = await verifyQuoteSignature(
    {
      kind: body.kind,
      maker: body.maker,
      taker: body.taker,
      tokenIn: body.tokenIn,
      tokenOut: body.tokenOut,
      amountIn: body.amountIn,
      amountOut: body.amountOut,
      expiry: body.expiry,
      nonce: body.nonce,
    },
    body.signature
  );

  if (!verifyResult.valid) {
    return NextResponse.json(
      {
        error: `Invalid quote signature: ${verifyResult.error}`,
        accepted: false,
      },
      { status: 400 }
    );
  }

  if (verifyResult.recoveredSigner !== body.maker.toLowerCase()) {
    return NextResponse.json(
      {
        error: "Signature does not match maker address",
        expected: body.maker.toLowerCase(),
        recovered: verifyResult.recoveredSigner,
        accepted: false,
      },
      { status: 403 }
    );
  }

  // ── Build quote and submit ──

  const quote: RFQQuoteJSON = {
    kind: body.kind,
    maker: body.maker,
    taker: body.taker,
    tokenIn: body.tokenIn,
    tokenOut: body.tokenOut,
    amountIn: body.amountIn,
    amountOut: body.amountOut,
    expiry: body.expiry,
    nonce: body.nonce,
    requestId: body.rfqId,
    signature: body.signature,
    createdAt: Math.floor(Date.now() / 1000),
  };

  const result = await submitQuote(body.rfqId, quote, body.shareToken);

  logActivity(agent, "quote.submit", {
    rfqId: body.rfqId,
    accepted: result.accepted,
    ipAddress: getClientIp(request),
  });

  if (!result.accepted) {
    return NextResponse.json(
      { error: result.reason, accepted: false },
      { status: 400 }
    );
  }

  return NextResponse.json({
    accepted: true,
    rfqId: body.rfqId,
  });
}
