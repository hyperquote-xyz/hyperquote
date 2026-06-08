/**
 * Admin authentication for privileged/mutating operational endpoints.
 *
 * Usage in a route handler:
 *   const auth = requireAdmin(request);
 *   if (!auth.ok) return auth.response;
 *
 * Auth model:
 *   - Reads ADMIN_API_KEY from the environment.
 *   - Caller must present it via `x-admin-key: <key>` or
 *     `Authorization: Bearer <key>`.
 *   - Constant-time comparison to avoid timing leaks.
 *   - FAIL CLOSED: if ADMIN_API_KEY is unset in production, every request
 *     is rejected. In non-production it is rejected too, but the error
 *     message explains how to set the key for local admin testing.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export interface AdminAuthResult {
  ok: boolean;
  response: NextResponse;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws if lengths differ — pad to equal length first.
  if (ab.length !== bb.length) {
    // Still do a comparison to keep timing roughly constant.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function extractKey(request: NextRequest): string | null {
  const headerKey = request.headers.get("x-admin-key");
  if (headerKey) return headerKey;

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);

  return null;
}

/**
 * Gate a route behind the admin API key.
 * Returns { ok: true } when authorized; otherwise { ok: false, response } with
 * a 401/500 NextResponse the caller should return directly.
 */
export function requireAdmin(request: NextRequest): AdminAuthResult {
  const expected = process.env.ADMIN_API_KEY;

  // Fail closed: no key configured means no admin access at all.
  if (!expected || expected.length < 16) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Admin access is not configured on this server (ADMIN_API_KEY missing or too short). Operation refused.",
        },
        { status: 503 }
      ),
    };
  }

  const provided = extractKey(request);
  if (!provided) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing admin credentials. Provide 'x-admin-key' or 'Authorization: Bearer <key>'." },
        { status: 401 }
      ),
    };
  }

  if (!constantTimeEqual(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid admin credentials." },
        { status: 401 }
      ),
    };
  }

  return { ok: true, response: NextResponse.json({ ok: true }) };
}
