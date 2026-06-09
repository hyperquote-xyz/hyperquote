/**
 * Reliable post-fill persistence.
 *
 * After an on-chain fill confirms, three records must be written server-side:
 *   - POST /api/v1/rfqs/[id]/fill   (flips Feed RFQ → FILLED)
 *   - POST /api/v1/fills            (records fill + points)
 *   - POST /api/v1/rfq/performance  (maker performance)
 *
 * In production these endpoints re-verify the tx on the SERVER's RPC. If that
 * node hasn't indexed the tx yet, they return 403. This module retries with
 * exponential backoff until each call succeeds (or a hard deadline), so a
 * propagation lag never loses the Feed status, fill record, or points.
 *
 * Idempotency: the server keys on txHash (unique). A duplicate POST returns
 * 409, which we treat as success. markRfqFilled is idempotent.
 */

export type PersistPhase = "finalizing" | "complete" | "syncing";

export interface PersistFillArgs {
  txHash: string;
  rfqId: string | null;
  taker: string;
  maker: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  visibility?: string;
  /** Called as the reconciliation progresses, for UI state. */
  onPhase?: (phase: PersistPhase) => void;
}

// Retry tuning: ~120s total across exponential backoff.
const MAX_ELAPSED_MS = 120_000;
const BASE_DELAY_MS = 1_500;
const MAX_DELAY_MS = 12_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST with retry. Resolves true on success (200) or duplicate (409).
 * Retries on 403 (not-yet-indexed), 5xx, and network errors until the deadline.
 * Returns false if the deadline passes without success.
 */
async function postWithRetry(
  url: string,
  body: unknown,
  deadline: number
): Promise<boolean> {
  let attempt = 0;
  // Always make at least one attempt.
  for (;;) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) return true;                 // 200 — persisted
      if (res.status === 409) return true;     // duplicate — idempotent success

      // 403 = tx not indexed on server RPC yet; 5xx = transient. Retry.
      // 400/401/404 = permanent client errors — stop.
      if (res.status !== 403 && res.status < 500) {
        console.warn(`[postFill] ${url} permanent failure ${res.status}`);
        return false;
      }
    } catch (err) {
      console.warn(`[postFill] ${url} network error (attempt ${attempt})`, err);
      // fall through to retry
    }

    if (Date.now() >= deadline) {
      console.warn(`[postFill] ${url} gave up after ${attempt} attempts`);
      return false;
    }
    const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
    await sleep(delay);
  }
}

/**
 * Persist all post-fill records reliably. Returns true if the critical Feed
 * status + fill record both persisted; false if reconciliation is still
 * pending (UI should show "records syncing").
 */
export async function persistFillWithRetry(args: PersistFillArgs): Promise<boolean> {
  const deadline = Date.now() + MAX_ELAPSED_MS;
  args.onPhase?.("finalizing");

  // The two critical writes: Feed status + fill record (drives points).
  const feedUrl = args.rfqId ? `/api/v1/rfqs/${args.rfqId}/fill` : null;

  const [feedOk, fillOk] = await Promise.all([
    feedUrl ? postWithRetry(feedUrl, { txHash: args.txHash }, deadline) : Promise.resolve(true),
    postWithRetry(
      "/api/v1/fills",
      {
        txHash: args.txHash,
        rfqId: args.rfqId,
        taker: args.taker,
        maker: args.maker,
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amountIn: args.amountIn,
        amountOut: args.amountOut,
        visibility: args.visibility ?? "public",
      },
      deadline
    ),
  ]);

  // Performance is non-critical (best-effort, same retry budget).
  if (args.rfqId) {
    postWithRetry(
      "/api/v1/rfq/performance",
      { rfqId: args.rfqId, makerId: args.maker, makerAmountOut: args.amountOut, won: true },
      deadline
    ).catch(() => {});
  }

  const ok = feedOk && fillOk;
  args.onPhase?.(ok ? "complete" : "syncing");
  return ok;
}
