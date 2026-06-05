/**
 * Prisma Client Singleton
 *
 * Uses Neon's HTTP adapter for PostgreSQL queries.
 * Sets a global custom fetch on the Neon driver to force IPv4 connections,
 * working around Node v24 connection issues with multi-IP DNS responses.
 *
 * Usage:
 *   import { prisma } from "@/lib/db";
 *   const rfqs = await prisma.feedRfq.findMany();
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import https from "https";

// Force IPv4 connections to Neon — Node v24's default fetch fails with
// Neon's multi-address DNS due to IPv6/IPv4 fallback timeout issues.
const ipv4Agent = new https.Agent({ keepAlive: true, family: 4 });

neonConfig.fetchFunction = ((url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = typeof url === "string" ? new URL(url) : url instanceof URL ? url : new URL(url.url);
  const body = init?.body ? String(init.body) : undefined;

  return new Promise<Response>((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: init?.method ?? "POST",
        agent: ipv4Agent,
        headers: {
          ...(init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
            ? Object.fromEntries(
                init.headers instanceof Headers
                  ? init.headers.entries()
                  : Object.entries(init.headers as Record<string, string>)
              )
            : {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve(
            new Response(data, {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? "",
              headers: new Headers(
                Object.fromEntries(
                  Object.entries(res.headers).filter(([, v]) => typeof v === "string") as [string, string][]
                )
              ),
            })
          );
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Neon HTTP request timed out")); });
    if (body) req.write(body);
    req.end();
  });
}) as unknown as typeof fetch;

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

  const adapter = new PrismaNeonHttp(connectionString, {
    arrayMode: false,
    fullResults: true,
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
