/**
 * Prisma Client Singleton
 *
 * Standard Next.js pattern: cache PrismaClient on globalThis to survive
 * Hot Module Replacement in development. In production, a single instance
 * is created per server process.
 *
 * Currently uses SQLite (BetterSqlite3 adapter) for local development.
 *
 * PRODUCTION MIGRATION (PostgreSQL):
 *   1. Install adapter: `npm install @prisma/adapter-pg pg`
 *   2. Change prisma/schema.prisma: `provider = "postgresql"`
 *   3. Replace BetterSqlite3 adapter below with PrismaPg adapter
 *   4. Run `npx prisma generate && npx prisma migrate deploy`
 *   5. Set DATABASE_URL to your PostgreSQL connection string
 *
 * Usage:
 *   import { prisma } from "@/lib/db";
 *   const protocols = await prisma.protocolRegistry.findMany();
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || "file:./prisma/dev.db",
  });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
