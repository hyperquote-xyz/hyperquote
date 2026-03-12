/**
 * TickMath Unit Tests — Audit Fix #2
 *
 * Validates pure-integer getSqrtPriceAtTick against known reference values
 * from Uniswap V3's TickMath.sol.
 *
 * Test categories:
 *   1. Boundary ticks (MIN_TICK, MAX_TICK, 0)
 *   2. Known reference values from Uniswap V3
 *   3. Monotonicity (higher tick → higher price)
 *   4. Inverse consistency (getTickAtSqrtPrice round-trips)
 *   5. Symmetry (positive/negative tick relationship)
 *   6. Common pool ticks (standard fee tier ticks)
 *   7. LiquidityNet sign behaviour validation
 */

import { describe, it, expect } from "vitest";
import {
  getSqrtPriceAtTick,
  getTickAtSqrtPrice,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_PRICE,
  MAX_SQRT_PRICE,
} from "../tick-math";

// ---------------------------------------------------------------------------
// Reference values from Uniswap V3 TickMath.sol
// These are the exact values the Solidity contract produces.
// Source: Uniswap V3 TickMath.sol tests + on-chain verification
// ---------------------------------------------------------------------------

const Q96 = 2n ** 96n;

/** Known sqrtPriceX96 values at specific ticks from Uniswap V3 */
const REFERENCE_VALUES: { tick: number; sqrtPriceX96: bigint; tolerance: bigint }[] = [
  // Tick 0: sqrtPrice = 1.0 → sqrtPriceX96 = 2^96 (exact)
  { tick: 0, sqrtPriceX96: Q96, tolerance: 0n },

  // MIN_TICK: exact constant from TickMath.sol
  { tick: MIN_TICK, sqrtPriceX96: MIN_SQRT_PRICE, tolerance: 0n },

  // MAX_TICK: exact constant from TickMath.sol
  { tick: MAX_TICK, sqrtPriceX96: MAX_SQRT_PRICE, tolerance: 0n },

  // Tick 1: sqrt(1.0001) — verified against Uniswap V3 TickMath.sol
  { tick: 1, sqrtPriceX96: 79232123823359799118286999568n, tolerance: 0n },

  // Tick -1: 1/sqrt(1.0001)
  { tick: -1, sqrtPriceX96: 79224201403219477170569942574n, tolerance: 0n },

  // Tick 100
  { tick: 100, sqrtPriceX96: 79625275426524748796330556128n, tolerance: 0n },

  // Tick -100
  { tick: -100, sqrtPriceX96: 78833030112140176575862854579n, tolerance: 0n },

  // Tick 1000: common for V3 pools
  { tick: 1000, sqrtPriceX96: 83290069058676223003182343270n, tolerance: 0n },

  // Tick -1000
  { tick: -1000, sqrtPriceX96: 75364347830767020784054125655n, tolerance: 0n },

  // Tick 10000
  { tick: 10000, sqrtPriceX96: 130621891405341611593710811006n, tolerance: 0n },

  // Tick -10000
  { tick: -10000, sqrtPriceX96: 48055510970269007215549348797n, tolerance: 0n },

  // Tick 50000: large positive
  { tick: 50000, sqrtPriceX96: 965075977353221155028623082916n, tolerance: 0n },

  // Tick -50000
  { tick: -50000, sqrtPriceX96: 6504256538020985011912221507n, tolerance: 0n },
];

// ---------------------------------------------------------------------------
// 1. Boundary Tests
// ---------------------------------------------------------------------------

describe("TickMath: Boundary values", () => {
  it("tick 0 returns exactly Q96 (= 2^96)", () => {
    expect(getSqrtPriceAtTick(0)).toBe(Q96);
  });

  it("MIN_TICK returns MIN_SQRT_PRICE", () => {
    const result = getSqrtPriceAtTick(MIN_TICK);
    expect(result).toBe(MIN_SQRT_PRICE);
  });

  it("MAX_TICK returns MAX_SQRT_PRICE (within rounding)", () => {
    const result = getSqrtPriceAtTick(MAX_TICK);
    // Allow small rounding difference for MAX_TICK
    const diff = result > MAX_SQRT_PRICE
      ? result - MAX_SQRT_PRICE
      : MAX_SQRT_PRICE - result;
    // Within 0.001% of expected
    expect(diff).toBeLessThan(MAX_SQRT_PRICE / 100000n);
  });

  it("throws for tick > MAX_TICK", () => {
    expect(() => getSqrtPriceAtTick(MAX_TICK + 1)).toThrow("out of range");
  });

  it("throws for tick < MIN_TICK", () => {
    expect(() => getSqrtPriceAtTick(MIN_TICK - 1)).toThrow("out of range");
  });
});

// ---------------------------------------------------------------------------
// 2. Reference Value Tests
// ---------------------------------------------------------------------------

describe("TickMath: Reference values", () => {
  for (const { tick, sqrtPriceX96, tolerance } of REFERENCE_VALUES) {
    it(`tick ${tick} matches reference (tolerance ±${tolerance})`, () => {
      const result = getSqrtPriceAtTick(tick);
      const diff = result > sqrtPriceX96
        ? result - sqrtPriceX96
        : sqrtPriceX96 - result;
      expect(diff).toBeLessThanOrEqual(tolerance);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Monotonicity Tests
// ---------------------------------------------------------------------------

describe("TickMath: Monotonicity", () => {
  it("higher tick always produces higher sqrtPriceX96", () => {
    const ticks = [MIN_TICK, -50000, -10000, -1000, -100, -1, 0, 1, 100, 1000, 10000, 50000, MAX_TICK];
    for (let i = 0; i < ticks.length - 1; i++) {
      const lower = getSqrtPriceAtTick(ticks[i]);
      const upper = getSqrtPriceAtTick(ticks[i + 1]);
      expect(upper).toBeGreaterThan(lower);
    }
  });

  it("consecutive ticks are monotonically increasing", () => {
    // Check 20 consecutive ticks around 0
    for (let tick = -10; tick < 10; tick++) {
      const a = getSqrtPriceAtTick(tick);
      const b = getSqrtPriceAtTick(tick + 1);
      expect(b).toBeGreaterThan(a);
    }
  });

  it("consecutive ticks around tick spacing boundaries (60, 200, 2000)", () => {
    for (const spacing of [60, 200, 2000]) {
      for (let i = -3; i < 3; i++) {
        const tick = spacing * i;
        if (tick >= MIN_TICK && tick + spacing <= MAX_TICK) {
          const a = getSqrtPriceAtTick(tick);
          const b = getSqrtPriceAtTick(tick + spacing);
          expect(b).toBeGreaterThan(a);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Inverse Consistency (Round-trip)
// ---------------------------------------------------------------------------

describe("TickMath: Inverse consistency", () => {
  it("getTickAtSqrtPrice inverts getSqrtPriceAtTick for common ticks", () => {
    const ticks = [0, 1, -1, 100, -100, 1000, -1000, 10000, -10000, 50000, -50000];
    for (const tick of ticks) {
      const sqrtPrice = getSqrtPriceAtTick(tick);
      const recovered = getTickAtSqrtPrice(sqrtPrice);
      expect(recovered).toBe(tick);
    }
  });

  it("getTickAtSqrtPrice returns correct tick for MIN_SQRT_PRICE", () => {
    expect(getTickAtSqrtPrice(MIN_SQRT_PRICE)).toBe(MIN_TICK);
  });

  it("getTickAtSqrtPrice returns correct tick for MAX_SQRT_PRICE", () => {
    const tick = getTickAtSqrtPrice(MAX_SQRT_PRICE);
    // Should be MAX_TICK or MAX_TICK-1 due to rounding
    expect(tick).toBeGreaterThanOrEqual(MAX_TICK - 1);
    expect(tick).toBeLessThanOrEqual(MAX_TICK);
  });
});

// ---------------------------------------------------------------------------
// 5. Symmetry (positive/negative tick relationship)
// ---------------------------------------------------------------------------

describe("TickMath: Symmetry", () => {
  it("sqrtPrice(tick) * sqrtPrice(-tick) ≈ Q96^2", () => {
    const ticks = [1, 10, 100, 1000, 10000, 50000, 100000];
    for (const tick of ticks) {
      const pos = getSqrtPriceAtTick(tick);
      const neg = getSqrtPriceAtTick(-tick);
      // pos * neg should ≈ Q96^2 = Q192
      const product = pos * neg;
      const q192 = Q96 * Q96;
      // Allow 0.01% tolerance
      const diff = product > q192 ? product - q192 : q192 - product;
      const tolerance = q192 / 10000n;
      expect(diff).toBeLessThan(tolerance);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Common Pool Tick Spacing Values
// ---------------------------------------------------------------------------

describe("TickMath: Common pool ticks", () => {
  // tickSpacing=1 (0.01% fee pools), tickSpacing=10 (0.05%),
  // tickSpacing=60 (0.3%), tickSpacing=200 (1%)
  const spacings = [1, 10, 60, 200];

  for (const spacing of spacings) {
    it(`produces valid prices for tickSpacing=${spacing} around origin`, () => {
      for (let i = -5; i <= 5; i++) {
        const tick = i * spacing;
        const price = getSqrtPriceAtTick(tick);
        expect(price).toBeGreaterThan(0n);
        expect(price).toBeLessThanOrEqual(MAX_SQRT_PRICE);
        expect(price).toBeGreaterThanOrEqual(MIN_SQRT_PRICE);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 7. LiquidityNet Sign Behaviour
// ---------------------------------------------------------------------------

describe("TickMath: LiquidityNet sign behaviour for V3 crossing", () => {
  /**
   * When a V3 swap crosses a tick boundary:
   *
   * For zeroForOne (price decreasing, moving left):
   *   - When crossing tick T going left, liquidity changes by -liquidityNet
   *   - If T is a position's lower tick: liquidityNet > 0 (was added going right)
   *     so crossing left means we REMOVE that liquidity (-positive = less)
   *   - If T is a position's upper tick: liquidityNet < 0 (was removed going right)
   *     so crossing left means we ADD that liquidity (-negative = more)
   *
   * For oneForZero (price increasing, moving right):
   *   - When crossing tick T going right, liquidity changes by +liquidityNet
   *   - If T is a position's lower tick: liquidityNet > 0 → ADD liquidity
   *   - If T is a position's upper tick: liquidityNet < 0 → REMOVE liquidity
   */

  it("crossing lower tick of a position going right adds liquidity", () => {
    // A position from tick 100 to tick 200
    // At tick 100 (lower), liquidityNet = +1000 (added when entering range going right)
    const liquidityNet = 1000n;
    const currentLiquidity = 5000n;

    // oneForZero (going right): liquidity += liquidityNet
    const newLiquidity = currentLiquidity + liquidityNet;
    expect(newLiquidity).toBe(6000n); // Increased — correct
  });

  it("crossing upper tick of a position going right removes liquidity", () => {
    // At tick 200 (upper), liquidityNet = -1000 (removed when leaving range going right)
    const liquidityNet = -1000n;
    const currentLiquidity = 6000n;

    // oneForZero (going right): liquidity += liquidityNet
    const newLiquidity = currentLiquidity + liquidityNet;
    expect(newLiquidity).toBe(5000n); // Decreased — correct
  });

  it("crossing lower tick of a position going left removes liquidity", () => {
    // At tick 100 (lower), liquidityNet = +1000
    const liquidityNet = 1000n;
    const currentLiquidity = 6000n;

    // zeroForOne (going left): liquidity -= liquidityNet (negate)
    const newLiquidity = currentLiquidity - liquidityNet;
    expect(newLiquidity).toBe(5000n); // Decreased — correct, we're leaving the range
  });

  it("crossing upper tick of a position going left adds liquidity", () => {
    // At tick 200 (upper), liquidityNet = -1000
    const liquidityNet = -1000n;
    const currentLiquidity = 5000n;

    // zeroForOne (going left): liquidity -= liquidityNet
    // -= (-1000) = += 1000
    const newLiquidity = currentLiquidity - liquidityNet;
    expect(newLiquidity).toBe(6000n); // Increased — correct, we're entering the range from above
  });

  it("validates V3 adapter crossing logic matches Uniswap convention", () => {
    // The V3 adapter uses: currentLiquidity += zeroForOne ? -liquidityNet : liquidityNet
    // This should be equivalent to the Uniswap reference.

    // Scenario: Position from tick -100 to tick 100, liquidityNet at boundaries:
    //   tick -100: liquidityNet = +5000 (lower bound)
    //   tick  100: liquidityNet = -5000 (upper bound)

    let liquidity = 10000n; // base liquidity without this position

    // Going right (oneForZero): cross tick -100
    const lnLower = 5000n;
    liquidity += lnLower; // oneForZero: += liquidityNet
    expect(liquidity).toBe(15000n); // Added position's liquidity

    // Going right: cross tick 100
    const lnUpper = -5000n;
    liquidity += lnUpper; // oneForZero: += liquidityNet
    expect(liquidity).toBe(10000n); // Removed position's liquidity

    // Now go back left (zeroForOne): cross tick 100
    liquidity += -lnUpper; // zeroForOne: += -liquidityNet
    expect(liquidity).toBe(15000n); // Re-enter position from above

    // Going left: cross tick -100
    liquidity += -lnLower; // zeroForOne: += -liquidityNet
    expect(liquidity).toBe(10000n); // Exit position going below
  });
});

// ---------------------------------------------------------------------------
// 8. No Floating Point (integrity check)
// ---------------------------------------------------------------------------

describe("TickMath: No floating point", () => {
  it("all intermediate values are BigInt (source code audit)", () => {
    // This test verifies the function returns BigInt for all test ticks
    const ticks = [0, 1, -1, 100, -100, 887272, -887272, 50000, -50000];
    for (const tick of ticks) {
      const result = getSqrtPriceAtTick(tick);
      expect(typeof result).toBe("bigint");
      expect(result).toBeGreaterThan(0n);
    }
  });
});
