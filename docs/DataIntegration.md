# HyperQuote Options — Data Integration Plan

> **Status:** Draft v0.1
> **Purpose:** How the protocol and UI will ingest external pricing data from Derive and Hyperliquid

---

## 1. Overview

The HyperQuote Options UI needs two categories of external data:

1. **Options market data** — for pricing guidance, IV surfaces, and quote generation.
2. **Spot/perp market data** — for settlement reference prices and real-time underlier pricing.

Neither data source is required on-chain for quote creation (quotes are signed off-chain). The settlement oracle is the only on-chain data dependency.

---

## 2. Data Sources

### 2.1 Derive (formerly Lyra v2)

**Purpose:** Options-specific market data for pricing guidance.

**Data Points:**
| Field | Use Case |
|-------|----------|
| Implied Volatility (IV) surface | Suggest fair premium for RFQs |
| Option chain (strikes/expiries) | Populate recommended rails |
| Mark price per option | Reference pricing for makers |
| Open interest by strike/expiry | Liquidity indicators |
| Greeks (delta, gamma, theta, vega) | Risk display in UI |

**Integration Method:**
- REST API polling (initial implementation).
- WebSocket subscription for real-time IV updates (future).
- Data is consumed by the **frontend only** — not on-chain.

**API Endpoints (expected):**
```
GET /public/get_instruments?currency=ETH&kind=option
GET /public/get_order_book?instrument_name=ETH-20240628-3500-C
GET /public/ticker?instrument_name=ETH-20240628-3500-C
```

**Caveats:**
- Derive operates on Arbitrum/Optimism — prices reflect a different venue's liquidity.
- IV from Derive may not perfectly match HyperEVM market conditions.
- Use as **indicative guidance only**, not as a settlement source.
- Rate limits apply — cache aggressively (30s TTL for IV, 5s for tickers).

---

### 2.2 Hyperliquid

**Purpose:** Spot/perpetual prices for settlement and real-time underlying pricing.

**Data Points:**
| Field | Use Case |
|-------|----------|
| Mark price (perps) | Settlement reference price (primary candidate) |
| Index price | Alternative settlement reference |
| Spot price | UI display, premium calculation |
| Funding rate | Informational (basis between spot/perp) |
| Order book depth | Liquidity assessment for underlying |

**Integration Method:**

**A. Off-chain (UI / backend):**
- Hyperliquid INFO API (REST):
  ```
  POST https://api.hyperliquid.xyz/info
  { "type": "metaAndAssetCtxs" }      // All asset metadata + current prices
  { "type": "l2Book", "coin": "HYPE" } // Order book snapshot
  ```
- WebSocket for real-time price streaming:
  ```
  wss://api.hyperliquid.xyz/ws
  { "method": "subscribe", "subscription": { "type": "allMids" } }
  ```

**B. On-chain (Settlement Oracle):**
- **Option 1 — Precompile (preferred):** If HyperEVM exposes a system precompile for reading Hyperliquid L1 mark prices, the settlement oracle can read prices trustlessly on-chain.
  - Status: **Unconfirmed** — awaiting HyperEVM precompile documentation.
  - This is the ideal path: no external oracle trust assumption.

- **Option 2 — Oracle relayer:** A trusted relayer posts Hyperliquid mark prices on-chain at expiry.
  - Requires signed attestation from the relayer.
  - Introduces a trust assumption (the relayer is honest).
  - Can be decentralized with multi-sig or threshold signing.

- **Option 3 — Pyth/Chainlink on HyperEVM:** Use an existing oracle network if deployed on HyperEVM.
  - Less precise for Hyperliquid-specific assets.
  - May not support all assets listed on Hyperliquid.

See **Decisions.md** for the oracle source decision.

---

## 3. Data Flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (UI)                       │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │  Derive API  │    │ Hyperliquid  │                   │
│  │  (IV, Greeks │    │  INFO API    │                   │
│  │   options)   │    │  (spot, mark │                   │
│  │              │    │   prices)    │                   │
│  └──────┬───────┘    └──────┬───────┘                   │
│         │                   │                            │
│         ▼                   ▼                            │
│  ┌─────────────────────────────────────┐                │
│  │       Pricing Engine (off-chain)    │                │
│  │  - Black-Scholes / binomial         │                │
│  │  - IV interpolation                 │                │
│  │  - Suggested premium calculation    │                │
│  └──────────────┬──────────────────────┘                │
│                 │                                        │
│                 ▼                                        │
│  ┌─────────────────────────────────────┐                │
│  │       RFQ Builder + EIP-712 Signer  │                │
│  └──────────────┬──────────────────────┘                │
│                 │                                        │
└─────────────────┼────────────────────────────────────────┘
                  │  (signed quote)
                  ▼
┌─────────────────────────────────────────────────────────┐
│              HyperEVM Smart Contracts                    │
│                                                          │
│  ┌──────────────┐    ┌──────────────────┐               │
│  │QuoteVerifier │    │ SettlementOracle │               │
│  │(EIP-712 sig  │    │ (reads price at  │               │
│  │ verification)│    │  expiry for      │               │
│  │              │    │  settlement)     │               │
│  └──────────────┘    └──────────────────┘               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Pricing Engine (Off-Chain)

The frontend pricing engine uses Derive IV data + Hyperliquid spot to suggest fair premiums:

### 4.1 Black-Scholes Inputs

| Input | Source |
|-------|--------|
| Spot price (`S`) | Hyperliquid mark/index price |
| Strike price (`K`) | User-selected or rail-suggested |
| Time to expiry (`T`) | Computed from current time to expiry |
| Risk-free rate (`r`) | Hardcoded or fetched (negligible for short-dated) |
| Implied volatility (`σ`) | Derive IV surface, interpolated to strike/expiry |

### 4.2 Implementation Notes

- Use a TypeScript Black-Scholes library in the frontend.
- IV interpolation: linear between available Derive strikes, flat extrapolation beyond.
- Greeks computed client-side for display.
- All pricing is **suggestive** — makers set their own premiums.

---

## 5. Caching & Refresh Strategy

| Data | Cache TTL | Refresh Method |
|------|-----------|----------------|
| Derive IV surface | 30 seconds | Polling |
| Derive option chain | 5 minutes | Polling |
| Hyperliquid mark price | Real-time | WebSocket |
| Hyperliquid order book | 5 seconds | Polling or WS |
| Settlement price (on-chain) | Immutable once set | Event listener |

---

## 6. Error Handling

| Failure | Behavior |
|---------|----------|
| Derive API down | UI shows "IV data unavailable" — makers can still set custom premiums |
| Hyperliquid API down | UI shows last known price with staleness warning |
| Oracle price missing at expiry | Settlement enters dispute state (see ThreatModel.md) |
| Rate limit hit | Exponential backoff, show cached data |

---

## 7. Future Enhancements

- **Streaming IV:** WebSocket connection to Derive for real-time IV updates.
- **Historical volatility:** Compute realized vol from Hyperliquid price history as an alternative to Derive IV.
- **Multi-asset support:** Extend data pipelines for all Hyperliquid-listed assets.
- **Basis tracking:** Monitor spot-perp basis to inform put/call skew adjustments.
- **Maker SDK:** Provide a TypeScript SDK for market makers to consume pricing data and auto-generate quotes.
