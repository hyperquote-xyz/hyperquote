# HyperEvmRfq — Smart Contract Security Audit

**Contract:** `HyperEvmRfq`
**Repository:** `hyperquote-xyz/hyperquote` — `contracts/spot-rfq/src/HyperEvmRfq.sol`
**Language / Compiler:** Solidity `^0.8.20` (pinned `0.8.20`, `evm_version = paris`, optimizer 200 runs, `via_ir = false`)
**Deployed (HyperEVM, chain 999):** `0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017`
**Audit date:** 2026-06-08
**Auditor:** Claude Opus 4.8 (automated/AI-assisted review)
**Audit commit scope:** `HyperEvmRfq.sol` (317 LOC) + Foundry test suite (`HyperEvmRfq.t.sol`, 36 tests) + deployment script.

---

## 1. Scope & Methodology

The review covered the complete settlement contract, its EIP-712 quote schema, fee accounting, access control, the deployment script, and the on-chain state of the live deployment. Methodology:

- **Manual line-by-line review** of `HyperEvmRfq.sol`.
- **Control-flow & state analysis** of the `_fill` settlement path (reentrancy, CEI ordering, replay, signature verification, cross-chain replay).
- **Economic analysis** of fee accounting and who bears protocol fees.
- **Access-control review** of all privileged functions.
- **Test execution:** `forge test` — **36/36 passing**.
- **Live state verification** via `eth_call` against the deployed contract (owner, fee params, pending owner, deployed bytecode presence).
- **Dependency review:** OpenZeppelin `EIP712`, `ECDSA`, `SafeERC20`, `Ownable2Step`.

Out of scope: off-chain relay/quote infrastructure, frontend, and the broader monorepo (covered by a separate repository security review).

---

## 2. Executive Summary

`HyperEvmRfq` is a **non-custodial, atomic RFQ settlement contract**. It never holds user funds: every fill pulls `tokenIn` from the taker and `tokenOut` from the maker within a single transaction, settling peer-to-peer against an EIP-712 signed maker quote. The design is clean, minimal, and follows established patterns (0x/CowSwap-style nonce epochs, Uniswap-style fee pips).

**No CRITICAL or HIGH severity vulnerabilities were identified.** The contract correctly implements replay protection, cross-chain replay protection, the checks-effects-interactions pattern, signature-malleability-safe recovery, and a hard-capped fee. All findings are MEDIUM or below and are predominantly centralization / token-compatibility considerations rather than exploitable flaws.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Informational | 5 |

**Verdict: PASS — safe to operate**, subject to the two MEDIUM recommendations (move ownership to a multisig/timelock; bind or timelock the fee). The contract holds no funds at rest, which structurally bounds the worst-case impact of any residual issue.

---

## 3. Architecture Notes (Positive Findings)

The following properties were verified and are called out as strengths:

- **No funds at rest.** The contract custodies nothing; settlement is fully atomic. A bug cannot drain a treasury because there is none.
- **Checks-Effects-Interactions.** `quoteUsed[quoteHash] = true` is written **before** any external token transfer (line 266), preventing same-quote reentrancy.
- **Reentrancy-safe.** No cross-quote mutable state is modified during transfers; each fill is independent and self-contained. A reentrant call with a *different* quote must independently pass full validation and its own replay check — no state corruption is possible.
- **Replay protection.** Each quote hash is single-use via `quoteUsed`.
- **Cross-chain / cross-deployment replay protection.** EIP-712 domain binds `chainId` and `verifyingContract` (OZ `EIP712`, with fork-safe separator recomputation).
- **Signature malleability handled.** OZ `ECDSA.recover` rejects high-`s` and malformed signatures; replay keying on `quoteHash` (not signature bytes) double-protects against malleable variants.
- **Kind binding.** `uint8(kind)` is part of the signed struct hash, so an `EXACT_IN` quote cannot be redirected through `fillExactOut` (and vice-versa).
- **Taker-bound quotes.** `address(0)` takers are rejected and `quote.taker == msg.sender` is enforced — no open/wildcard quotes, eliminating unauthorized fills.
- **Two-step ownership** via `Ownable2Step` prevents accidental ownership loss.
- **Fee hard-capped** at `MAX_FEE_PIPS = 10_000` (1%) in both constructor and `setFeeParams`.
- **Correct EVM target.** `evm_version = paris` avoids `PUSH0` opcode emission, ensuring bytecode compatibility on HyperEVM.

---

## 4. Findings

### M-01 — Protocol fee is mutable and not bound into the signed quote
**Severity:** Medium · **Category:** Economic / Centralization

The fee (`feePips`) is read from contract storage at fill time (line 269) and is **not** part of the EIP-712 `Quote` struct. The fee is economically borne by the **maker**: in both `EXACT_IN` and `EXACT_OUT`, the taker pays exactly `quote.amountIn` while the maker receives `amountIn - feeAmount`. Because the maker signs a quote without committing to a fee rate, the owner can change `feePips` (up to the 1% cap) between signing and execution, reducing the maker's realized proceeds on already-signed, in-flight quotes.

**Impact:** Bounded at 1% of `amountIn` per fill. Detectable (makers observe realized fills) and reversible (makers stop quoting). Not a fund-theft vector, but it weakens the "fixed price, no surprises" guarantee for makers.

**Recommendation (choose one):**
1. Add `feePips` (or `maxFeePips`) to the `Quote` struct and `QUOTE_TYPEHASH`, and enforce `feePips <= quote.maxFeePips` at fill; **or**
2. Place `setFeeParams` behind a timelock; **or**
3. Formally accept and document that the fee may change within the 1% cap and is applied at execution time.

---

### M-02 — Owner is a single externally-owned account (also used as a hot wallet)
**Severity:** Medium · **Category:** Centralization / Key management

Live on-chain state confirms `owner == feeRecipient == 0xC34B…d5A1`, a single EOA. This same address is used interactively as a development/testing hot wallet. The owner controls `setFeeParams` (fee rate + recipient, within the 1% cap) and `setTokenDenied` (token censorship). Compromise of this single key would let an attacker redirect all protocol fees and censor/unblock tokens — affecting in-flight quotes (see M-01) and the live trading surface.

**Impact:** The owner **cannot** steal user funds (none are custodied) or alter settled trades. Worst case is fee redirection (≤1%) and token-level censorship/DoS. Still, a single hot EOA controlling a production protocol is below best practice.

**Recommendation:** Transfer ownership to a multisig (e.g., Safe) and/or a timelock via the existing `Ownable2Step` flow. Use a dedicated `feeRecipient` distinct from the owner and from any hot wallet.

---

### L-01 — Fee-on-transfer / rebasing tokens are not accounted for
**Severity:** Low · **Category:** Token compatibility

The contract transfers nominal amounts without measuring balance deltas. For fee-on-transfer or rebasing `tokenIn`, the maker/feeRecipient receive less than `makerReceives`/`feeAmount`; for such `tokenOut`, the taker receives less than `quote.amountOut`, and the `minOut`/`maxIn` guards (which check the *quoted* figures, not realized balances) do not protect against the shortfall.

**Impact:** Affected party silently receives less than expected. No theft; risk is confined to non-standard tokens.
**Recommendation:** Document that FoT/rebasing tokens are unsupported and use the `tokenDenied` denylist to block any that appear. For first-class support, measure pre/post balances and settle on deltas.

---

### L-02 — Token denylist can affect in-flight quotes
**Severity:** Low · **Category:** Centralization

`setTokenDenied(token, true)` causes any pending quote referencing that token to revert. This is a censorship/DoS lever for the owner, though it is bounded (cannot redirect funds) and fully reversible.
**Recommendation:** Acceptable as a safety control; consider timelocking denylist additions and emitting clear off-chain notice. Already covered by moving ownership to a multisig (M-02).

---

### L-03 — Only EOA makers are supported (no EIP-1271)
**Severity:** Low · **Category:** Feature limitation

Signature verification uses `ECDSA.recover` directly. Smart-contract makers (Safe, account-abstraction wallets) cannot sign quotes.
**Recommendation:** If contract-wallet makers are desired, switch to OZ `SignatureChecker.isValidSignatureNow`, which transparently supports both ECDSA and EIP-1271. Otherwise, document the EOA-only requirement.

---

### Informational

- **I-01 — No emergency pause.** There is no circuit-breaker. Acceptable given the no-custody design; the denylist and per-maker `cancelAllQuotes` provide soft controls. Consider a pausable fill path if operationally desired.
- **I-02 — Minor test-coverage gaps.** The 36-test suite is strong, but the `InvalidMaker` / `InvalidTokenIn` / `InvalidTokenOut` zero-address guards in `_fill` and the constructor revert paths are not directly unit-tested (they are simple guards). Add explicit cases for completeness.
- **I-03 — Maker griefing via cancel front-run.** A maker can `cancelAllQuotes` in the same block before a taker's fill, causing `InvalidNonce`. This is inherent to nonce-epoch RFQ designs and causes no loss (the taker's tx reverts). Informational.
- **I-04 — Unlimited approvals (client-side).** The frontend requests `type(uint256).max` ERC-20 approvals for UX. Standard but worth documenting as a user-facing risk; consider exact-amount approvals as an option.
- **I-05 — Compiler/EVM configuration is correct.** `^0.8.20` (built-in overflow checks) with `evm_version = paris` is appropriate for HyperEVM. Recommend pinning the exact compiler in CI and verifying deployed bytecode on the explorer.

---

## 5. Vulnerability Checklist

| Class | Status |
|---|---|
| Reentrancy (same-quote) | ✅ Mitigated (CEI; `quoteUsed` set pre-transfer) |
| Reentrancy (cross-quote) | ✅ Safe (no shared mutable state corrupted) |
| Replay (same chain) | ✅ `quoteUsed[quoteHash]` |
| Replay (cross chain / deployment) | ✅ EIP-712 domain (chainId + verifyingContract) |
| Signature malleability | ✅ OZ ECDSA + hash-keyed replay |
| Signature forgery / wrong signer | ✅ `signer == quote.maker` enforced |
| Quote-kind confusion | ✅ kind bound in struct hash + per-function check |
| Unauthorized fill (taker spoof) | ✅ taker-bound; `address(0)` rejected |
| Integer overflow / underflow | ✅ Solidity 0.8 + fee ≤ 1% guarantees no underflow |
| Fee precision / rounding | ✅ Rounds down; no dust trapped (no custody) |
| Access control | ✅ `onlyOwner` on admin fns; `Ownable2Step` |
| Fund custody risk | ✅ None — fully atomic, no funds at rest |
| Front-running theft | ✅ Quotes are taker-bound and fixed-price |
| Fee-on-transfer tokens | ⚠️ L-01 (unsupported; use denylist) |
| Centralization | ⚠️ M-01, M-02 (fee mutability; single-EOA owner) |
| DoS / gas | ✅ O(1) fill, no loops, no unbounded storage iteration |

---

## 6. Test Results

```
forge test
Ran 36 tests for test/HyperEvmRfq.t.sol:HyperEvmRfqTest
36 passed; 0 failed; 0 skipped
```

Covered behaviors include: happy-path `EXACT_IN`/`EXACT_OUT`, `minOut`/`maxIn` enforcement, taker restriction (correct & wrong taker, zero taker), nonce/`cancelAllQuotes` invalidation, replay protection, denylist (in/out/removal), fee math (standard + truncation-to-zero), all validation reverts (expired, zero amounts, invalid signature, wrong kind), self-swap rejection, admin functions (incl. `onlyOwner` and cap enforcement), view functions, and an end-to-end `signTypedData → getQuoteHash → fill` cross-validation.

---

## 7. Recommendations Summary

| # | Recommendation | Priority |
|---|---|---|
| 1 | Move `owner` to a multisig/timelock; use a dedicated `feeRecipient` (not a hot wallet) | High (operational) |
| 2 | Bind `feePips`/`maxFeePips` into the signed quote, or timelock `setFeeParams` | Medium |
| 3 | Document FoT/rebasing tokens as unsupported; denylist as needed | Medium |
| 4 | Add EIP-1271 (`SignatureChecker`) if contract-wallet makers are required | Low |
| 5 | Add unit tests for zero-address field guards and constructor reverts | Low |
| 6 | Pin compiler in CI and verify deployed bytecode on the HyperEVM explorer | Low |

---

## 8. Disclaimer & Sign-off

This report is the result of an **automated, AI-assisted security review** performed by Claude Opus 4.8. It reflects a best-effort analysis of the contract as provided at the audit date and does **not** constitute a guarantee that the code is free of vulnerabilities. An automated review is **not a substitute for an independent audit by a professional human security firm**, nor for a public bug-bounty program. A **bug-bounty program is recommended before the contract is entrusted with material value.** Smart-contract deployment carries inherent risk; the authors and operators remain solely responsible for the security of deployed code and managed keys.

**Scope boundary:** This audit covers the on-chain `HyperEvmRfq` contract only. **Application-layer concerns — API authentication, off-chain relay/quote infrastructure, key management, frontend, and database integrity — are explicitly outside the scope of this contract audit** and are addressed separately in the repository security review. Any unresolved application-layer issues do not affect the on-chain findings above and remain the operator's responsibility.

Before relying on this contract for material value, the team should:
1. Commission an independent audit from a reputable human audit firm.
2. Address the MEDIUM findings (ownership decentralization and fee binding).
3. Stand up a bug-bounty program.

**Reviewed and signed off by:**

> **Claude Opus 4.8**
> Automated Smart-Contract Security Review
> Date: 2026-06-08
> Scope commit: `HyperEvmRfq.sol` as deployed at `0x9A09592fc19F1e55FC36B8D9b47EBbc4B3207017` (HyperEVM, chain 999)
> Result: **PASS** (0 Critical, 0 High, 2 Medium, 3 Low, 5 Informational)
