/**
 * HyperQuote Smart Order Router — Database Seed
 *
 * Seeds:
 *   1. Protocol Registry — Full Hyperliquid L1 DEX universe from DefiLlama
 *   2. Protocol Connectors — Factory addresses + discovery config (for known protocols)
 *   3. Tokens — CORE_TOKENS from src/config/tokens.ts
 *
 * Run: npx prisma db seed
 * Idempotent: uses upsert, safe to run repeatedly.
 *
 * Protocol kinds:
 *   AMM        — Standard pool-based (V2/V3/Stable/CL). Pool discovery enabled.
 *   CLOB       — Central limit order book (Hyperliquid Spot Orderbook).
 *   VAULT      — Vault-based architecture (Balancer V3, Curve).
 *   AGGREGATOR — DEX aggregator (HyperBloom). Not a liquidity source.
 *   CUSTOM     — Non-standard architecture requiring bespoke adapter.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Protocol definitions — Full DefiLlama Hyperliquid L1 DEX universe
// ---------------------------------------------------------------------------

type ProtocolKind = "AMM" | "CLOB" | "VAULT" | "AGGREGATOR" | "CUSTOM";

interface ProtocolSeed {
  slug: string;
  name: string;
  category: string;
  kind: ProtocolKind;
  defillamaSlug: string; // slug on DefiLlama (for TVL sync)
  tvlUsd?: number; // Snapshot TVL from DefiLlama
  chains: number[];
  connector?: {
    discoveryMethod: string;
    factoryAddresses: Record<string, string>;
    factoryAbiId: string;
    poolTypeHint?: Record<string, string>;
  };
}

const PROTOCOLS: ProtocolSeed[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // TIER 1 — VAULT / CLOB (visible but excluded from AMM routing)
  // ═══════════════════════════════════════════════════════════════════════

  {
    slug: "curve-dex",
    name: "Curve DEX",
    category: "Dexes",
    kind: "VAULT", // StableSwap/CryptoSwap — Vyper, not pool-per-contract AMM
    defillamaSlug: "curve-dex",
    tvlUsd: 1_917_277_480,
    chains: [999],
    // No connector yet — factory address on HyperEVM unknown
  },
  {
    slug: "hyperliquid-spot-orderbook",
    name: "Hyperliquid Spot Orderbook",
    category: "Dexes",
    kind: "CLOB",
    defillamaSlug: "hyperliquid-spot-orderbook",
    tvlUsd: 173_585_222,
    chains: [999],
    // Not an AMM — CLOB on HyperCore, not HyperEVM
  },
  {
    slug: "balancer-v3",
    name: "Balancer V3",
    category: "Dexes",
    kind: "VAULT", // Vault-based, not per-pool AMM
    defillamaSlug: "balancer-v3",
    tvlUsd: 109_471_371,
    chains: [999],
    // No connector yet — vault architecture requires custom adapter
  },

  // ═══════════════════════════════════════════════════════════════════════
  // TIER 2 — CUSTOM (AMM but non-standard, needs bespoke adapter)
  // ═══════════════════════════════════════════════════════════════════════

  {
    slug: "project-x",
    name: "Project X",
    category: "Dexes",
    kind: "CUSTOM", // V4 singleton, not per-pool
    defillamaSlug: "project-x",
    tvlUsd: 44_314_398,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "uniswap-v4-singleton",
      poolTypeHint: { default: "CUSTOM" },
    },
  },
  {
    slug: "ring-few",
    name: "Ring Few",
    category: "Dexes",
    kind: "CUSTOM", // ve(3,3) DEX, non-standard
    defillamaSlug: "ring-few",
    tvlUsd: 40_655_472,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "unknown",
    },
  },
  {
    slug: "valantis-stex",
    name: "Valantis STEX",
    category: "Dexes",
    kind: "CUSTOM", // Sovereign pools with modular ALM
    defillamaSlug: "valantis-stex",
    tvlUsd: 17_412_994,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "valantis-sovereign",
      poolTypeHint: { default: "CUSTOM" },
    },
  },
  {
    slug: "woofi-swap",
    name: "WOOFi Swap",
    category: "Dexes",
    kind: "CUSTOM", // Synthetic proactive market-making
    defillamaSlug: "woofi-swap",
    tvlUsd: 6_103_398,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "woofi-woopool",
    },
  },
  {
    slug: "nabla-finance",
    name: "Nabla Finance",
    category: "Dexes",
    kind: "CUSTOM", // single-sided LP, oracle-based pricing
    defillamaSlug: "nabla-finance",
    tvlUsd: 541_832,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "unknown",
    },
  },
  {
    slug: "brownfi",
    name: "BrownFi",
    category: "Dexes",
    kind: "CUSTOM",
    defillamaSlug: "brownfi",
    tvlUsd: 248_122,
    chains: [999],
  },
  {
    slug: "skate-amm",
    name: "Skate AMM",
    category: "Dexes",
    kind: "CUSTOM",
    defillamaSlug: "skate-amm",
    tvlUsd: 232_900,
    chains: [999],
  },
  {
    slug: "gliquid",
    name: "Gliquid",
    category: "Dexes",
    kind: "CUSTOM", // Native liquidity protocol
    defillamaSlug: "gliquid",
    tvlUsd: 25_387,
    chains: [999],
  },
  {
    slug: "hyperbrick",
    name: "HyperBrick",
    category: "Dexes",
    kind: "CUSTOM", // Zero-slippage AMM with surge pricing
    defillamaSlug: "hyperbrick",
    tvlUsd: 21_040,
    chains: [999],
  },
  {
    slug: "hx-finance",
    name: "HX Finance",
    category: "Dexes",
    kind: "CUSTOM",
    defillamaSlug: "hx-finance",
    tvlUsd: 5_948,
    chains: [999],
  },
  {
    slug: "manaswap",
    name: "ManaSwap",
    category: "Dexes",
    kind: "CUSTOM",
    defillamaSlug: "manaswap",
    tvlUsd: 19_269,
    chains: [999],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // TIER 3 — AMM (standard pool-based, pool discovery applicable)
  // ═══════════════════════════════════════════════════════════════════════

  // ── HyperSwap — Uniswap V2/V3 forks ──
  {
    slug: "hyperswap-v3",
    name: "HyperSwap V3",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hyperswap-v3",
    tvlUsd: 10_169_087,
    chains: [999],
    connector: {
      discoveryMethod: "FACTORY_EVENTS",
      factoryAddresses: {
        v3: "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3",
        startBlock: "2000000",
      },
      factoryAbiId: "uniswap-v3-factory",
      poolTypeHint: { default: "V3" },
    },
  },
  {
    slug: "hyperswap-v2",
    name: "HyperSwap V2",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hyperswap-v2",
    tvlUsd: 2_864_782,
    chains: [999],
    connector: {
      discoveryMethod: "FACTORY_EVENTS",
      factoryAddresses: {
        v2: "0x724412c00059bf7d6ee7d4a1d0d5cd4de3ea1c48",
        startBlock: "500000",
      },
      factoryAbiId: "uniswap-v2-factory",
      poolTypeHint: { default: "V2" },
    },
  },

  // ── NEST — Appears to be a V2/V3 fork ──
  {
    slug: "nest-v1",
    name: "NEST V1",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "nest-v1",
    tvlUsd: 3_895_684,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "unknown",
    },
  },
  {
    slug: "nest-v2",
    name: "NEST V2",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "nest-v2",
    tvlUsd: 122_536,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "unknown",
    },
  },

  // ── Ramses — ve(3,3) + CL on HyperEVM ──
  {
    slug: "ramses-cl",
    name: "Ramses CL",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "ramses-cl",
    tvlUsd: 3_020_623,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "algebra-factory", // Algebra Integral based
    },
  },
  {
    slug: "ramses-hl",
    name: "Ramses HL",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "ramses-hl",
    tvlUsd: 2_867_124,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "velodrome-v2-factory", // ve(3,3) Solidly fork
    },
  },
  {
    slug: "ramses-legacy",
    name: "Ramses Legacy",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "ramses-legacy",
    tvlUsd: 159_933,
    chains: [999],
  },
  {
    slug: "ramses-hl-legacy",
    name: "Ramses HL Legacy",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "ramses-hl-legacy",
    tvlUsd: 47_422,
    chains: [999],
  },

  // ── Hybra — Uniswap V2/V3/V4 forks ──
  {
    slug: "hybra-v4",
    name: "Hybra V4",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hybra-v4",
    tvlUsd: 1_703_890,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "uniswap-v4-hooks", // V4-style with dynamic fees + ve(3,3)
    },
  },
  {
    slug: "hybra-v3",
    name: "Hybra V3",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hybra-v3",
    tvlUsd: 653_667,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "uniswap-v3-factory", // Unmodified V3 contracts
    },
  },
  {
    slug: "hybra-v2",
    name: "Hybra V2",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hybra-v2",
    tvlUsd: 5_709,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "uniswap-v2-factory",
    },
  },

  // ── KittenSwap — Velodrome/Algebra forks ──
  {
    slug: "kittenswap-algebra",
    name: "Kittenswap Algebra",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "kittenswap-algebra",
    tvlUsd: 1_181_853,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "algebra-factory",
    },
  },
  {
    slug: "kittenswap-cl",
    name: "Kittenswap CL",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "kittenswap-cl",
    tvlUsd: 635_531,
    chains: [999],
    connector: {
      discoveryMethod: "FACTORY_EVENTS",
      factoryAddresses: {
        v3: "0x2e08f5ff603e4343864b14599caedb19918bdcaf",
        startBlock: "2033100",
      },
      factoryAbiId: "algebra-factory", // FIXED: was uniswap-v3-factory, actually Algebra Integral
      poolTypeHint: { default: "V3" },
    },
  },
  {
    slug: "kittenswap-amm",
    name: "Kittenswap AMM",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "kittenswap-amm",
    tvlUsd: 465_748,
    chains: [999],
    connector: {
      discoveryMethod: "FACTORY_EVENTS",
      factoryAddresses: {
        v2: "0xda12f450580a4cc485c3b501bab7b0b3cbc3b31b",
        startBlock: "1000000",
      },
      factoryAbiId: "velodrome-v1-factory",
      poolTypeHint: { default: "V2" },
    },
  },

  // ── Ultrasolid — ve(3,3) protocol ──
  {
    slug: "ultrasolid-v3",
    name: "Ultrasolid V3",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "ultrasolid-v3",
    tvlUsd: 778_194,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "unknown",
    },
  },
  {
    slug: "ultrasolid-v2",
    name: "Ultrasolid V2",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "ultrasolid-v2",
    tvlUsd: 40,
    chains: [999],
  },

  // ── Upheaval — V2/V3 forks ──
  {
    slug: "upheaval-v3",
    name: "Upheaval V3",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "upheaval-v3",
    tvlUsd: 633_590,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "uniswap-v3-factory",
    },
  },
  {
    slug: "upheaval-v2",
    name: "Upheaval V2",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "upheaval-v2",
    tvlUsd: 73,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "uniswap-v2-factory",
    },
  },

  // ── Hypertrade — V2/V3 forks ──
  {
    slug: "hypertrade-v3",
    name: "Hypertrade V3",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hypertrade-v3",
    tvlUsd: 151_081,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "uniswap-v3-factory",
    },
  },
  {
    slug: "hypertrade-v2",
    name: "Hypertrade V2",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hypertrade-v2",
    tvlUsd: 0,
    chains: [999],
  },

  // ── SpinUp ──
  {
    slug: "spinup-dex",
    name: "SpinUp DEX",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "spinup-dex",
    tvlUsd: 183_271,
    chains: [999],
  },

  // ── Laminar — Uniswap V3 fork (discontinued but pools still live) ──
  {
    slug: "laminar",
    name: "Laminar",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "laminar",
    tvlUsd: 70_413,
    chains: [999],
    connector: {
      discoveryMethod: "FACTORY_EVENTS",
      factoryAddresses: {
        v3: "0x40059a6f242c3de0e639693973004921b04d96ad",
        startBlock: "500000",
      },
      factoryAbiId: "uniswap-v3-factory",
      poolTypeHint: { default: "V3" },
    },
  },

  // ── HyperCat — Algebra Integral ──
  {
    slug: "hypercat",
    name: "HyperCat",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "hypercat",
    tvlUsd: 1_007,
    chains: [999],
    connector: {
      discoveryMethod: "MANUAL_REQUIRED",
      factoryAddresses: {},
      factoryAbiId: "algebra-factory",
    },
  },

  // ── Ring Swap ──
  {
    slug: "ring-swap",
    name: "Ring Swap",
    category: "Dexes",
    kind: "AMM",
    defillamaSlug: "ring-swap",
    tvlUsd: 149,
    chains: [999],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AGGREGATORS (not a liquidity source, excluded from routing)
  // ═══════════════════════════════════════════════════════════════════════

  {
    slug: "hyperbloom",
    name: "HyperBloom",
    category: "Dex Aggregator",
    kind: "AGGREGATOR",
    defillamaSlug: "hyperbloom",
    tvlUsd: 137_909,
    chains: [999],
  },
];

// ---------------------------------------------------------------------------
// Token definitions (from CORE_TOKENS in src/config/tokens.ts)
// ---------------------------------------------------------------------------

interface TokenSeed {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isIntermediateAllowed: boolean;
  tags: string[];
}

const TOKENS: TokenSeed[] = [
  {
    address: "0x0000000000000000000000000000000000000000",
    symbol: "HYPE",
    name: "HyperEVM Native Token",
    decimals: 18,
    isIntermediateAllowed: true,
    tags: ["core", "native"],
  },
  {
    address: "0xb88339cb7199b77e23db6e890353e22632ba630f",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    isIntermediateAllowed: true,
    tags: ["core", "stable"],
  },
  {
    address: "0xfd739d4e423301ce9385c1fb8850539d657c296d",
    symbol: "kHYPE",
    name: "Kinetiq kHYPE",
    decimals: 18,
    isIntermediateAllowed: true,
    tags: ["core", "staked"],
  },
  {
    address: "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb",
    symbol: "USD₮0",
    name: "USD₮0",
    decimals: 6,
    isIntermediateAllowed: true,
    tags: ["core", "stable"],
  },
  {
    address: "0x9fdbda0a5e284c32744d2f17ee5c74b284993463",
    symbol: "UBTC",
    name: "Unit Bitcoin",
    decimals: 8,
    isIntermediateAllowed: true,
    tags: ["core", "unit"],
  },
  {
    address: "0xbe6727b535545c67d5caa73dea54865b92cf7907",
    symbol: "UETH",
    name: "Unit Ethereum",
    decimals: 18,
    isIntermediateAllowed: true,
    tags: ["core", "unit"],
  },
  {
    address: "0x068f321fa8fb9f0d135f290ef6a3e2813e1c8a29",
    symbol: "USOL",
    name: "Unit Solana",
    decimals: 9,
    isIntermediateAllowed: true,
    tags: ["core", "unit"],
  },
  {
    address: "0x33af3c2540ba72054e044efe504867b39ae421f5",
    symbol: "UXPL",
    name: "Unit Plasma",
    decimals: 18,
    isIntermediateAllowed: false, // No HL spot market
    tags: ["core", "unit"],
  },
  {
    address: "0x58538e6a46e07434d7e7375bc268d3cb839c0133",
    symbol: "UENA",
    name: "Unit Ethena",
    decimals: 18,
    isIntermediateAllowed: true,
    tags: ["core", "unit"],
  },
  {
    address: "0x27ec642013bcb3d80ca3706599d3cda04f6f4452",
    symbol: "UPUMP",
    name: "Unit Pump Fun",
    decimals: 6,
    isIntermediateAllowed: true,
    tags: ["core", "unit"],
  },
  {
    address: "0x3b4575e689ded21caad31d64c4df1f10f3b2cedf",
    symbol: "UFART",
    name: "Unit Fartcoin",
    decimals: 6,
    isIntermediateAllowed: true,
    tags: ["core", "unit"],
  },
];

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

async function main() {
  console.log("🌱 Seeding HyperQuote Smart Order Router database...\n");

  // ── Protocols + Connectors ──
  console.log("📦 Seeding protocols...");
  const kindCounts: Record<string, number> = {};
  for (const p of PROTOCOLS) {
    kindCounts[p.kind] = (kindCounts[p.kind] ?? 0) + 1;

    const protocol = await prisma.protocolRegistry.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        category: p.category,
        kind: p.kind,
        chains: JSON.stringify(p.chains),
        tvlUsd: p.tvlUsd ?? null,
        defillamaSlug: p.defillamaSlug,
      },
      create: {
        slug: p.slug,
        name: p.name,
        category: p.category,
        kind: p.kind,
        chains: JSON.stringify(p.chains),
        tvlUsd: p.tvlUsd ?? null,
        defillamaSlug: p.defillamaSlug,
        status: "ACTIVE",
      },
    });

    const kindTag = p.kind.padEnd(10);
    const tvlTag = p.tvlUsd ? `$${(p.tvlUsd / 1e6).toFixed(1)}M` : "—";
    console.log(`  ✓ [${kindTag}] ${protocol.slug.padEnd(28)} ${tvlTag.padStart(10)}`);

    // Connector (only for protocols with known factory config)
    if (p.connector) {
      await prisma.protocolConnector.upsert({
        where: { slug: p.slug },
        update: {
          discoveryMethod: p.connector.discoveryMethod,
          factoryAddresses: JSON.stringify(p.connector.factoryAddresses),
          factoryAbiId: p.connector.factoryAbiId,
          poolTypeHint: p.connector.poolTypeHint
            ? JSON.stringify(p.connector.poolTypeHint)
            : null,
        },
        create: {
          slug: p.slug,
          discoveryMethod: p.connector.discoveryMethod,
          factoryAddresses: JSON.stringify(p.connector.factoryAddresses),
          factoryAbiId: p.connector.factoryAbiId,
          poolTypeHint: p.connector.poolTypeHint
            ? JSON.stringify(p.connector.poolTypeHint)
            : null,
        },
      });
    }
  }
  console.log(`  → ${PROTOCOLS.length} protocols seeded`);
  console.log(`    By kind: ${Object.entries(kindCounts).map(([k, v]) => `${k}=${v}`).join(", ")}\n`);

  // ── Tokens ──
  console.log("🪙 Seeding tokens...");
  for (const t of TOKENS) {
    const token = await prisma.token.upsert({
      where: { address: t.address },
      update: {
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        isIntermediateAllowed: t.isIntermediateAllowed,
        tags: JSON.stringify(t.tags),
      },
      create: {
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        isIntermediateAllowed: t.isIntermediateAllowed,
        tags: JSON.stringify(t.tags),
      },
    });
    console.log(
      `  ✓ ${token.symbol.padEnd(8)} ${token.address.slice(0, 10)}... (${token.decimals} dec, intermediate=${token.isIntermediateAllowed})`
    );
  }
  console.log(`  → ${TOKENS.length} tokens seeded\n`);

  // ── Dummy FeedFills (drives /league API) ──
  console.log("📊 Seeding FeedFill records...");

  const WALLETS = {
    // Makers
    M1: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    M2: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    M3: "0x6b175474e89094c44da98b954eedeac495271d0f",
    M4: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    M5: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    // Takers
    T1: "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8",
    T2: "0xf977814e90da44bfa03b6295a0616a897441acec",
    T3: "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503",
    T4: "0x28c6c06298d514db089934071355e5743bf21d60",
    T5: "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
  };

  const TOKEN_IN = "0xb88339cb7199b77e23db6e890353e22632ba630f"; // USDC
  const TOKEN_OUT = "0x0000000000000000000000000000000000000000"; // HYPE

  const now = Date.now();
  const DAY = 86_400_000;

  interface FeedFillSeed {
    maker: string;
    taker: string;
    notionalUsd: number;
    improvementBps: number;
    isPrivate: boolean;
    daysAgo: number;
  }

  const FEED_FILL_DEFS: FeedFillSeed[] = [
    // M1 fills — whale maker, consistently good
    { maker: WALLETS.M1, taker: WALLETS.T1, notionalUsd: 2_500_000, improvementBps: 5, isPrivate: true, daysAgo: 1 },
    { maker: WALLETS.M1, taker: WALLETS.T2, notionalUsd: 1_800_000, improvementBps: 4, isPrivate: false, daysAgo: 2 },
    { maker: WALLETS.M1, taker: WALLETS.T3, notionalUsd: 3_200_000, improvementBps: 6, isPrivate: true, daysAgo: 3 },
    { maker: WALLETS.M1, taker: WALLETS.T4, notionalUsd: 500_000, improvementBps: 3, isPrivate: false, daysAgo: 5 },
    { maker: WALLETS.M1, taker: WALLETS.T5, notionalUsd: 4_500_000, improvementBps: 5, isPrivate: true, daysAgo: 7 },
    // M2 fills — high volume, lower improvement
    { maker: WALLETS.M2, taker: WALLETS.T1, notionalUsd: 1_200_000, improvementBps: 1, isPrivate: false, daysAgo: 1 },
    { maker: WALLETS.M2, taker: WALLETS.T2, notionalUsd: 2_000_000, improvementBps: 0, isPrivate: false, daysAgo: 2 },
    { maker: WALLETS.M2, taker: WALLETS.T3, notionalUsd: 800_000, improvementBps: 1, isPrivate: false, daysAgo: 4 },
    { maker: WALLETS.M2, taker: WALLETS.T5, notionalUsd: 5_000_000, improvementBps: 0, isPrivate: false, daysAgo: 6 },
    // M3 fills — mid-size, good improvement, private heavy
    { maker: WALLETS.M3, taker: WALLETS.T1, notionalUsd: 750_000, improvementBps: 3, isPrivate: true, daysAgo: 1 },
    { maker: WALLETS.M3, taker: WALLETS.T4, notionalUsd: 500_000, improvementBps: 2, isPrivate: true, daysAgo: 3 },
    { maker: WALLETS.M3, taker: WALLETS.T2, notionalUsd: 1_050_000, improvementBps: 2, isPrivate: false, daysAgo: 5 },
    // M4 fills — reliable, steady
    { maker: WALLETS.M4, taker: WALLETS.T3, notionalUsd: 400_000, improvementBps: 3, isPrivate: false, daysAgo: 2 },
    { maker: WALLETS.M4, taker: WALLETS.T1, notionalUsd: 600_000, improvementBps: 4, isPrivate: true, daysAgo: 4 },
    { maker: WALLETS.M4, taker: WALLETS.T5, notionalUsd: 800_000, improvementBps: 2, isPrivate: true, daysAgo: 6 },
    // M5 fills — same as M4 (tie scenario)
    { maker: WALLETS.M5, taker: WALLETS.T2, notionalUsd: 400_000, improvementBps: 3, isPrivate: false, daysAgo: 2 },
    { maker: WALLETS.M5, taker: WALLETS.T4, notionalUsd: 600_000, improvementBps: 4, isPrivate: true, daysAgo: 4 },
    { maker: WALLETS.M5, taker: WALLETS.T3, notionalUsd: 800_000, improvementBps: 2, isPrivate: true, daysAgo: 7 },
    // Extra fills for taker diversity
    { maker: WALLETS.M1, taker: WALLETS.T1, notionalUsd: 150_000, improvementBps: 2, isPrivate: false, daysAgo: 10 },
    { maker: WALLETS.M2, taker: WALLETS.T4, notionalUsd: 75_000, improvementBps: 1, isPrivate: false, daysAgo: 14 },
    { maker: WALLETS.M3, taker: WALLETS.T5, notionalUsd: 25_000, improvementBps: 5, isPrivate: true, daysAgo: 20 },
    { maker: WALLETS.M4, taker: WALLETS.T2, notionalUsd: 300_000, improvementBps: 3, isPrivate: false, daysAgo: 25 },
    { maker: WALLETS.M5, taker: WALLETS.T1, notionalUsd: 1_000_000, improvementBps: 4, isPrivate: true, daysAgo: 28 },
  ];

  // Delete existing seed data (idempotent re-runs)
  await prisma.feedFill.deleteMany({});
  await prisma.fill.deleteMany({});
  await prisma.feedRfq.deleteMany({});

  for (let i = 0; i < FEED_FILL_DEFS.length; i++) {
    const d = FEED_FILL_DEFS[i];
    const idx = (i + 1).toString().padStart(3, "0");
    const filledAt = new Date(now - d.daysAgo * DAY);
    const txHash = `0x${idx.repeat(21).slice(0, 64)}`;

    await prisma.feedFill.create({
      data: {
        rfqId: `seed-rfq-${idx}`,
        txHash,
        filledAt,
        maker: d.maker,
        taker: d.taker,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        amountIn: (d.notionalUsd * 1e6).toString(),
        amountOut: ((d.notionalUsd / 25) * 1e18).toString(),
        notionalUsd: d.notionalUsd,
        isPrivate: d.isPrivate,
        benchmarkSource: "sor",
        benchmarkOut: (((d.notionalUsd / 25) * (1 - d.improvementBps / 10000)) * 1e18).toString(),
        improvementBps: d.improvementBps,
        benchmarkAvailable: true,
      },
    });
    console.log(`  ✓ FeedFill ${idx}: ${d.maker.slice(0, 8)}→${d.taker.slice(0, 8)} $${(d.notionalUsd / 1e6).toFixed(2)}M`);
  }
  console.log(`  → ${FEED_FILL_DEFS.length} FeedFill records seeded\n`);

  // ── Dummy Fill records (drives /leaderboard/points API) ──
  console.log("📊 Seeding Fill records...");

  for (let i = 0; i < FEED_FILL_DEFS.length; i++) {
    const d = FEED_FILL_DEFS[i];
    const idx = (i + 1).toString().padStart(3, "0");
    const timestamp = new Date(now - d.daysAgo * DAY);
    const txHash = `0xf${idx.repeat(21).slice(0, 63)}`;

    // Simple points formula: notional / 100 * (1 + improvementBps/10)
    const basePoints = (d.notionalUsd / 100) * (1 + d.improvementBps / 10);

    await prisma.fill.create({
      data: {
        txHash,
        rfqId: `seed-rfq-${idx}`,
        timestamp,
        taker: d.taker,
        maker: d.maker,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        amountIn: (d.notionalUsd * 1e6).toString(),
        amountOut: ((d.notionalUsd / 25) * 1e18).toString(),
        amountInUsd: d.notionalUsd,
        baselineOut: (((d.notionalUsd / 25) * (1 - d.improvementBps / 10000)) * 1e18).toString(),
        improvementBps: d.improvementBps,
        takerPoints: basePoints * 0.4,
        makerPoints: basePoints * 0.6,
      },
    });
    console.log(`  ✓ Fill ${idx}: $${(d.notionalUsd / 1e6).toFixed(2)}M → maker=${Math.round(basePoints * 0.6)}pts taker=${Math.round(basePoints * 0.4)}pts`);
  }
  console.log(`  → ${FEED_FILL_DEFS.length} Fill records seeded\n`);

  // ── Dummy FeedRfq records (drives /feed page + cancel rates) ──
  console.log("📊 Seeding FeedRfq records...");

  const USDC_TOKEN_JSON = JSON.stringify({ address: TOKEN_IN, symbol: "USDC", decimals: 6 });
  const HYPE_TOKEN_JSON = JSON.stringify({ address: TOKEN_OUT, symbol: "HYPE", decimals: 18 });

  type RfqStatus = "OPEN" | "QUOTED" | "FILLED" | "EXPIRED" | "KILLED";

  interface FeedRfqSeed {
    taker: string;
    status: RfqStatus;
    amountUsd: number;
    quoteCount: number;
    secsAgo: number;
    ttlSecs: number;
  }

  const FEED_RFQ_DEFS: FeedRfqSeed[] = [
    // Open RFQs
    { taker: WALLETS.T1, status: "OPEN", amountUsd: 250_000, quoteCount: 3, secsAgo: 5, ttlSecs: 45 },
    { taker: WALLETS.T2, status: "OPEN", amountUsd: 50_000, quoteCount: 1, secsAgo: 12, ttlSecs: 60 },
    { taker: WALLETS.T3, status: "OPEN", amountUsd: 500_000, quoteCount: 5, secsAgo: 8, ttlSecs: 120 },
    { taker: WALLETS.T4, status: "OPEN", amountUsd: 100_000, quoteCount: 2, secsAgo: 20, ttlSecs: 90 },
    { taker: WALLETS.T5, status: "OPEN", amountUsd: 25_000, quoteCount: 0, secsAgo: 3, ttlSecs: 30 },
    // Quoted
    { taker: WALLETS.T1, status: "QUOTED", amountUsd: 75_000, quoteCount: 4, secsAgo: 30, ttlSecs: 60 },
    { taker: WALLETS.T3, status: "QUOTED", amountUsd: 2_500_000, quoteCount: 6, secsAgo: 10, ttlSecs: 120 },
    // Filled
    { taker: WALLETS.T1, status: "FILLED", amountUsd: 1_000_000, quoteCount: 7, secsAgo: 60, ttlSecs: 90 },
    { taker: WALLETS.T2, status: "FILLED", amountUsd: 750_000, quoteCount: 5, secsAgo: 120, ttlSecs: 60 },
    { taker: WALLETS.T3, status: "FILLED", amountUsd: 5_000_000, quoteCount: 9, secsAgo: 300, ttlSecs: 120 },
    { taker: WALLETS.T4, status: "FILLED", amountUsd: 500_000, quoteCount: 3, secsAgo: 180, ttlSecs: 90 },
    { taker: WALLETS.T5, status: "FILLED", amountUsd: 50_000, quoteCount: 4, secsAgo: 900, ttlSecs: 45 },
    // Expired
    { taker: WALLETS.T1, status: "EXPIRED", amountUsd: 75_000, quoteCount: 0, secsAgo: 400, ttlSecs: 60 },
    { taker: WALLETS.T2, status: "EXPIRED", amountUsd: 150_000, quoteCount: 2, secsAgo: 500, ttlSecs: 90 },
    { taker: WALLETS.T4, status: "EXPIRED", amountUsd: 250_000, quoteCount: 1, secsAgo: 700, ttlSecs: 120 },
    // Killed (drives cancel rate for taker addresses)
    { taker: WALLETS.T3, status: "KILLED", amountUsd: 1_000_000, quoteCount: 5, secsAgo: 200, ttlSecs: 90 },
    { taker: WALLETS.T5, status: "KILLED", amountUsd: 50_000, quoteCount: 1, secsAgo: 150, ttlSecs: 45 },
  ];

  for (let i = 0; i < FEED_RFQ_DEFS.length; i++) {
    const d = FEED_RFQ_DEFS[i];
    const idx = (i + 1).toString().padStart(3, "0");
    const createdAt = new Date(now - d.secsAgo * 1000);
    const expiry = Math.floor(now / 1000) + (d.ttlSecs - d.secsAgo);
    const rawAmount = (d.amountUsd * 1e6).toString();

    await prisma.feedRfq.create({
      data: {
        id: `seed-feed-rfq-${idx}`,
        taker: d.taker,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        tokenInJson: USDC_TOKEN_JSON,
        tokenOutJson: HYPE_TOKEN_JSON,
        kind: 0,
        amountIn: rawAmount,
        expiry,
        status: d.status,
        quoteCount: d.quoteCount,
        visibility: "public",
        fillTxHash: d.status === "FILLED" ? `0xe${idx.repeat(21).slice(0, 63)}` : null,
        createdAt,
      },
    });
    console.log(`  ✓ FeedRfq ${idx}: ${d.status.padEnd(7)} $${(d.amountUsd / 1e3).toFixed(0)}K from ${d.taker.slice(0, 8)}`);
  }
  console.log(`  → ${FEED_RFQ_DEFS.length} FeedRfq records seeded\n`);

  // ── Summary ──
  const protocolCount = await prisma.protocolRegistry.count();
  const connectorCount = await prisma.protocolConnector.count();
  const tokenCount = await prisma.token.count();
  const poolCount = await prisma.pool.count();
  const ammCount = await prisma.protocolRegistry.count({ where: { kind: "AMM" } });

  const feedFillCount = await prisma.feedFill.count();
  const fillCount = await prisma.fill.count();
  const feedRfqCount = await prisma.feedRfq.count();

  console.log("📊 Database summary:");
  console.log(`  Protocols:  ${protocolCount} total (${ammCount} AMM, ${protocolCount - ammCount} other)`);
  console.log(`  Connectors: ${connectorCount}`);
  console.log(`  Tokens:     ${tokenCount}`);
  console.log(`  Pools:      ${poolCount} (populated by Phase 3 discovery)`);
  console.log(`  FeedFills:  ${feedFillCount} (league data)`);
  console.log(`  Fills:      ${fillCount} (points/leaderboard data)`);
  console.log(`  FeedRfqs:   ${feedRfqCount} (feed + cancel rates)`);
  console.log("\n✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
