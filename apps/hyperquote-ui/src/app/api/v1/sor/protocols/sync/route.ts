/**
 * POST /api/v1/sor/protocols/sync
 *
 * Triggers a DefiLlama → protocol_registry sync.
 * Returns detailed sync results including mutations.
 *
 * Optional body params:
 *   { includeVolume?: boolean, dryRun?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { syncProtocolRegistry } from "@/lib/router/defillama";
import { requireAdmin } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    let body: { includeVolume?: boolean; dryRun?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON — use defaults
    }

    console.log("[api/v1/sor/protocols/sync] Starting sync...", {
      includeVolume: body.includeVolume ?? true,
      dryRun: body.dryRun ?? false,
    });

    const result = await syncProtocolRegistry({
      includeVolume: body.includeVolume ?? true,
      dryRun: body.dryRun ?? false,
    });

    const status = result.errors.length > 0 ? 207 : 200;

    return NextResponse.json(result, { status });
  } catch (err) {
    console.error("[api/v1/sor/protocols/sync] Error:", err);
    return NextResponse.json(
      { error: "Sync failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
