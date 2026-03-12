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

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});
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

  // ── Summary ──
  const protocolCount = await prisma.protocolRegistry.count();
  const connectorCount = await prisma.protocolConnector.count();
  const tokenCount = await prisma.token.count();
  const poolCount = await prisma.pool.count();
  const ammCount = await prisma.protocolRegistry.count({ where: { kind: "AMM" } });

  console.log("📊 Database summary:");
  console.log(`  Protocols:  ${protocolCount} total (${ammCount} AMM, ${protocolCount - ammCount} other)`);
  console.log(`  Connectors: ${connectorCount}`);
  console.log(`  Tokens:     ${tokenCount}`);
  console.log(`  Pools:      ${poolCount} (populated by Phase 3 discovery)`);
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
