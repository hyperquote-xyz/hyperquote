/**
 * Database connection pool and helpers.
 *
 * Uses `pg` with a single Pool instance shared by all workers.
 * Connection string from DATABASE_URL env var.
 */

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

/**
 * Run a query with automatic logging on error.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  try {
    return await pool.query<T>(text, values);
  } catch (err) {
    console.error("[db] Query error:", (err as Error).message);
    console.error("[db] Query text:", text.slice(0, 200));
    throw err;
  }
}

/**
 * Graceful shutdown — drain all connections.
 */
export async function shutdown(): Promise<void> {
  console.log("[db] Draining pool...");
  await pool.end();
  console.log("[db] Pool drained.");
}

/**
 * Health check — verify connectivity.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
