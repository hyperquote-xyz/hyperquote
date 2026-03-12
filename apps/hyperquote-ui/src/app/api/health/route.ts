import { NextResponse } from "next/server";

/**
 * GET /api/health — Lightweight health check.
 *
 * Returns 200 with basic status info. Useful for uptime monitors,
 * load-balancer probes, and CI smoke tests.
 *
 * Response: { status: "ok", timestamp, uptime, version, env }
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? "0.1.0",
    env: {
      chainId: process.env.NEXT_PUBLIC_CHAIN_ID ?? "unknown",
      spotRfqContract: process.env.NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS
        ? `${process.env.NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS.slice(0, 6)}...${process.env.NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS.slice(-4)}`
        : "not set",
      optionsEngine: process.env.NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS
        ? `${process.env.NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS.slice(0, 6)}...${process.env.NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS.slice(-4)}`
        : "not set",
      relay: process.env.NEXT_PUBLIC_USE_RELAY === "true" ? "enabled" : "disabled",
    },
  });
}

// Allow caching for 10s to reduce load under aggressive polling
export const revalidate = 10;
