/**
 * Seed test pools with synthetic state for audit testing.
 * Uses EXACT token addresses as they exist in the DB (from seed.ts).
 */
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Read actual token addresses from DB
  const tokens = await prisma.token.findMany();
  const bySymbol = Object.fromEntries(tokens.map((t) => [t.symbol, t.address]));

  console.log("Token addresses from DB:");
  for (const [sym, addr] of Object.entries(bySymbol)) {
    console.log(`  ${sym}: ${addr}`);
  }

  const HYPE = bySymbol["HYPE"];
  const USDC = bySymbol["USDC"];
  const kHYPE = bySymbol["kHYPE"];
  const USDT = bySymbol["USD₮0"];

  const BLOCK = 27233000n;
  const now = new Date();

  // Pool 1: HyperSwap V2 — HYPE/USDC
  // Reserves: 100K HYPE (18dec) + 2M USDC (6dec)  → price ~20 USDC/HYPE
  const p1 = await prisma.pool.create({
    data: {
      protocol: { connect: { slug: "hyperswap-v2" } },
      poolType: "V2",
      address: "0xTEST_POOL_01_HYPERSWAP_USDC_HYPE_V2",
      token0: { connect: { address: HYPE } },
      token1: { connect: { address: USDC } },
      feeBps: 30,
      createdBlock: 1000000n,
      status: "ACTIVE",
      lastStateBlock: BLOCK,
      lastStateAt: now,
    },
  });
  await prisma.poolStateSnapshot.create({
    data: {
      poolId: p1.poolId,
      blockNumber: BLOCK,
      timestamp: now,
      // 100K HYPE (18 dec) = 100000 * 1e18, 2M USDC (6 dec) = 2000000 * 1e6
      stateJson: JSON.stringify({
        type: "V2",
        reserve0: "100000000000000000000000",
        reserve1: "2000000000000",
      }),
    },
  });
  console.log(`\nPool 1: ${p1.poolId} — HyperSwap V2 HYPE/USDC (100K HYPE / 2M USDC)`);

  // Pool 2: KittenSwap AMM — HYPE/USDC (bigger pool)
  // Reserves: 500K HYPE + 10M USDC  → price ~20 USDC/HYPE
  const p2 = await prisma.pool.create({
    data: {
      protocol: { connect: { slug: "kittenswap-amm" } },
      poolType: "V2",
      address: "0xTEST_POOL_02_KITTEN_USDC_HYPE_V2",
      token0: { connect: { address: HYPE } },
      token1: { connect: { address: USDC } },
      feeBps: 30,
      createdBlock: 1000000n,
      status: "ACTIVE",
      lastStateBlock: BLOCK,
      lastStateAt: now,
    },
  });
  await prisma.poolStateSnapshot.create({
    data: {
      poolId: p2.poolId,
      blockNumber: BLOCK,
      timestamp: now,
      stateJson: JSON.stringify({
        type: "V2",
        reserve0: "500000000000000000000000",
        reserve1: "10000000000000",
      }),
    },
  });
  console.log(`Pool 2: ${p2.poolId} — KittenSwap AMM HYPE/USDC (500K HYPE / 10M USDC)`);

  // Pool 3: HyperSwap V2 — kHYPE/USDC (for 2-hop)
  // Reserves: 200K kHYPE + 4M USDC  → price ~20 USDC/kHYPE
  const p3 = await prisma.pool.create({
    data: {
      protocol: { connect: { slug: "hyperswap-v2" } },
      poolType: "V2",
      address: "0xTEST_POOL_03_HYPERSWAP_USDC_KHYPE_V2",
      token0: { connect: { address: kHYPE } },
      token1: { connect: { address: USDC } },
      feeBps: 30,
      createdBlock: 1000000n,
      status: "ACTIVE",
      lastStateBlock: BLOCK,
      lastStateAt: now,
    },
  });
  await prisma.poolStateSnapshot.create({
    data: {
      poolId: p3.poolId,
      blockNumber: BLOCK,
      timestamp: now,
      stateJson: JSON.stringify({
        type: "V2",
        reserve0: "200000000000000000000000",
        reserve1: "4000000000000",
      }),
    },
  });
  console.log(`Pool 3: ${p3.poolId} — HyperSwap V2 kHYPE/USDC (200K kHYPE / 4M USDC)`);

  // Pool 4: HyperSwap V2 — HYPE/kHYPE (for 2-hop)
  // Reserves: 300K HYPE + 290K kHYPE  → price ~0.967 HYPE/kHYPE
  const p4 = await prisma.pool.create({
    data: {
      protocol: { connect: { slug: "hyperswap-v2" } },
      poolType: "V2",
      address: "0xTEST_POOL_04_HYPERSWAP_HYPE_KHYPE_V2",
      token0: { connect: { address: HYPE } },
      token1: { connect: { address: kHYPE } },
      feeBps: 30,
      createdBlock: 1000000n,
      status: "ACTIVE",
      lastStateBlock: BLOCK,
      lastStateAt: now,
    },
  });
  await prisma.poolStateSnapshot.create({
    data: {
      poolId: p4.poolId,
      blockNumber: BLOCK,
      timestamp: now,
      stateJson: JSON.stringify({
        type: "V2",
        reserve0: "300000000000000000000000",
        reserve1: "290000000000000000000000",
      }),
    },
  });
  console.log(`Pool 4: ${p4.poolId} — HyperSwap V2 HYPE/kHYPE (300K HYPE / 290K kHYPE)`);

  // Pool 5: KittenSwap Stable — USDC/USDT
  // Reserves: 5M USDC + 5M USDT  (stable pool, 0.01% fee)
  const p5 = await prisma.pool.create({
    data: {
      protocol: { connect: { slug: "kittenswap-amm" } },
      poolType: "STABLE",
      address: "0xTEST_POOL_05_KITTEN_USDC_USDT_STABLE",
      token0: { connect: { address: USDC } },
      token1: { connect: { address: USDT } },
      feeBps: 1,
      createdBlock: 1000000n,
      status: "ACTIVE",
      lastStateBlock: BLOCK,
      lastStateAt: now,
    },
  });
  await prisma.poolStateSnapshot.create({
    data: {
      poolId: p5.poolId,
      blockNumber: BLOCK,
      timestamp: now,
      stateJson: JSON.stringify({
        type: "V2",
        reserve0: "5000000000000",
        reserve1: "5000000000000",
        isStable: true,
      }),
    },
  });
  console.log(`Pool 5: ${p5.poolId} — KittenSwap Stable USDC/USDT (5M each)`);

  const counts = {
    pools: await prisma.pool.count(),
    snapshots: await prisma.poolStateSnapshot.count(),
  };
  console.log("\nDB counts:", counts);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
