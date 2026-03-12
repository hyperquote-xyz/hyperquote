# Alert Stream — Test Matrix

## How to run

1. Start Next.js: `npm run dev:ui` (port 3000)
2. Set env: `INTERNAL_EVENT_SECRET=test-secret-64-chars...` in both `.env.local` and `services/alert-stream/.env`
3. Start alert-stream: `npm run dev:alert-stream` (port 8090)
4. Connect a WebSocket client (wscat, websocat, or Node script) to `ws://localhost:8090`

---

## 1. Core delivery scenarios

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 1.1 | Public rfq.created | Agent subscribed, eventTypes includes rfq.created | Create public RFQ via UI/API | Agent receives ALERT with eventType=rfq.created, visibility=public |
| 1.2 | Public rfq.filled | Agent subscribed, eventTypes includes rfq.filled | Fill a public RFQ | Agent receives ALERT with eventType=rfq.filled, visibility=public, fill.txHash present |
| 1.3 | Private rfq.created (allowed) | Agent wallet in allowedMakers | Create private RFQ with agent in allowedMakers | Agent receives ALERT with visibility=private |
| 1.4 | Private rfq.created (denied) | Agent wallet NOT in allowedMakers | Create private RFQ with different allowedMakers | Agent does NOT receive alert. /debug/stats shows aclRejections++ |
| 1.5 | Private rfq.filled (allowed) | Agent wallet in allowedMakers | Fill a private RFQ | Agent receives ALERT |
| 1.6 | Private rfq.filled (denied) | Agent wallet NOT in allowedMakers | Fill a private RFQ | Agent does NOT receive alert |
| 1.7 | Private RFQ, empty allowedMakers | allowedMakers=[] | Create private RFQ | No agent receives alert (ACL returns acl_rejected) |

## 2. Token filters

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 2.1 | Token match (tokenIn) | Agent subscribes tokens=[USDC_ADDR] | RFQ with tokenIn=USDC | Delivered |
| 2.2 | Token match (tokenOut) | Agent subscribes tokens=[HYPE_ADDR] | RFQ with tokenOut=HYPE | Delivered |
| 2.3 | Token mismatch | Agent subscribes tokens=[USDC_ADDR] | RFQ with tokenIn=PURR, tokenOut=HYPE | NOT delivered |
| 2.4 | Empty tokens (wildcard) | Agent subscribes tokens=[] | Any RFQ | Delivered |
| 2.5 | Case insensitive | Agent sends tokens with mixed case | RFQ with lowercase addr | Delivered (normalized to lowercase) |
| 2.6 | Duplicate tokens deduped | PUT prefs with ["0xabc...", "0xABC..."] | — | Stored as single entry ["0xabc..."] |

## 3. Side filters

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 3.1 | side=buy, tokenOut match | tokens=[HYPE], side=buy | RFQ tokenOut=HYPE | Delivered |
| 3.2 | side=buy, only tokenIn match | tokens=[HYPE], side=buy | RFQ tokenIn=HYPE, tokenOut=USDC | NOT delivered (buy=tokenOut) |
| 3.3 | side=sell, tokenIn match | tokens=[HYPE], side=sell | RFQ tokenIn=HYPE | Delivered |
| 3.4 | side=sell, only tokenOut match | tokens=[HYPE], side=sell | RFQ tokenOut=HYPE, tokenIn=USDC | NOT delivered |
| 3.5 | side=all, either match | tokens=[HYPE], side=all | RFQ tokenIn=HYPE | Delivered |
| 3.6 | side ignored when tokens empty | side=buy, tokens=[] | Any RFQ | Delivered (side only applies with token filter) |

## 4. Visibility filters

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 4.1 | visibility=all | Subscribe visibility=all | Public RFQ | Delivered |
| 4.2 | visibility=all | Subscribe visibility=all | Private RFQ (agent in ACL) | Delivered |
| 4.3 | visibility=public | Subscribe visibility=public | Public RFQ | Delivered |
| 4.4 | visibility=public | Subscribe visibility=public | Private RFQ (agent in ACL) | NOT delivered (visibility filter) |
| 4.5 | visibility=private | Subscribe visibility=private | Public RFQ | NOT delivered |
| 4.6 | visibility=private | Subscribe visibility=private | Private RFQ (agent in ACL) | Delivered |

## 5. Event type filters

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 5.1 | Only rfq.created | eventTypes=[rfq.created] | Create RFQ | Delivered |
| 5.2 | Only rfq.created | eventTypes=[rfq.created] | Fill RFQ | NOT delivered |
| 5.3 | Only rfq.filled | eventTypes=[rfq.filled] | Create RFQ | NOT delivered |
| 5.4 | Both | eventTypes=[rfq.created, rfq.filled] | Create or fill | Delivered |

## 6. Disabled preferences

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 6.1 | UNSUBSCRIBE sent | Agent sends UNSUBSCRIBE | Create RFQ | NOT delivered (subscribed=false) |
| 6.2 | Re-SUBSCRIBE | UNSUBSCRIBE then SUBSCRIBE | Create RFQ | Delivered |

## 7. minNotionalUsd (deferred)

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 7.1 | minNotionalUsd=0 (default) | Default | Any RFQ | Delivered (filter not enforced yet) |
| 7.2 | minNotionalUsd=10000 | Set high threshold | Small RFQ | Delivered (filter not enforced yet — deferred) |

## 8. ACL enforcement (security-critical)

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 8.1 | Private, wallet matches | Agent wallet = allowedMakers[0] | Private rfq.created | Delivered |
| 8.2 | Private, wallet mismatch | Agent wallet != any allowedMakers | Private rfq.created | NOT delivered, aclRejections++ |
| 8.3 | Private, empty allowedMakers | allowedMakers=[] | Private rfq.created | NOT delivered |
| 8.4 | ACL case insensitive | Agent wallet=0xABC..., allowedMakers=["0xabc..."] | Private RFQ | Delivered (both lowercased) |
| 8.5 | ACL overrides subscription | Agent subscribes visibility=all | Private RFQ, wallet not in ACL | NOT delivered |
| 8.6 | allowedMakers not leaked | Agent receives private alert | Inspect ALERT payload | allowedMakers field is NOT in payload |

## 9. WebSocket connection behavior

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 9.1 | Auth timeout | Connect, don't send AUTHENTICATE | Wait 10s | Server sends AUTH_TIMEOUT error, closes with 4003 |
| 9.2 | Invalid token | Send AUTHENTICATE with bad token | — | AUTH_FAILED error, closed with 4001 |
| 9.3 | Max connections | Open 5 connections for same agent | Open 6th | MAX_CONNECTIONS error, closed with 4002 |
| 9.4 | Stale disconnect | Connect, authenticate, stop responding to pings | Wait 90s | Server disconnects with 4004 |
| 9.5 | Double auth | Send AUTHENTICATE twice | — | Error: "Already authenticated" |
| 9.6 | Message before auth | Send SUBSCRIBE before AUTHENTICATE | — | AUTH_REQUIRED error |

## 10. SSE reconnect behavior

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 10.1 | Clean reconnect | Alert-stream running | Restart Next.js dev server | SSE reconnects with exponential backoff, resumes delivering events |
| 10.2 | Backoff capped | SSE down for extended period | — | Reconnect delay caps at 30s |
| 10.3 | Reconnect counter | Multiple reconnects | GET /debug/stats | eventSource.reconnects reflects count |

## 11. Preference normalization (REST)

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 11.1 | Token dedupe | tokens: ["0xABC...", "0xabc..."] | Stored as ["0xabc..."] |
| 11.2 | EventType dedupe | eventTypes: ["rfq.created", "rfq.created"] | Stored as ["rfq.created"] |
| 11.3 | NaN minNotional | minNotionalUsd: NaN | 400: "must be a finite non-negative number" |
| 11.4 | Infinity minNotional | minNotionalUsd: Infinity | 400: "must be a finite non-negative number" |
| 11.5 | Negative minNotional | minNotionalUsd: -5 | 400 error |
| 11.6 | Empty eventTypes | eventTypes: [] | 400: "must be a non-empty array" |
| 11.7 | Invalid visibility | visibility: "secret" | 400 error |
| 11.8 | Token cap exceeded | tokens: [51 addresses] | 400: "exceeds maximum of 50" |
| 11.9 | Empty body | {} | Upserts with defaults |

## 12. Non-alertable events (rfq.quoted boundary)

| # | Scenario | Setup | Trigger | Expected |
|---|----------|-------|---------|----------|
| 12.1 | rfq.quoted dropped | Agent connected | Submit quote on RFQ | Agent does NOT receive any alert. /debug/stats events.dropped++ |
| 12.2 | rfq.cancelled dropped | Agent connected | Cancel RFQ | NOT delivered |
| 12.3 | rfq.expired dropped | Agent connected | Wait for RFQ expiry | NOT delivered |
