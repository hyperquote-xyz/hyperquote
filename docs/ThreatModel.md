# HyperQuote Options — Threat Model

> **Status:** Draft v0.1
> **Scope:** Pre-implementation threat analysis

---

## 1. Threat Categories

| # | Category | Severity | Likelihood |
|---|----------|----------|------------|
| T1 | Oracle Manipulation | Critical | Medium |
| T2 | Signature Replay | Critical | High (if unmitigated) |
| T3 | Reentrancy | High | Low (with guards) |
| T4 | Price Manipulation (Spot) | High | Medium |
| T5 | Griefing / DoS | Medium | High |
| T6 | Front-running | Medium | Medium |
| T7 | Collateral Token Risk | Medium | Low |
| T8 | Timestamp Manipulation | Medium | Low |
| T9 | Flash Loan Attacks | High | Medium |

---

## 2. Detailed Threat Analysis

### T1: Oracle Manipulation

**Description:** The settlement oracle provides the reference price `S` used to determine moneyness. If the oracle is compromised or manipulated, settlement outcomes are incorrect.

**Attack Vectors:**
- Compromised oracle private key signs false prices.
- Oracle reads from a manipulable on-chain source (e.g., low-liquidity DEX pool).
- Delayed oracle update allows stale price to be used.
- Oracle front-running: attacker sees oracle update in mempool and settles before honest price lands.

**Mitigations:**
- Use Hyperliquid's native price feed if available via precompile (most manipulation-resistant).
- Require multiple oracle sources / median price.
- Enforce a minimum delay between oracle update and settlement availability.
- Oracle price must be timestamped within a tight window of expiry.
- Consider commit-reveal for settlement price publication.

**Residual Risk:** Oracle trust is the single largest trust assumption. See Decisions.md for oracle source selection.

---

### T2: Signature Replay

**Description:** A signed EIP-712 quote could be replayed on a different chain, replayed after cancellation, or reused after execution.

**Attack Vectors:**
- Cross-chain replay: same quote executed on a fork or different chain.
- Re-execution: attempting to execute an already-used quote.
- Cancelled quote replay: executing a quote after maker cancellation.

**Mitigations:**
- EIP-712 domain includes `chainId` and `verifyingContract` → prevents cross-chain replay.
- Quote hash stored on execution → `require(!usedQuotes[hash])`.
- Nonce-based cancellation: maker increments nonce, invalidating all prior quotes with lower nonce.
- Explicit quote cancellation: `cancelQuote(quoteHash)`.
- `deadline` field ensures quotes expire off-chain.

**Residual Risk:** Low after mitigations. Maker must manage nonces correctly.

---

### T3: Reentrancy

**Description:** ERC-20 `transfer`/`transferFrom` calls during execution or settlement could re-enter the contract.

**Attack Vectors:**
- Malicious ERC-20 token with callback hooks (e.g., ERC-777 `tokensReceived`).
- Reentering `execute()` or `settle()` mid-transfer.

**Mitigations:**
- Use `ReentrancyGuard` (OpenZeppelin) on all state-changing functions.
- Follow checks-effects-interactions pattern: update state before external calls.
- Consider token whitelist to exclude tokens with transfer hooks.

**Residual Risk:** Very low with ReentrancyGuard + CEI pattern.

---

### T4: Price Manipulation (Spot Market)

**Description:** Attacker manipulates the spot price on Hyperliquid or other venues near expiry to force favorable settlement.

**Attack Vectors:**
- Large market orders just before the expiry snapshot to move the reference price.
- Wash trading to create artificial price levels.
- Cross-venue arbitrage exploitation if oracle uses a single source.

**Mitigations:**
- Use TWAP (Time-Weighted Average Price) over a window rather than a single snapshot.
- Use Hyperliquid mark price (which already incorporates anti-manipulation).
- Define the settlement price as the mark price at a specific block/timestamp, not a spot trade.
- Minimum position sizes to make manipulation economics unfavorable.

**Residual Risk:** Medium. TWAP reduces but does not eliminate manipulation on low-liquidity assets.

---

### T5: Griefing / DoS

**Description:** Attacker wastes counterparty gas or locks capital without genuine intent to trade.

**Attack Vectors:**
- **Quote spam:** Maker signs thousands of quotes they never intend to honor, wasting taker gas on reverted executions.
- **Dust positions:** Creating many tiny positions to bloat storage.
- **Settlement griefing:** Deliberately failing to deliver on ITM positions, forcing seller collateral to be locked until settlement window expires.
- **Nonce griefing:** Rapidly incrementing nonce to invalidate legitimate outstanding quotes.

**Mitigations:**
- Minimum position size / premium to prevent dust.
- Off-chain quote aggregation — takers only submit quotes they've verified off-chain.
- Settlement window timeout — collateral auto-releases after window.
- Reputation system (off-chain, in UI) for maker reliability.
- Rate limiting on nonce increments is NOT recommended (restricts legitimate use).

**Residual Risk:** Medium. Some griefing is inherent in any permissionless system.

---

### T6: Front-running

**Description:** Attacker observes a pending `execute()` transaction and front-runs it.

**Attack Vectors:**
- **Taker front-running:** Another taker sees a favorable quote being executed and front-runs to claim it. Mitigated if `taker != address(0)` (targeted quote).
- **Maker front-running:** Maker sees their quote being executed and front-runs with a nonce increment to cancel.
- **Sandwich:** Not applicable (no AMM pool).

**Mitigations:**
- Targeted quotes (`taker` field set to specific address) prevent taker front-running.
- Maker cancellation front-running is a known UX issue in all RFQ systems. Mitigations:
  - Off-chain reputation / banning for makers who frequently cancel.
  - Short `deadline` windows reduce the attack surface.
  - Consider a small cancellation penalty (stake-based). See Decisions.md.

**Residual Risk:** Medium. Maker-side front-running is an inherent RFQ trade-off.

---

### T7: Collateral Token Risk

**Description:** The stablecoin used as collateral depegs or is paused/blacklisted.

**Attack Vectors:**
- USDC issuer (Circle) blacklists the contract address.
- Stablecoin depegs — collateral is no longer worth face value.
- Token contract is upgraded with breaking changes.

**Mitigations:**
- Support multiple stablecoin options (USDC, USDT, etc.).
- Monitor for blacklist risk — use a non-upgradeable collateral wrapper if needed.
- Settlement in native token as a fallback (see Decisions.md).
- Price feeds should be denominated in the same stablecoin used for settlement.

**Residual Risk:** Low-medium. Systemic stablecoin risk is external.

---

### T8: Timestamp Manipulation

**Description:** Block timestamp is used for expiry checks. Miners/validators can slightly manipulate `block.timestamp`.

**Attack Vectors:**
- Validator shifts timestamp by a few seconds to change settlement outcome.
- Only relevant if expiry falls exactly at a block boundary AND the option is near ATM.

**Mitigations:**
- Expiry times are set in hours (08:00 UTC) — a few seconds of drift is immaterial.
- On HyperEVM, block times are fast and validator control is limited.
- Settlement price is fetched for a specific timestamp, not the settlement transaction's block.

**Residual Risk:** Very low on HyperEVM.

---

### T9: Flash Loan Attacks

**Description:** Attacker uses flash loans to temporarily hold sufficient collateral to execute and settle.

**Attack Vectors:**
- Borrow collateral via flash loan → execute a put as seller → attempt to settle in same transaction.
- Not directly exploitable because execution and settlement are separated by the expiry timestamp.

**Mitigations:**
- Settlement cannot occur before `expiry` — flash loan must span multiple blocks (impossible).
- Collateral is locked from the `execute()` call until expiry — cannot be withdrawn.
- Premium payment is immediate and non-refundable.

**Residual Risk:** Very low. The temporal separation makes flash loan attacks infeasible.

---

## 3. Trust Assumptions

| Component | Trust Level | Notes |
|-----------|-------------|-------|
| Settlement Oracle | **High trust** | Single point of truth for settlement price |
| ERC-20 tokens | **Medium trust** | Assumes standard-compliant, non-malicious tokens |
| HyperEVM consensus | **High trust** | Assumes honest majority of validators |
| Off-chain RFQ relay | **No trust** | Quotes are verified on-chain via EIP-712 |
| Contract owner | **Limited trust** | Can pause but cannot access collateral |

---

## 4. Invariants to Verify (Formal / Fuzz Testing)

1. `collateralLocked[positionId] >= requiredCollateral` — always true while position is active.
2. No collateral can leave the contract between `execute()` and `expiry + SETTLEMENT_WINDOW`.
3. `usedQuotes[hash] == true` after any successful `execute()` — no double execution.
4. `positions[id].settled == true` prevents double settlement.
5. Sum of all locked collateral == contract token balance (for each collateral token).
6. Premium is transferred in the same transaction as execution — no partial state.
7. Only the ITM party can initiate settlement.
8. After settlement window, only `expirePosition()` can release collateral (to seller).

---

## 5. Audit Recommendations

- **Pre-audit:** Fuzz testing with Foundry (all settlement paths, edge cases).
- **Pre-audit:** Formal verification of collateral invariants (Halmos or Certora).
- **Audit scope:** All settlement math, EIP-712 verification, access control, token interactions.
- **Auditor selection:** Firms with DeFi options/derivatives experience preferred.
