/**
 * ABI Registry — Phase 3
 *
 * Maps factoryAbiId (from protocol_connectors table) to actual ABIs.
 * Also includes pool-level ABIs needed for state reading (Phase 4).
 *
 * Factory event signatures:
 *   V2: PairCreated(address indexed token0, address indexed token1, address pair, uint)
 *   V3: PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
 */

// ---------------------------------------------------------------------------
// Factory ABIs — Pool Creation Events
// ---------------------------------------------------------------------------

/** Uniswap V2-style factory — PairCreated event */
export const UNISWAP_V2_FACTORY_ABI = [
  {
    type: "event",
    name: "PairCreated",
    inputs: [
      { name: "token0", type: "address", indexed: true },
      { name: "token1", type: "address", indexed: true },
      { name: "pair", type: "address", indexed: false },
      { name: "", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "allPairsLength",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allPairs",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

/** Uniswap V3-style factory — PoolCreated event */
export const UNISWAP_V3_FACTORY_ABI = [
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      { name: "token0", type: "address", indexed: true },
      { name: "token1", type: "address", indexed: true },
      { name: "fee", type: "uint24", indexed: true },
      { name: "tickSpacing", type: "int24", indexed: false },
      { name: "pool", type: "address", indexed: false },
    ],
  },
] as const;

/**
 * Velodrome/Solidly-style factory — PoolCreated event
 * KittenSwap AMM uses this (Velodrome V1 fork).
 * Note: event signature differs from Uniswap — includes `stable` boolean.
 */
export const VELODROME_V1_FACTORY_ABI = [
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      { name: "token0", type: "address", indexed: true },
      { name: "token1", type: "address", indexed: true },
      { name: "stable", type: "bool", indexed: false },
      { name: "pool", type: "address", indexed: false },
      { name: "", type: "uint256", indexed: false },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Pool ABIs — On-chain State Reading (Phase 4)
// ---------------------------------------------------------------------------

/** Uniswap V2-style pair — getReserves + token accessors */
export const UNISWAP_V2_PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token0",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token1",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

/** Uniswap V3-style pool — slot0, liquidity, tickSpacing, ticks */
export const UNISWAP_V3_POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "liquidity",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tickSpacing",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fee",
    inputs: [],
    outputs: [{ name: "", type: "uint24" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ticks",
    inputs: [{ name: "tick", type: "int24" }],
    outputs: [
      { name: "liquidityGross", type: "uint128" },
      { name: "liquidityNet", type: "int128" },
      { name: "feeGrowthOutside0X128", type: "uint256" },
      { name: "feeGrowthOutside1X128", type: "uint256" },
      { name: "tickCumulativeOutside", type: "int56" },
      { name: "secondsPerLiquidityOutsideX128", type: "uint160" },
      { name: "secondsOutside", type: "uint32" },
      { name: "initialized", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tickBitmap",
    inputs: [{ name: "wordPosition", type: "int16" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * Velodrome/Solidly V2 pair ABI — similar to Uni V2 but may have `stable()` view.
 * KittenSwap AMM pools use this.
 */
export const VELODROME_PAIR_ABI = [
  ...UNISWAP_V2_PAIR_ABI,
  {
    type: "function",
    name: "stable",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

// ---------------------------------------------------------------------------
// ERC20 Minimal ABI (for auto token creation)
// ---------------------------------------------------------------------------

export const ERC20_METADATA_ABI = [
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

// ---------------------------------------------------------------------------
// Registry — factoryAbiId → ABI + event name mapping
// ---------------------------------------------------------------------------

export interface FactoryAbiEntry {
  abi: readonly Record<string, unknown>[];
  /** The event name to filter for pool creation */
  creationEvent: string;
  /** How to extract pool data from the decoded event */
  parseCreationEvent: (args: Record<string, unknown>) => {
    token0: string;
    token1: string;
    poolAddress: string;
    feeBps?: number;
    tickSpacing?: number;
    isStable?: boolean;
  };
}

export const FACTORY_ABI_REGISTRY: Record<string, FactoryAbiEntry> = {
  "uniswap-v2-factory": {
    abi: UNISWAP_V2_FACTORY_ABI,
    creationEvent: "PairCreated",
    parseCreationEvent: (args) => ({
      token0: args.token0 as string,
      token1: args.token1 as string,
      poolAddress: args.pair as string,
    }),
  },
  "uniswap-v3-factory": {
    abi: UNISWAP_V3_FACTORY_ABI,
    creationEvent: "PoolCreated",
    parseCreationEvent: (args) => ({
      token0: args.token0 as string,
      token1: args.token1 as string,
      poolAddress: args.pool as string,
      feeBps: Math.round(Number(args.fee) / 100), // fee is in hundredths of a bip → bps
      tickSpacing: Number(args.tickSpacing),
    }),
  },
  "velodrome-v1-factory": {
    abi: VELODROME_V1_FACTORY_ABI,
    creationEvent: "PoolCreated",
    parseCreationEvent: (args) => ({
      token0: args.token0 as string,
      token1: args.token1 as string,
      poolAddress: args.pool as string,
      isStable: args.stable as boolean,
    }),
  },
};
