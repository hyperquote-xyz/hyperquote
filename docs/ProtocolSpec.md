# HyperQuote Options — Protocol Specification

> **Status:** Draft v0.1 — Pre-implementation scaffold
> **Scope:** Cash-Secured Put (CSP) + Covered Call (CC) only
> **Settlement:** Physical settlement at expiry on HyperEVM

---

## 1. Overview

HyperQuote Options is a decentralized Request-for-Quote (RFQ) engine deployed on HyperEVM. It enables two counterparties to negotiate, sign, and settle vanilla options (CSP and CC) using EIP-712 structured quotes.

The protocol does **not** use an AMM or on-chain order book. Instead, quotes are created off-chain, signed by the maker (market maker), and executed on-chain by the taker when both sides agree on terms.

### Core Flow

```
Taker creates RFQ → Makers respond with signed EIP-712 quotes →
Taker selects & executes on-chain → Collateral locked →
At expiry: settlement oracle publishes reference price →
Position settled physically (underlying or stablecoin transferred)
```

---

## 2. Supported Strategies

### 2.1 Cash-Secured Put (CSP)

| Role | Obligation |
|------|-----------|
| **Seller (maker)** | Locks `strike × quantity` in stablecoin collateral. Obligated to buy the underlying at the strike price if exercised. |
| **Buyer (taker)** | Pays premium upfront. Has the right to sell the underlying at the strike price at expiry. |

**Settlement (ITM when `S < K`):**
- Buyer delivers `quantity` of underlying → receives `strike × quantity` in stablecoin.
- If buyer does not deliver, the option expires worthless (no penalty — physical settlement requires delivery).

### 2.2 Covered Call (CC)

| Role | Obligation |
|------|-----------|
| **Seller (maker)** | Locks `quantity` of the underlying asset as collateral. Obligated to sell at strike if exercised. |
| **Buyer (taker)** | Pays premium upfront. Has the right to buy the underlying at the strike price at expiry. |

**Settlement (ITM when `S > K`):**
- Buyer delivers `strike × quantity` in stablecoin → receives `quantity` of underlying.
- If buyer does not deliver, the option expires worthless.

---

## 3. RFQ Lifecycle

### 3.1 Quote Structure (EIP-712)

```
Quote {
    address maker;          // Market maker address
    address taker;          // Can be address(0) for open quotes
    address underlying;     // ERC-20 token address (e.g., WHYPE)
    address collateral;     // Stablecoin address (e.g., USDC)
    bool    isCall;         // true = Covered Call, false = Cash-Secured Put
    bool    isMakerSeller;  // true = maker is the option seller
    uint256 strike;         // Strike price (collateral decimals, scaled)
    uint256 quantity;       // Amount of underlying (underlying decimals)
    uint256 premium;        // Premium in collateral token
    uint256 expiry;         // Option expiry timestamp
    uint256 deadline;       // Quote validity deadline (timestamp)
    uint256 nonce;          // Maker nonce for replay protection
}
```

### 3.2 Lifecycle States

```
OPEN → EXECUTED → { SETTLED | EXPIRED }
                      ↑
               (at expiry block)
```

1. **OPEN**: Maker signs an EIP-712 quote off-chain. Quote is valid until `deadline`.
2. **EXECUTED**: Taker calls `execute(quote, signature)` on-chain.
   - Premium transferred from buyer → seller immediately.
   - Collateral locked from seller into the contract.
   - Position NFT minted or position record created.
3. **SETTLED**: After expiry, if ITM, the counterparty with delivery obligation calls `settle(positionId)`.
   - Underlying/stablecoin exchanged per settlement rules.
4. **EXPIRED**: If OTM at expiry, or if ITM but no delivery within the settlement window, collateral is returned to seller.

### 3.3 Nonce Management

- Each maker maintains an on-chain nonce counter.
- Quotes can be cancelled by incrementing the nonce or by explicit hash cancellation.
- Bulk cancellation supported via nonce increment.

---

## 4. Expiry Rails & Templates

While custom strike/expiry is allowed, the UI recommends standardized rails:

| Template | Description |
|----------|-------------|
| **EOM** | End of current month, 08:00 UTC |
| **Next Month** | End of next month, 08:00 UTC |
| **+2 Months** | End of month + 2, 08:00 UTC |
| **Weekly** | Next Friday, 08:00 UTC |

Strike price suggestions are generated from current spot ± standard deviations (e.g., ATM, ±5%, ±10%, ±20%).

Custom strikes and expiries are accepted but flagged in the UI if they fall outside recommended ranges.

---

## 5. Collateral Rules

### 5.1 Cash-Secured Put

- Seller must lock: `strike × quantity` (denominated in collateral token).
- Full collateral required — no partial collateralization.

### 5.2 Covered Call

- Seller must lock: `quantity` of underlying asset.
- Full collateral required — no partial collateralization.

### 5.3 Collateral Release

- **OTM at expiry:** Collateral returned to seller after the settlement window closes.
- **ITM at expiry:** Collateral distributed per settlement logic (see Settlement.md).
- **No early withdrawal.** Collateral is locked until expiry + settlement window.

---

## 6. Premium Payment

- Premium is transferred **immediately** upon execution (`execute()`).
- Premium flows: buyer → seller (always).
- Premium denomination: collateral token (stablecoin).
- No escrow on premium — it is a direct transfer.

---

## 7. EIP-712 Domain

```
EIP712Domain {
    name:              "HyperQuote Options"
    version:           "1"
    chainId:           <HyperEVM chain ID>
    verifyingContract:  <QuoteVerifier contract address>
}
```

---

## 8. Access Control

- **Permissionless**: Any address can be a maker or taker.
- **No whitelist** by default (see Decisions.md for gating discussion).
- Contract owner can pause the protocol in emergency.
- No admin key can access locked collateral.

---

## 9. Key Invariants

1. Collateral is **always** fully locked before a position is live.
2. Premium is **always** transferred atomically with execution.
3. A quote can only be executed **once** (quote hash → used).
4. Settlement can only occur **after** expiry timestamp.
5. Collateral can only be released **after** expiry + settlement window.
6. No position can be settled twice.

---

## 10. Out of Scope (v1)

- American-style early exercise
- Spreads, straddles, or multi-leg strategies
- Partial fills
- On-chain order book or AMM
- Margin / partial collateralization
- Automated exercise
