# HyperQuote Options — Settlement Specification

> **Status:** Draft v0.1
> **Settlement Type:** Physical (European-style, at expiry only)

---

## 1. Settlement Overview

Settlement occurs after the option expiry timestamp. A reference price `S` is obtained from the settlement oracle (see Decisions.md for oracle source). The option's moneyness is determined by comparing `S` to the strike price `K`.

Settlement is **physical**: the ITM counterparty must deliver assets to receive the counter-asset. If the ITM party does not deliver within the settlement window, the option expires as if OTM (collateral returned to seller).

---

## 2. Moneyness Determination

| Strategy | In-The-Money (ITM) | Out-of-The-Money (OTM) |
|----------|---------------------|------------------------|
| **Cash-Secured Put** | `S < K` | `S >= K` |
| **Covered Call** | `S > K` | `S <= K` |

### Edge Case: `S == K` (At-The-Money)

ATM options are treated as **OTM** — no settlement occurs, collateral is returned to the seller. This avoids ambiguity and unnecessary gas costs for zero-value settlements.

---

## 3. Settlement Formulas

### 3.1 Cash-Secured Put (ITM: `S < K`)

The put buyer has the right to sell the underlying at `K`.

**Physical settlement flow:**

```
Put Buyer  delivers:  quantity            of underlying
Put Buyer  receives:  strike × quantity   of collateral (stablecoin)

Put Seller delivers:  strike × quantity   of collateral (from locked collateral)
Put Seller receives:  quantity            of underlying
```

**Intrinsic value (informational):**
```
intrinsic_value = (K - S) × quantity
```

### 3.2 Covered Call (ITM: `S > K`)

The call buyer has the right to buy the underlying at `K`.

**Physical settlement flow:**

```
Call Buyer  delivers:  strike × quantity   of collateral (stablecoin)
Call Buyer  receives:  quantity            of underlying

Call Seller delivers:  quantity            of underlying (from locked collateral)
Call Seller receives:  strike × quantity   of collateral (stablecoin)
```

**Intrinsic value (informational):**
```
intrinsic_value = (S - K) × quantity
```

---

## 4. Settlement Window

After expiry, there is a **settlement window** during which the ITM party must deliver their side:

| Parameter | Value | Notes |
|-----------|-------|-------|
| `SETTLEMENT_WINDOW` | **TBD** (recommended: 24 hours) | See Decisions.md |

- If the ITM party delivers within the window → settlement executes, collateral is exchanged.
- If the ITM party does NOT deliver → option expires worthless, collateral returned to seller.
- After the settlement window closes, anyone can call `expirePosition(positionId)` to release collateral.

---

## 5. Decimal Handling & Rounding

### 5.1 Token Decimals

All arithmetic is performed in the native decimal precision of the respective tokens:

| Token Type | Expected Decimals | Example |
|------------|------------------|---------|
| Underlying (e.g., WHYPE) | 18 | 1e18 = 1 WHYPE |
| Collateral (e.g., USDC) | 6 | 1e6 = 1 USDC |

### 5.2 Strike Price Encoding

Strike prices are encoded as **collateral-denominated fixed-point** values:

```
strike = price × 10^(collateral_decimals)
```

Example: Strike of $25.50 USDC → `strike = 25_500_000` (6 decimals)

### 5.3 Collateral Amount Calculation

For a Cash-Secured Put, required collateral:

```
collateral_required = (strike × quantity) / 10^(underlying_decimals)
```

This cross-decimal multiplication must be handled carefully:

```solidity
// Example: strike = 25_500_000 (6 dec), quantity = 2e18 (18 dec)
// collateral_required = (25_500_000 * 2e18) / 1e18 = 51_000_000 (= 51 USDC)
uint256 collateralRequired = (strike * quantity) / (10 ** underlyingDecimals);
```

### 5.4 Rounding Rules

| Operation | Rounding Direction | Rationale |
|-----------|--------------------|-----------|
| Collateral required from seller | **Round up** (ceiling) | Protect the buyer; ensure full coverage |
| Collateral returned to seller (OTM) | **Exact** (no rounding) | Return exactly what was locked |
| Settlement delivery amounts | **Round down** (floor) | Protect the deliverer; no fractional dust obligations |

Rounding is implemented using:
```solidity
// Ceiling division
function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
    return (a + b - 1) / b;
}
```

### 5.5 Dust Prevention

- Minimum quantity enforced to avoid sub-dust positions.
- Minimum premium enforced (at least 1 unit of collateral token).
- Positions with zero intrinsic value at settlement are treated as OTM.

---

## 6. Edge Cases

### 6.1 `S == K` (At-The-Money)

- Treated as OTM. No settlement occurs.
- Collateral returned to seller.
- Rationale: Physical settlement at S==K has zero economic value but costs gas.

### 6.2 Underlying Price Goes to Zero (`S = 0`)

- **Put:** Maximally ITM. Put buyer delivers worthless underlying, receives full `K × quantity` in stablecoin. This is the intended risk for the put seller.
- **Call:** OTM. Collateral (underlying) returned to call seller — but it is now worthless. Seller bears the price risk they already held.

### 6.3 Oracle Failure / Missing Price

- If the oracle does not publish a settlement price within a grace period after expiry, positions enter a **dispute state**.
- Governance / multisig can manually set the settlement price.
- See ThreatModel.md for oracle failure scenarios.

### 6.4 Token Transfer Failure

- If `transferFrom` fails during settlement (insufficient allowance, paused token), the settlement transaction reverts.
- The settlement window continues — counterparty can retry.
- No penalty for failed attempts (only gas cost).

### 6.5 Overflow Protection

- All multiplication is checked (Solidity 0.8+ default).
- `strike × quantity` may overflow for extreme values — enforced maximum strike and quantity at the contract level.
- Maximum values TBD (see Decisions.md).

---

## 7. Settlement Sequence (On-Chain)

```
1. Caller invokes settle(positionId)
2. Contract checks:
   a. block.timestamp >= position.expiry
   b. block.timestamp <= position.expiry + SETTLEMENT_WINDOW
   c. Position not already settled
   d. Caller is the ITM party (buyer for ITM options)
3. Oracle queried for settlement price S at expiry
4. Moneyness determined (S vs K)
5. If OTM: revert (use expirePosition instead)
6. If ITM:
   a. Transfer delivery asset from caller to contract
   b. Transfer locked collateral to caller
   c. Transfer delivered asset to counterparty
   d. Mark position as SETTLED
7. Emit PositionSettled event
```

---

## 8. Gas Considerations

- Settlement is a multi-transfer transaction (2-3 ERC-20 transfers).
- Estimated gas: ~150k-200k (TBD after implementation).
- Batch settlement is NOT supported in v1 (each position settled individually).
