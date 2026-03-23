/**
 * Prisma Client Singleton
 *
 * Standard Next.js pattern: cache PrismaClient on globalThis to survive
 * Hot Module Replacement in development. In production, a single instance
 * is created per server process.
 *
 * Uses PostgreSQL via @prisma/adapter-pg.
 * Set DATABASE_URL in environment:
 *   - Production: postgresql://user:pass@host:5432/dbname?sslmode=require
 *   - Local dev:  postgresql://postgres:postgres@localhost:5432/hyperquote
 *
 * Usage:
 *   import { prisma } from "@/lib/db";
 *   const protocols = await prisma.protocolRegistry.findMany();
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. See .env.example for the required format."
    );
  }

  const adapter = new PrismaPg({ connectionString });
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
