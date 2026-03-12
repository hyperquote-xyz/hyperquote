/**
 * Mock League Data — dev-only visual stress test.
 *
 * Provides realistic dummy data for all league UI edge cases:
 * whales, small traders, NFT boosts, poor reliability, 100% private,
 * tie scenarios, negative improvement, threshold amounts, etc.
 *
 * Activated by NEXT_PUBLIC_LEAGUE_MOCK=true env var.
 * DO NOT import in production paths — tree-shaken when env is unset.
 */

// ---------------------------------------------------------------------------
// Shared types (exported for page.tsx to reuse)
// ---------------------------------------------------------------------------

export interface LeagueEntry {
  rank: number;
  address: string;
  score: number;
  rawScore: number;
  filledNotional: number;
  avgImprovementBps: number;
  privateShare: number;
  fills: number;
  reliability: number | null;
  cancelRate: number | null;
  boostMultiplier: number;
  points: number;
}

export interface KPI {
  totalNotional: number;
  avgImprovementBps: number;
  privateVolumePct: number;
  fillCount: number;
}

export interface LeagueResponse {
  role: "maker" | "taker";
  period: "7d" | "30d" | "all";
  minUsd: number;
  entries: LeagueEntry[];
  totalParticipants: number;
  hasMore: boolean;
  kpi: KPI;
}

export interface ActivityFill {
  txHash: string;
  filledAt: string;
  counterparty: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string | null;
  amountOut: string | null;
  notionalUsd: number | null;
  isPrivate: boolean;
  improvementBps: number | null;
  benchmarkAvailable: boolean;
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

export const MOCK_KPI: KPI = {
  totalNotional: 34_250_000,
  avgImprovementBps: 2.4,
  privateVolumePct: 28.5,
  fillCount: 3847,
};

// ---------------------------------------------------------------------------
// Maker entries (14 rows, pre-sorted by score desc)
// ---------------------------------------------------------------------------

export const MOCK_MAKERS: LeagueEntry[] = [
  {
    rank: 1,
    address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    score: 20_156_250.0,
    rawScore: 13_437_500.0,
    filledNotional: 12_500_000,
    avgImprovementBps: 4.8,
    privateShare: 0.62,
    fills: 847,
    reliability: 0.99,
    cancelRate: 0.01,
    boostMultiplier: 1.5,
    points: 48_320,
  },
  {
    rank: 2,
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    score: 9_036_000.0,
    rawScore: 9_036_000.0,
    filledNotional: 9_000_000,
    avgImprovementBps: 0.4,
    privateShare: 0.18,
    fills: 1203,
    reliability: 0.92,
    cancelRate: 0.06,
    boostMultiplier: 1.0,
    points: 31_450,
  },
  {
    rank: 3,
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
    score: 4_835_560.0,
    rawScore: 2_417_780.0,
    filledNotional: 2_300_000,
    avgImprovementBps: 2.2,
    privateShare: 0.35,
    fills: 312,
    reliability: 0.97,
    cancelRate: 0.03,
    boostMultiplier: 2.0,
    points: 18_790,
  },
  {
    rank: 4,
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    score: 2_334_750.0,
    rawScore: 1_867_800.0,
    filledNotional: 1_800_000,
    avgImprovementBps: 3.1,
    privateShare: 0.41,
    fills: 267,
    reliability: 0.95,
    cancelRate: 0.04,
    boostMultiplier: 1.25,
    points: 12_380,
  },
  {
    rank: 5,
    address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    score: 2_334_750.0,
    rawScore: 1_867_800.0,
    filledNotional: 1_800_000,
    avgImprovementBps: 3.1,
    privateShare: 0.41,
    fills: 265,
    reliability: 0.95,
    cancelRate: 0.04,
    boostMultiplier: 1.25,
    points: 12_210,
  },
  {
    rank: 6,
    address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    score: 1_531_500.0,
    rawScore: 1_531_500.0,
    filledNotional: 1_500_000,
    avgImprovementBps: 1.9,
    privateShare: 1.0,
    fills: 89,
    reliability: 0.94,
    cancelRate: 0.05,
    boostMultiplier: 1.0,
    points: 9_870,
  },
  {
    rank: 7,
    address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    score: 559_275.0,
    rawScore: 372_850.0,
    filledNotional: 350_000,
    avgImprovementBps: 6.5,
    privateShare: 0.28,
    fills: 42,
    reliability: 0.96,
    cancelRate: 0.02,
    boostMultiplier: 1.5,
    points: 4_890,
  },
  {
    rank: 8,
    address: "0x514910771af9ca656af840dff83e8264ecf986ca",
    score: 704_000.0,
    rawScore: 704_000.0,
    filledNotional: 800_000,
    avgImprovementBps: 0.0,
    privateShare: 0.10,
    fills: 156,
    reliability: 0.88,
    cancelRate: 0.10,
    boostMultiplier: 1.0,
    points: 3_520,
  },
  {
    rank: 9,
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    score: 356_000.0,
    rawScore: 356_000.0,
    filledNotional: 500_000,
    avgImprovementBps: 1.2,
    privateShare: 0.15,
    fills: 78,
    reliability: 0.71,
    cancelRate: 0.25,
    boostMultiplier: 1.0,
    points: 2_140,
  },
  {
    rank: 10,
    address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
    score: 537_075.0,
    rawScore: 429_660.0,
    filledNotional: 420_000,
    avgImprovementBps: 2.8,
    privateShare: 0.22,
    fills: 63,
    reliability: 1.0,
    cancelRate: 0.0,
    boostMultiplier: 1.25,
    points: 2_870,
  },
  {
    rank: 11,
    address: "0x4d224452801aced8b2f0aebe155379bb5d594381",
    score: 123_125.0,
    rawScore: 123_125.0,
    filledNotional: 250_000,
    avgImprovementBps: -1.5,
    privateShare: 0.05,
    fills: 34,
    reliability: 0.5,
    cancelRate: 0.45,
    boostMultiplier: 1.0,
    points: 980,
  },
  {
    rank: 12,
    address: "0x3845badade8e6dff049820680d1f14bd3903a5d0",
    score: 163_980.0,
    rawScore: 163_980.0,
    filledNotional: 180_000,
    avgImprovementBps: 1.1,
    privateShare: 0.0,
    fills: 28,
    reliability: 0.91,
    cancelRate: 0.08,
    boostMultiplier: 1.0,
    points: 720,
  },
  {
    rank: 13,
    address: "0xba100000625a3754423978a60c9317c58a424e3d",
    score: 25_200.0,
    rawScore: 25_200.0,
    filledNotional: 25_000,
    avgImprovementBps: 0.8,
    privateShare: 0.12,
    fills: 5,
    reliability: 0.93,
    cancelRate: 0.15,
    boostMultiplier: 1.0,
    points: 145,
  },
  {
    rank: 14,
    address: "0x111111111117dc0aa78b770fa6a738034120c302",
    score: 55_118.0,
    rawScore: 27_559.0,
    filledNotional: 26_500,
    avgImprovementBps: 3.2,
    privateShare: 0.5,
    fills: 3,
    reliability: 0.87,
    cancelRate: 0.20,
    boostMultiplier: 2.0,
    points: 102,
  },
];

// ---------------------------------------------------------------------------
// Taker entries (12 rows, pre-sorted by score desc)
// ---------------------------------------------------------------------------

export const MOCK_TAKERS: LeagueEntry[] = [
  {
    rank: 1,
    address: "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8",
    score: 8_266_667.0,
    rawScore: 8_266_667.0,
    filledNotional: 8_000_000,
    avgImprovementBps: 4.0,
    privateShare: 0.45,
    fills: 523,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 32_150,
  },
  {
    rank: 2,
    address: "0xf977814e90da44bfa03b6295a0616a897441acec",
    score: 5_355_000.0,
    rawScore: 3_570_000.0,
    filledNotional: 3_500_000,
    avgImprovementBps: 2.4,
    privateShare: 0.30,
    fills: 1800,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.5,
    points: 22_480,
  },
  {
    rank: 3,
    address: "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503",
    score: 2_500_000.0,
    rawScore: 1_250_000.0,
    filledNotional: 2_400_000,
    avgImprovementBps: 0.5,
    privateShare: 0.12,
    fills: 345,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 2.0,
    points: 15_670,
  },
  {
    rank: 4,
    address: "0x28c6c06298d514db089934071355e5743bf21d60",
    score: 1_850_000.0,
    rawScore: 1_850_000.0,
    filledNotional: 1_800_000,
    avgImprovementBps: 3.5,
    privateShare: 1.0,
    fills: 67,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 11_340,
  },
  {
    rank: 5,
    address: "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    score: 1_056_250.0,
    rawScore: 845_000.0,
    filledNotional: 1_000_000,
    avgImprovementBps: 1.5,
    privateShare: 0.22,
    fills: 189,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.25,
    points: 7_890,
  },
  {
    rank: 6,
    address: "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
    score: 620_000.0,
    rawScore: 620_000.0,
    filledNotional: 600_000,
    avgImprovementBps: 4.0,
    privateShare: 0.08,
    fills: 112,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 5_430,
  },
  {
    rank: 7,
    address: "0x5a52e96bacdabb82fd05763e25335261b270efcb",
    score: 412_500.0,
    rawScore: 412_500.0,
    filledNotional: 400_000,
    avgImprovementBps: 3.8,
    privateShare: 0.55,
    fills: 48,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 3_210,
  },
  {
    rank: 8,
    address: "0x0716a17fbaee714f1e6ab0f9d59edbc5f09815c0",
    score: 250_000.0,
    rawScore: 250_000.0,
    filledNotional: 250_000,
    avgImprovementBps: 0.0,
    privateShare: 0.0,
    fills: 95,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 1_840,
  },
  {
    rank: 9,
    address: "0xe92d1a43df510f82c66382592a047d288f085809",
    score: 250_000.0,
    rawScore: 250_000.0,
    filledNotional: 240_000,
    avgImprovementBps: 5.0,
    privateShare: 0.35,
    fills: 31,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 1_760,
  },
  {
    rank: 10,
    address: "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
    score: 168_750.0,
    rawScore: 135_000.0,
    filledNotional: 130_000,
    avgImprovementBps: 4.8,
    privateShare: 0.40,
    fills: 22,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.25,
    points: 1_120,
  },
  {
    rank: 11,
    address: "0xca8fa8f0b631ecdb18cda619c4fc9d197c8affca",
    score: 75_000.0,
    rawScore: 75_000.0,
    filledNotional: 75_000,
    avgImprovementBps: -0.5,
    privateShare: 0.0,
    fills: 14,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 380,
  },
  {
    rank: 12,
    address: "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae",
    score: 25_416.67,
    rawScore: 25_416.67,
    filledNotional: 25_000,
    avgImprovementBps: 2.0,
    privateShare: 0.20,
    fills: 4,
    reliability: null,
    cancelRate: null,
    boostMultiplier: 1.0,
    points: 98,
  },
];

// ---------------------------------------------------------------------------
// Activity fills (10 entries for drawer)
// ---------------------------------------------------------------------------

const now = Date.now();
const DAY = 86_400_000;

export const MOCK_ACTIVITY: ActivityFill[] = [
  {
    txHash: "0xabc123def456789012345678901234567890abcdef1234567890abcdef123456",
    filledAt: new Date(now - 1 * DAY).toISOString(),
    counterparty: "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8",
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    amountIn: "250000000000000000000",
    amountOut: "250125000000",
    notionalUsd: 250_000,
    isPrivate: true,
    improvementBps: 5,
    benchmarkAvailable: true,
  },
  {
    txHash: "0xdef456789012345678901234567890abcdef1234567890abcdef12345678abcd",
    filledAt: new Date(now - 2 * DAY).toISOString(),
    counterparty: "0xf977814e90da44bfa03b6295a0616a897441acec",
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "100000000000000000000",
    amountOut: "100050000000",
    notionalUsd: 100_000,
    isPrivate: false,
    improvementBps: 3,
    benchmarkAvailable: true,
  },
  {
    txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    filledAt: new Date(now - 3 * DAY).toISOString(),
    counterparty: "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000001",
    amountIn: "50000000000",
    amountOut: "49980000000000000000",
    notionalUsd: 50_000,
    isPrivate: true,
    improvementBps: -2,
    benchmarkAvailable: true,
  },
  {
    txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    filledAt: new Date(now - 5 * DAY).toISOString(),
    counterparty: "0x28c6c06298d514db089934071355e5743bf21d60",
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    amountIn: "25000000000000000000",
    amountOut: "25010000000",
    notionalUsd: 25_000,
    isPrivate: false,
    improvementBps: 4,
    benchmarkAvailable: true,
  },
  {
    txHash: "0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456",
    filledAt: new Date(now - 7 * DAY).toISOString(),
    counterparty: "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    tokenIn: "0x0000000000000000000000000000000000000003",
    tokenOut: "0x0000000000000000000000000000000000000001",
    amountIn: "5000000000000000000",
    amountOut: "5001000000",
    notionalUsd: 5_000,
    isPrivate: false,
    improvementBps: 2,
    benchmarkAvailable: true,
  },
  {
    txHash: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
    filledAt: new Date(now - 10 * DAY).toISOString(),
    counterparty: "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    amountIn: "150000000000000000000",
    amountOut: "150075000000",
    notionalUsd: 150_000,
    isPrivate: true,
    improvementBps: 5,
    benchmarkAvailable: true,
  },
  {
    txHash: "0x0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba",
    filledAt: new Date(now - 14 * DAY).toISOString(),
    counterparty: "0x5a52e96bacdabb82fd05763e25335261b270efcb",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "500000000",
    amountOut: "500000000000000000",
    notionalUsd: 500,
    isPrivate: false,
    improvementBps: null,
    benchmarkAvailable: false,
  },
  {
    txHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    filledAt: new Date(now - 18 * DAY).toISOString(),
    counterparty: "0x0716a17fbaee714f1e6ab0f9d59edbc5f09815c0",
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    amountIn: "75000000000000000000",
    amountOut: "75000000000",
    notionalUsd: 75_000,
    isPrivate: false,
    improvementBps: 0,
    benchmarkAvailable: true,
  },
  {
    txHash: "0x6666666666666666666666666666666666666666666666666666666666666666",
    filledAt: new Date(now - 22 * DAY).toISOString(),
    counterparty: "0xe92d1a43df510f82c66382592a047d288f085809",
    tokenIn: "0x0000000000000000000000000000000000000003",
    tokenOut: "0x0000000000000000000000000000000000000001",
    amountIn: "10000000000000000000",
    amountOut: "10003000000",
    notionalUsd: 10_000,
    isPrivate: true,
    improvementBps: 3,
    benchmarkAvailable: true,
  },
  {
    txHash: "0x7777777777777777777777777777777777777777777777777777777777777777",
    filledAt: new Date(now - 28 * DAY).toISOString(),
    counterparty: "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    amountIn: "200000000000000000000",
    amountOut: "200100000000",
    notionalUsd: 200_000,
    isPrivate: false,
    improvementBps: 5,
    benchmarkAvailable: true,
  },
];
