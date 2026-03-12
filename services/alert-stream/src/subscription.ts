/**
 * Subscription filter logic — determines whether a given internal event
 * should be delivered to a specific alert client.
 *
 * The filter is evaluated server-side. Private RFQ ACL enforcement is
 * MANDATORY and cannot be bypassed by subscription preferences.
 */

import type {
  InternalFeedEvent,
  AlertClient,
  AlertSubscription,
  SubscribeData,
} from "./types.js";

// ---------------------------------------------------------------------------
// Core filter function
// ---------------------------------------------------------------------------

/** Delivery result: true = deliver, false = filtered, "acl_rejected" = private ACL block */
export type DeliveryResult = true | false | "acl_rejected";

/**
 * Determine whether an internal event should be delivered to a client.
 *
 * Returns:
 *   true           — deliver the alert
 *   false          — filtered by subscription preferences
 *   "acl_rejected" — blocked by private RFQ ACL (security enforcement)
 *
 * Security: Private RFQ ACL is enforced REGARDLESS of subscription filters.
 * Even if a client subscribes to visibility="all", they only receive private
 * RFQ events where their wallet is in the allowedMakers list.
 */
export function shouldDeliverEvent(
  event: InternalFeedEvent,
  client: AlertClient
): DeliveryResult {
  // Client must be actively subscribed
  if (!client.subscribed) return false;

  const sub = client.subscription;

  // 1. Event type filter
  //    Map internal event types to alertable types
  const alertType = mapEventType(event.type);
  if (!alertType || !sub.eventTypes.includes(alertType)) {
    return false;
  }

  // 2. Visibility filter
  if (sub.visibility !== "all" && sub.visibility !== event.visibility) {
    return false;
  }

  // 3. Private RFQ ACL — MANDATORY security check
  //    Private RFQs are ONLY delivered to agents whose wallet is in allowedMakers.
  //    This check runs regardless of subscription preferences.
  if (event.visibility === "private") {
    if (!event.allowedMakers || event.allowedMakers.length === 0) {
      return "acl_rejected"; // No allowed makers specified — don't deliver
    }
    const clientWallet = client.wallet.toLowerCase();
    const isAllowed = event.allowedMakers.some(
      (maker) => maker.toLowerCase() === clientWallet
    );
    if (!isAllowed) {
      return "acl_rejected";
    }
  }

  // 4. Token filter (only when tokens array is non-empty)
  if (sub.tokens.length > 0) {
    const subscribedSet = new Set(sub.tokens.map((t) => t.toLowerCase()));

    const tokenInAddr = event.data.tokenIn?.address?.toLowerCase() ?? "";
    const tokenOutAddr = event.data.tokenOut?.address?.toLowerCase() ?? "";

    const tokenInMatch = subscribedSet.has(tokenInAddr);
    const tokenOutMatch = subscribedSet.has(tokenOutAddr);

    if (!tokenInMatch && !tokenOutMatch) {
      return false;
    }

    // 5. Side filter (only applies when token filter is active)
    if (sub.side === "buy" && !tokenOutMatch) {
      // "buy" = agent wants to buy the token (tokenOut matches)
      return false;
    }
    if (sub.side === "sell" && !tokenInMatch) {
      // "sell" = agent wants to sell the token (tokenIn matches)
      return false;
    }
  }

  // 6. minNotionalUsd — deferred (requires price feed integration)
  //    When implemented: compute notional from amount + price, filter by threshold

  return true;
}

// ---------------------------------------------------------------------------
// Event type mapping
// ---------------------------------------------------------------------------

/**
 * Map internal feed event types to alertable event types.
 * Only rfq.created and rfq.filled are alertable; others are filtered out.
 */
function mapEventType(
  type: string
): "rfq.created" | "rfq.filled" | null {
  switch (type) {
    case "rfq.created":
      return "rfq.created";
    case "rfq.filled":
      return "rfq.filled";
    default:
      // rfq.quoted, rfq.cancelled, rfq.expired are not alertable yet
      return null;
  }
}

// ---------------------------------------------------------------------------
// Subscription merge — partial updates
// ---------------------------------------------------------------------------

// Valid enum values for runtime validation
const VALID_VISIBILITY = new Set(["all", "public", "private"]);
const VALID_SIDE = new Set(["all", "buy", "sell"]);
const VALID_EVENT_TYPES = new Set(["rfq.created", "rfq.filled"]);

/**
 * Merge a partial SUBSCRIBE update into an existing subscription.
 * Only provided fields are updated; omitted fields keep their current value.
 * Applies normalization: lowercase + dedupe tokens, dedupe eventTypes,
 * clamp minNotionalUsd, reject invalid enum values.
 */
export function mergeSubscription(
  current: AlertSubscription,
  update: SubscribeData
): AlertSubscription {
  // Tokens: lowercase + dedupe
  let tokens = current.tokens;
  if (update.tokens !== undefined) {
    tokens = [...new Set(update.tokens.map((t) => t.toLowerCase()))];
  }

  // minNotionalUsd: clamp to 0 if invalid
  let minNotionalUsd = current.minNotionalUsd;
  if (update.minNotionalUsd !== undefined) {
    minNotionalUsd = Number.isFinite(update.minNotionalUsd) && update.minNotionalUsd >= 0
      ? update.minNotionalUsd
      : 0;
  }

  // Visibility: validate enum
  let visibility = current.visibility;
  if (update.visibility !== undefined && VALID_VISIBILITY.has(update.visibility)) {
    visibility = update.visibility;
  }

  // Side: validate enum
  let side = current.side;
  if (update.side !== undefined && VALID_SIDE.has(update.side)) {
    side = update.side;
  }

  // EventTypes: validate + dedupe, keep current if result would be empty
  let eventTypes = current.eventTypes;
  if (update.eventTypes !== undefined) {
    const validated = [...new Set(update.eventTypes)].filter((t) =>
      VALID_EVENT_TYPES.has(t)
    ) as AlertSubscription["eventTypes"];
    if (validated.length > 0) {
      eventTypes = validated;
    }
  }

  return { tokens, minNotionalUsd, visibility, side, eventTypes };
}
