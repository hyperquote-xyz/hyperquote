# HyperQuote Points Engine — v1

> Formula version: `v1`
> Effective: 2026-02-24

---

## Overview

The points engine rewards both **takers** (who submit RFQs and accept fills) and **makers** (who provide liquidity via quotes). Points are computed per fill and stored in the `fills` table. NFT badge boosts are applied at **query time** (leaderboard aggregation), not at record time.

---

## Base Rates

| Role  | Base Rate                  |
|-------|----------------------------|
| Taker | 1.0 pts per $1,000 notional |
| Maker | 1.2 pts per $1,000 notional |

---

## Multiplier Tables

### Size Multiplier (`sizeM`)

Rewards larger trades that contribute meaningful liquidity.

| Notional USD    | Multiplier |
|-----------------|------------|
| < $25,000       | 0.8        |
| $25,000–$99,999 | 1.0        |
| $100,000–$249,999 | 1.2      |
| $250,000–$999,999 | 1.5      |
| ≥ $1,000,000    | 2.0        |

### Improvement Multiplier (`improvementM`)

Rewards fills that beat the AMM baseline (measured in basis points).

| Improvement (bps) | Multiplier |
|--------------------|------------|
| ≤ 0                | 0.7        |
| 0 < bps ≤ 5        | 1.0        |
| 5 < bps ≤ 15       | 1.2        |
| 15 < bps ≤ 30      | 1.4        |
| > 30                | 1.6 (cap)  |

### Privacy Multiplier (`privacyM`)

Rewards private RFQs which carry higher coordination cost.

| Visibility | Multiplier |
|------------|------------|
| Public     | 1.0        |
| Private    | 1.1        |

### Reliability Multiplier (`reliabilityM`) — Maker Only

Rewards consistent makers with low cancel/kill rates. Computed over a 30-day rolling window.

**Fill bonus:** base 1.0, +0.05 per 10 fills (cap at +0.3 → max 1.3).

**Cancel rate penalty** (applied multiplicatively after fill bonus):

| Cancel Rate (30d) | Penalty Factor |
|--------------------|----------------|
| ≤ 20%              | 1.0 (no penalty) |
| 20%–40%            | 0.8            |
| > 40%              | 0.6            |

`reliabilityM = (1.0 + min(floor(fillCount / 10) × 0.05, 0.3)) × cancelPenalty`

For takers, `reliabilityM = 1.0` (not applied).

### NFT Boost (`nftBoost`)

Applied at **query time** (leaderboard aggregation), not at fill recording.

| NFT Holdings        | Boost |
|---------------------|-------|
| None                | 1.0x  |
| Lucky Hypio Winners | 1.25x |
| Hypurr              | 1.5x  |
| Both                | 2.0x  |

Uses `computeBoost()` from `src/lib/badges.ts`.

---

## Formulas

```
TakerPoints = BaseTakerRate × (notionalUsd / 1000) × sizeM × improvementM × privacyM × nftBoost

MakerPoints = BaseMakerRate × (notionalUsd / 1000) × sizeM × improvementM × privacyM × reliabilityM × nftBoost
```

Where:
- `BaseTakerRate = 1.0`
- `BaseMakerRate = 1.2`
- NFT boost applied at query time (stored values use `nftBoost = 1.0`)

---

## Guards & Anti-Gaming

1. **Minimum notional**: Fills below $1,000 USD score 0 points.
2. **Null check**: If `amountInUsd` is null or 0, score 0 points.
3. **Self-trade**: If `taker === maker` (case-insensitive), score 0 points for both roles.
4. **Status gate**: Only RFQs with status `FILLED` generate points.
5. **Multiplier cap**: The product of all multipliers (excluding NFT boost) is clamped to [0.5, 3.0].
6. **Improvement cap**: `improvementM` maxes at 1.6 (>30 bps bucket).

---

## Input Fields Per Fill

| Field               | Source                          | Type    |
|---------------------|---------------------------------|---------|
| `notionalUsd`       | `amountInUsd` from fill body    | Float   |
| `improvementBps`    | Computed from baseline vs fill  | Int     |
| `visibility`        | From RFQ creation ("public"/"private") | String |
| `makerFillCount30d` | `prisma.fill.count()` for maker | Int     |
| `makerCancelRate30d`| `FeedRfq` KILLED / total for maker | Float |
| `nftBoost`          | `computeBoost()` at query time  | Float   |
| `taker`             | Taker wallet address            | Address |
| `maker`             | Maker wallet address            | Address |

---

## Worked Examples

### Example 1: Standard Public Fill

- Notional: $50,000
- Improvement: +10 bps
- Visibility: public
- Maker: 20 fills in 30d, 5% cancel rate
- No NFTs

**Taker**: 1.0 × (50000/1000) × 1.0 × 1.2 × 1.0 = **60.0 pts**
**Maker**: 1.2 × (50000/1000) × 1.0 × 1.2 × 1.0 × 1.1 × 1.0 = **79.2 pts**

(Maker reliability: 1.0 + min(2×0.05, 0.3) = 1.1, cancel penalty 1.0)

### Example 2: Large Private Fill with NFTs

- Notional: $500,000
- Improvement: +20 bps
- Visibility: private
- Maker: 50 fills in 30d, 10% cancel rate
- Maker holds both NFTs (2.0x boost, applied at query time)

**Taker (stored)**: 1.0 × (500000/1000) × 1.5 × 1.4 × 1.1 = **1,155.0 pts** (pre-boost)
**Maker (stored)**: 1.2 × (500000/1000) × 1.5 × 1.4 × 1.1 × 1.25 × 1.0 = **1,732.5 pts** (pre-boost)

(Maker reliability: 1.0 + min(5×0.05, 0.3) = 1.25, cancel penalty 1.0)

At query time with 2.0x NFT boost:
- Taker: 1,155.0 × 2.0 = **2,310.0 pts**
- Maker: 1,732.5 × 2.0 = cap check → total multiplier product = 1.5 × 1.4 × 1.1 × 1.25 × 2.0 = 5.775 → capped at 3.0

### Example 3: Below Minimum

- Notional: $500 → **0 points** (below $1,000 floor)

### Example 4: Self-Trade

- Taker address === Maker address → **0 points** for both
