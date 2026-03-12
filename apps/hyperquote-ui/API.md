# HyperQuote Maker API

REST + SSE endpoints for market makers to discover RFQs and submit quotes.

Base URL: `http://localhost:3000` (dev)

---

## Endpoints

### 1. `GET /api/rfq/stream` — Live RFQ Feed (SSE)

Server-Sent Events stream of all public RFQ activity.

**On connect:** receives a `snapshot` event with every active public RFQ.
**Live:** receives `rfq` events (new requests) and `quote` events (new quotes).

**Event format:**

```
data: {"type":"snapshot","data":[...RFQRequestJSON[]]}

data: {"type":"rfq","data":{...RFQRequestJSON}}

data: {"type":"quote","rfqId":"...","data":{...RFQQuoteJSON}}
```

Keep-alive comments (`: keep-alive`) are sent every 15 seconds.

**curl:**

```bash
curl -N http://localhost:3000/api/rfq/stream
```

---

### 2. `GET /api/rfq/detail/:id` — RFQ Detail

Retrieve a single RFQ by its request ID, including all submitted quotes.

| Param   | Location | Required | Description                           |
|---------|----------|----------|---------------------------------------|
| `id`    | path     | yes      | The RFQ request ID (UUID)             |
| `token` | query    | private  | Share token (required for private RFQs) |

**Response** `200`:

```json
{
  "rfq": { ...RFQRequestJSON },
  "quotes": [ ...RFQQuoteJSON[] ]
}
```

**Response** `404`:

```json
{ "error": "Not found, expired, or access denied" }
```

**curl (public RFQ):**

```bash
curl http://localhost:3000/api/rfq/detail/SOME-RFQ-ID
```

**curl (private RFQ):**

```bash
curl "http://localhost:3000/api/rfq/detail/SOME-RFQ-ID?token=SHARE-TOKEN"
```

---

### 3. `POST /api/rfq/quote` — Submit Quote

Submit a signed quote for an active RFQ.

**Request body:**

```json
{
  "rfqId": "string — the RFQ request ID",
  "quote": {
    "kind": 0,
    "maker": "0xYourAddress",
    "taker": "0xTakerAddress",
    "tokenIn": "0xTokenInAddress",
    "tokenOut": "0xTokenOutAddress",
    "amountIn": "1000000",
    "amountOut": "950000",
    "expiry": 1718900000,
    "nonce": "42",
    "requestId": "same-as-rfqId",
    "signature": "0x...",
    "createdAt": 1718899000
  },
  "token": "optional — share token for private RFQs"
}
```

**Response** `200`:

```json
{ "accepted": true }
```

**Response** `400`:

```json
{ "accepted": false, "reason": "RFQ not found" }
```

Possible reasons: `RFQ not found`, `RFQ expired`, `Invalid share token for private RFQ`, `Quote requestId does not match`, `Signature missing or malformed`, `Invalid maker address`, `Maximum quotes for this RFQ reached`.

**curl:**

```bash
curl -X POST http://localhost:3000/api/rfq/quote \
  -H "Content-Type: application/json" \
  -d '{
    "rfqId": "SOME-RFQ-ID",
    "quote": {
      "kind": 0,
      "maker": "0xYourMakerAddress________________",
      "taker": "0xTakerAddress___________________",
      "tokenIn": "0xTokenIn________________________",
      "tokenOut": "0xTokenOut_______________________",
      "amountIn": "1000000000000000000",
      "amountOut": "950000000",
      "expiry": 1718900000,
      "nonce": "1",
      "requestId": "SOME-RFQ-ID",
      "signature": "0xYourECDSASignature...",
      "createdAt": 1718899000
    }
  }'
```

---

### 4. `POST /api/rfq` — Register RFQ (Taker)

Register a new RFQ with server-side rate limiting and per-wallet active limits.

**Limits:**
- 3 active public RFQs per wallet
- 5 active private RFQs per wallet
- 10 requests per minute per IP+wallet

**Request body:**

```json
{
  "wallet": "0xTakerAddress",
  "visibility": "public",
  "expiry": 1718900000,
  "rfqData": { ...RFQRequestJSON }
}
```

**Response** `200`:

```json
{
  "allowed": true,
  "shareToken": "uuid-share-token",
  "activeCount": { "public": 1, "private": 0 }
}
```

**Response** `429`:

```json
{
  "allowed": false,
  "reason": "Maximum 3 active public RFQs reached.",
  "activeCount": { "public": 3, "private": 0 }
}
```

---

### 5. `GET /api/rfq?wallet=0x...` — Active Count

Returns current active RFQ count for a wallet.

**Response** `200`:

```json
{ "public": 2, "private": 1 }
```

---

### 6. `GET /api/rfq/:shareToken` — Private RFQ Lookup

Retrieve a private RFQ by its share token (returned from registration).

**Response** `200`: `RFQRequestJSON`
**Response** `404`: `{ "error": "RFQ not found or expired" }`

---

## JSON Schemas

### RFQRequestJSON

```typescript
{
  id: string;            // UUID
  kind: 0 | 1;           // 0 = EXACT_IN, 1 = EXACT_OUT
  taker: string;         // 0x address
  tokenIn: Token;        // { address, symbol, name, decimals, ... }
  tokenOut: Token;
  amountIn?: string;     // bigint as string (set for EXACT_IN)
  amountOut?: string;    // bigint as string (set for EXACT_OUT)
  minOut?: string;       // minimum acceptable output
  maxIn?: string;        // maximum acceptable input
  expiry: number;        // unix seconds
  createdAt: number;     // unix seconds
  visibility: "public" | "private";
  allowedMakers?: string[];
}
```

### RFQQuoteJSON

```typescript
{
  kind: 0 | 1;           // must match request kind
  maker: string;         // 0x maker address
  taker: string;         // 0x taker address (or 0x0 for open)
  tokenIn: string;       // 0x token address
  tokenOut: string;      // 0x token address
  amountIn: string;      // bigint as string
  amountOut: string;     // bigint as string
  expiry: number;        // unix seconds
  nonce: string;         // maker's on-chain nonce as string
  requestId: string;     // must match the RFQ id
  signature: string;     // 0x ECDSA signature (raw hash, not EIP-712)
  createdAt: number;     // unix seconds
}
```

### Token

```typescript
{
  address: string;       // 0x address
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}
```

---

## Signing Protocol

Quotes are signed over the **raw hash** returned by the smart contract's `getQuoteHash()` function (not EIP-712).

```
hash = contract.getQuoteHash(quoteStruct)
signature = wallet.signMessage({ raw: hash })
```

Signature verification happens taker-side before filling on-chain.

---

## Maker Console

A built-in Maker Console is available at `/console` for testing:

- Connects to the SSE feed and displays live public RFQs
- Allows fetching RFQ details by ID
- Provides a form to submit quote JSON directly
