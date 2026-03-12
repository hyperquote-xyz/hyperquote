# Relay Protocol

The HyperQuote RFQ Relay is a lightweight WebSocket + REST server that routes RFQ requests from users (potential sellers) to makers (option buyers), and returns signed EIP-712 quotes.

## Architecture

```
User (seller)                    Relay                     Maker (buyer)
     |                            |                            |
     |--- RFQ_SUBMIT ----------->|                            |
     |                            |--- RFQ_BROADCAST -------->|
     |                            |                            |
     |                            |<--- QUOTE_SUBMIT ---------|
     |<-- QUOTE_BROADCAST --------|                            |
     |                            |                            |
     |-- (select best quote) -----|                            |
     |-- OptionsEngine.execute() -|                            |
```

## Connection

- **WebSocket**: `ws://127.0.0.1:8080` (default)
- **REST**: `http://127.0.0.1:8080` (same port)

## WebSocket Message Types

All messages are JSON with `{ type, data }` envelope.

### RFQ_SUBMIT

Sent by the user to submit a new RFQ. Requires EIP-191 signature.

```json
{
  "type": "RFQ_SUBMIT",
  "data": {
    "rfq": {
      "requester": "0x...",
      "underlying": "0x...",
      "collateral": "0x...",
      "isCall": false,
      "strike": "0x15af1d78b58c40000",
      "quantity": "0xde0b6b3a7640000",
      "expiry": "0x6555e900",
      "minPremium": "0x0",
      "timestamp": "0x65556000"
    },
    "userSig": "0x..."
  }
}
```

**Signature**: The user signs `keccak256(abi.encode(rfq fields))` using EIP-191 `personal_sign`. The relay verifies the signer matches `rfq.requester`.

### RFQ_BROADCAST

Broadcast to all connected clients when a valid RFQ is accepted.

```json
{
  "type": "RFQ_BROADCAST",
  "data": {
    "rfqId": "0x...",
    "rfq": { ... }
  }
}
```

### QUOTE_SUBMIT

Sent by a maker to submit a signed EIP-712 quote for an RFQ.

```json
{
  "type": "QUOTE_SUBMIT",
  "data": {
    "rfqId": "0x...",
    "quote": {
      "maker": "0x...",
      "taker": "0x0000000000000000000000000000000000000000",
      "underlying": "0x...",
      "collateral": "0x...",
      "isCall": false,
      "isMakerSeller": false,
      "strike": "0x...",
      "quantity": "0x...",
      "premium": "0x...",
      "expiry": "0x...",
      "deadline": "0x...",
      "nonce": "0x..."
    },
    "makerSig": "0x..."
  }
}
```

### QUOTE_BROADCAST

Broadcast to all clients when a quote is submitted.

```json
{
  "type": "QUOTE_BROADCAST",
  "data": {
    "rfqId": "0x...",
    "quote": { ... },
    "makerSig": "0x..."
  }
}
```

### PING / PONG

Keepalive. Client sends `PING`, server responds `PONG`.

### ERROR

```json
{
  "type": "ERROR",
  "data": { "message": "Rate limit exceeded" }
}
```

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/rfqs` | List active (non-expired) RFQs |
| `GET` | `/quotes?rfqId=0x...` | List quotes for a specific RFQ |
| `GET` | `/health` | Server health / stats |

## RFQ ID (Deterministic)

```
rfqId = keccak256(abi.encode(
  requester, underlying, collateral, isCall,
  strike, quantity, expiry, minPremium, timestamp
))
```

The same rfqId computation is used by both the relay and the SDK.

## Rate Limiting

- **Per-IP**: 30 messages per minute (configurable via `RATE_LIMIT_PER_MIN`)
- Exceeding the limit returns an `ERROR` message

## RFQ TTL

- Default: 60 seconds (configurable via `RFQ_TTL_SECS`)
- Expired RFQs are automatically cleaned up
- Quotes for expired RFQs are rejected

## Signing Requirements

| Message | Signing Method | Signer |
|---------|---------------|--------|
| RFQ_SUBMIT | EIP-191 `personal_sign` of rfqId bytes | `rfq.requester` |
| QUOTE_SUBMIT | EIP-712 typed data (Quote struct) | `quote.maker` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | `8080` | Server port |
| `RFQ_TTL_SECS` | `60` | RFQ time-to-live |
| `RATE_LIMIT_PER_MIN` | `30` | Max messages per IP per minute |
