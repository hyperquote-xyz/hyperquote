/**
 * TickMath — Pure-Integer Implementation
 *
 * Port of Uniswap V3 TickMath.sol to TypeScript BigInt.
 * NO floating-point math anywhere — all operations are integer-only.
 *
 * Reference: https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol
 *
 * The key insight: 1.0001^tick can be decomposed into products of
 * precomputed powers of 1.0001^(2^i) for each set bit in |tick|.
 * These powers are stored as Q128 fixed-point constants.
 *
 * For getSqrtPriceAtTick: computes sqrt(1.0001)^tick = 1.0001^(tick/2)
 * as a Q64.96 fixed-point number.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum tick index */
export const MIN_TICK = -887272;
/** Maximum tick index */
export const MAX_TICK = 887272;

/** Q96 = 2^96 */
const Q96 = 2n ** 96n;

/** Q128 = 2^128 */
const Q128 = 2n ** 128n;

/** Min sqrt price (at MIN_TICK) — matches Uniswap V3 TickMath.sol */
export const MIN_SQRT_PRICE = 4295128739n;

/** Max sqrt price (at MAX_TICK) — matches Uniswap V3 TickMath.sol */
export const MAX_SQRT_PRICE =
  1461446703485210103287273052203988822378723970342n;

// ---------------------------------------------------------------------------
// Precomputed Q128 magic constants
// ---------------------------------------------------------------------------
// These are precomputed values of sqrt(1.0001)^(2^i) in Q128 format.
// i.e., magicSqrt[i] = round(sqrt(1.0001)^(2^i) * 2^128)
//
// For negative ticks we use the reciprocal: Q128^2 / magicSqrt[i].
//
// Source: Uniswap V3 TickMath.sol constants.
// ---------------------------------------------------------------------------

const MAGIC_SQRT: bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n, // 2^0  = 1
  0xfff97272373d413259a46990580e213an, // 2^1  = 2
  0xfff2e50f5f656932ef12357cf3c7fdccn, // 2^2  = 4
  0xffe5caca7e10e4e61c3624eaa0941cd0n, // 2^3  = 8
  0xffcb9843d60f6159c9db58835c926644n, // 2^4  = 16
  0xff973b41fa98c081472e6896dfb254c0n, // 2^5  = 32
  0xff2ea16466c96a3843ec78b326b52861n, // 2^6  = 64
  0xfe5dee046a99a2a811c461f1969c3053n, // 2^7  = 128
  0xfcbe86c7900a88aedcffc83b479aa3a4n, // 2^8  = 256
  0xf987a7253ac413176f2b074cf7815e54n, // 2^9  = 512
  0xf3392b0822b70005940c7a398e4b70f3n, // 2^10 = 1024
  0xe7159475a2c29b7443b29c7fa6e889d9n, // 2^11 = 2048
  0xd097f3bdfd2022b8845ad8f792aa5825n, // 2^12 = 4096
  0xa9f746462d870fdf8a65dc1f90e061e5n, // 2^13 = 8192
  0x70d869a156d2a1b890bb3df62baf32f7n, // 2^14 = 16384
  0x31be135f97d08fd981231505542fcfa6n, // 2^15 = 32768
  0x9aa508b5b7a84e1c677de54f3e99bc9n,  // 2^16 = 65536
  0x5d6af8dedb81196699c329225ee604n,    // 2^17 = 131072
  0x2216e584f5fa1ea926041bedfe98n,      // 2^18 = 262144
  0x48a170391f7dc42444e8fa2n,           // 2^19 = 524288
];

// ---------------------------------------------------------------------------
// getSqrtPriceAtTick (pure integer)
// ---------------------------------------------------------------------------

/**
 * Compute sqrtPriceX96 from a tick index using pure-integer arithmetic.
 *
 * Algorithm (from Uniswap V3 TickMath.sol):
 *   1. Start with ratio = Q128 (for positive ticks) or compute for negative
 *   2. For each bit set in |tick|, multiply ratio by the precomputed constant
 *      and shift right by 128
 *   3. Finally convert from Q128 to Q96 format
 *
 * @param tick — the tick index (must be in range [MIN_TICK, MAX_TICK])
 * @returns sqrtPriceX96 as a Q64.96 fixed-point bigint
 * @throws if tick is out of range
 */
export function getSqrtPriceAtTick(tick: number): bigint {
  const absTick = Math.abs(tick);

  if (absTick > MAX_TICK) {
    throw new Error(
      `Tick ${tick} out of range [${MIN_TICK}, ${MAX_TICK}]`
    );
  }

  // Start with ratio = 2^128 (Q128 representation of 1.0)
  let ratio: bigint = Q128;

  // For each set bit in absTick, multiply ratio by the corresponding
  // precomputed magic constant and shift right by 128.
  // This computes: ratio = product of sqrt(1.0001)^(2^i) for set bits
  // which equals sqrt(1.0001)^absTick
  //
  // The magic constants are slightly less than Q128 (since sqrt(1.0001)^x < 1
  // when we consider them as ratios in Q128). After all multiplications,
  // the ratio represents 1/sqrt(1.0001)^absTick in Q128.

  if (absTick & 0x1) ratio = (ratio * MAGIC_SQRT[0]) >> 128n;
  if (absTick & 0x2) ratio = (ratio * MAGIC_SQRT[1]) >> 128n;
  if (absTick & 0x4) ratio = (ratio * MAGIC_SQRT[2]) >> 128n;
  if (absTick & 0x8) ratio = (ratio * MAGIC_SQRT[3]) >> 128n;
  if (absTick & 0x10) ratio = (ratio * MAGIC_SQRT[4]) >> 128n;
  if (absTick & 0x20) ratio = (ratio * MAGIC_SQRT[5]) >> 128n;
  if (absTick & 0x40) ratio = (ratio * MAGIC_SQRT[6]) >> 128n;
  if (absTick & 0x80) ratio = (ratio * MAGIC_SQRT[7]) >> 128n;
  if (absTick & 0x100) ratio = (ratio * MAGIC_SQRT[8]) >> 128n;
  if (absTick & 0x200) ratio = (ratio * MAGIC_SQRT[9]) >> 128n;
  if (absTick & 0x400) ratio = (ratio * MAGIC_SQRT[10]) >> 128n;
  if (absTick & 0x800) ratio = (ratio * MAGIC_SQRT[11]) >> 128n;
  if (absTick & 0x1000) ratio = (ratio * MAGIC_SQRT[12]) >> 128n;
  if (absTick & 0x2000) ratio = (ratio * MAGIC_SQRT[13]) >> 128n;
  if (absTick & 0x4000) ratio = (ratio * MAGIC_SQRT[14]) >> 128n;
  if (absTick & 0x8000) ratio = (ratio * MAGIC_SQRT[15]) >> 128n;
  if (absTick & 0x10000) ratio = (ratio * MAGIC_SQRT[16]) >> 128n;
  if (absTick & 0x20000) ratio = (ratio * MAGIC_SQRT[17]) >> 128n;
  if (absTick & 0x40000) ratio = (ratio * MAGIC_SQRT[18]) >> 128n;
  if (absTick & 0x80000) ratio = (ratio * MAGIC_SQRT[19]) >> 128n;

  // The magic constants encode 1/sqrt(1.0001) per bit.
  // So after the loop, ratio = Q128 / sqrt(1.0001)^absTick.
  //
  // For positive tick: sqrtPrice = sqrt(1.0001)^tick = Q128^2 / ratio
  // For negative tick: sqrtPrice = sqrt(1.0001)^tick = ratio (already inverted)

  if (tick > 0) {
    // Invert: ratio currently represents the reciprocal
    ratio = (Q128 * Q128) / ratio;
  }

  // Convert from Q128 to Q96: shift right by 32 bits.
  // Uniswap rounds up: add 1 if there's any remainder.
  const remainder = ratio % (1n << 32n);
  const sqrtPriceX96 = (ratio >> 32n) + (remainder === 0n ? 0n : 1n);

  return sqrtPriceX96;
}

// ---------------------------------------------------------------------------
// getTickAtSqrtPrice (inverse — for reference/testing)
// ---------------------------------------------------------------------------

/**
 * Compute the greatest tick value such that getSqrtPriceAtTick(tick) <= sqrtPriceX96.
 * Uses binary search over the tick range.
 *
 * This is a simplified version for testing/validation. Production code
 * should use the log2 approach from Uniswap V3 TickMath.sol.
 */
export function getTickAtSqrtPrice(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_PRICE || sqrtPriceX96 > MAX_SQRT_PRICE) {
    throw new Error("sqrtPriceX96 out of range");
  }

  // Binary search for the tick
  let lo = MIN_TICK;
  let hi = MAX_TICK;

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const price = getSqrtPriceAtTick(mid);
    if (price <= sqrtPriceX96) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}
