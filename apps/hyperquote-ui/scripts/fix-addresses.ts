import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getAddress } from "viem";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const ZERO = "0x0000000000000000000000000000000000000000";

function checksum(addr: string): string {
  return addr === ZERO ? addr : getAddress(addr);
}

async function main() {
  // Step 1: Fix pool token references first (before touching token PKs)
  const pools = await prisma.pool.findMany();
  for (const p of pools) {
    const t0 = checksum(p.token0Addr);
    const t1 = checksum(p.token1Addr);
    if (t0 !== p.token0Addr || t1 !== p.token1Addr) {
      await prisma.pool.update({
        where: { poolId: p.poolId },
        data: { token0Addr: t0, token1Addr: t1 },
      });
      console.log(`Pool ${p.address}: ${p.token0Addr}→${t0} | ${p.token1Addr}→${t1}`);
    }
  }

  // Step 2: Fix token addresses (PK change = delete + create)
  const tokens = await prisma.token.findMany();
  for (const t of tokens) {
    const fixed = checksum(t.address);
    if (fixed !== t.address) {
      const { updatedAt, ...data } = t;
      await prisma.token.delete({ where: { address: t.address } });
      await prisma.token.create({ data: { ...data, address: fixed } });
      console.log(`Token ${t.symbol}: ${t.address} → ${fixed}`);
    }
  }

  console.log("Done");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
