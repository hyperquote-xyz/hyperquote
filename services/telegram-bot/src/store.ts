/**
 * SQLite persistence layer for Telegram→Agent user links.
 *
 * Uses better-sqlite3 for synchronous access (no async overhead for
 * simple key-value lookups). API keys are encrypted at rest with
 * AES-256-GCM using TELEGRAM_BOT_ENCRYPTION_KEY env var.
 */

import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import type {
  LinkedUser,
  LinkedUserRow,
  EncryptedKey,
  AlertEventType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "..", "data", "telegram-bot.db");
const ENCRYPTION_KEY = process.env.TELEGRAM_BOT_ENCRYPTION_KEY ?? "";

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

let db: Database.Database;

export function initStore(): void {
  // Ensure data directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS linked_users (
      telegram_user_id   TEXT PRIMARY KEY,
      telegram_username  TEXT,
      agent_id           TEXT NOT NULL,
      agent_wallet       TEXT NOT NULL,
      api_key_encrypted  TEXT NOT NULL,
      api_key_iv         TEXT NOT NULL,
      api_key_tag        TEXT NOT NULL,

      filter_tokens      TEXT DEFAULT '[]',
      filter_min_usd     REAL DEFAULT 0,
      filter_visibility  TEXT DEFAULT 'all',
      filter_side        TEXT DEFAULT 'all',
      filter_event_types TEXT DEFAULT '["rfq.created","rfq.filled"]',
      alerts_enabled     INTEGER DEFAULT 1,

      linked_at   TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_linked_users_agent
      ON linked_users(agent_id);
  `);

  console.log(`[store] Database ready at ${DB_PATH}`);
}

export function closeStore(): void {
  if (db) {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------

function getEncryptionKey(): Buffer {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 64) {
    throw new Error(
      "TELEGRAM_BOT_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)"
    );
  }
  return Buffer.from(ENCRYPTION_KEY, "hex");
}

export function encryptApiKey(plaintext: string): EncryptedKey {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

export function decryptApiKey(encrypted: EncryptedKey): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, "hex");
  const tag = Buffer.from(encrypted.tag, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted.ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

function parseRow(row: LinkedUserRow): LinkedUser {
  let filterTokens: string[] = [];
  let filterEventTypes: AlertEventType[] = ["rfq.created", "rfq.filled"];

  try {
    filterTokens = JSON.parse(row.filter_tokens);
  } catch { /* use default */ }

  try {
    const parsed = JSON.parse(row.filter_event_types);
    if (Array.isArray(parsed) && parsed.length > 0) {
      filterEventTypes = parsed.filter(
        (t: string) => t === "rfq.created" || t === "rfq.filled"
      ) as AlertEventType[];
    }
  } catch { /* use default */ }

  return {
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    agentId: row.agent_id,
    agentWallet: row.agent_wallet,
    apiKeyEncrypted: row.api_key_encrypted,
    apiKeyIv: row.api_key_iv,
    apiKeyTag: row.api_key_tag,
    filterTokens,
    filterMinUsd: row.filter_min_usd,
    filterVisibility: (row.filter_visibility as LinkedUser["filterVisibility"]) ?? "all",
    filterSide: (row.filter_side as LinkedUser["filterSide"]) ?? "all",
    filterEventTypes,
    alertsEnabled: row.alerts_enabled === 1,
    linkedAt: row.linked_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Link a Telegram user to an agent. Replaces any existing link.
 */
export function linkUser(params: {
  telegramUserId: string;
  telegramUsername: string | null;
  agentId: string;
  agentWallet: string;
  apiKey: string;
}): LinkedUser {
  const encrypted = encryptApiKey(params.apiKey);

  const stmt = db.prepare(`
    INSERT INTO linked_users (
      telegram_user_id, telegram_username,
      agent_id, agent_wallet,
      api_key_encrypted, api_key_iv, api_key_tag
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      telegram_username = excluded.telegram_username,
      agent_id = excluded.agent_id,
      agent_wallet = excluded.agent_wallet,
      api_key_encrypted = excluded.api_key_encrypted,
      api_key_iv = excluded.api_key_iv,
      api_key_tag = excluded.api_key_tag,
      filter_tokens = '[]',
      filter_min_usd = 0,
      filter_visibility = 'all',
      filter_side = 'all',
      filter_event_types = '["rfq.created","rfq.filled"]',
      alerts_enabled = 1,
      updated_at = datetime('now')
  `);

  stmt.run(
    params.telegramUserId,
    params.telegramUsername,
    params.agentId,
    params.agentWallet.toLowerCase(),
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.tag
  );

  return getUser(params.telegramUserId)!;
}

/**
 * Unlink a Telegram user (delete the row).
 */
export function unlinkUser(telegramUserId: string): boolean {
  const stmt = db.prepare(
    "DELETE FROM linked_users WHERE telegram_user_id = ?"
  );
  const result = stmt.run(telegramUserId);
  return result.changes > 0;
}

/**
 * Get a linked user by Telegram user ID.
 */
export function getUser(telegramUserId: string): LinkedUser | null {
  const stmt = db.prepare(
    "SELECT * FROM linked_users WHERE telegram_user_id = ?"
  );
  const row = stmt.get(telegramUserId) as LinkedUserRow | undefined;
  return row ? parseRow(row) : null;
}

/**
 * Get all linked users.
 */
export function getAllUsers(): LinkedUser[] {
  const stmt = db.prepare("SELECT * FROM linked_users");
  const rows = stmt.all() as LinkedUserRow[];
  return rows.map(parseRow);
}

/**
 * Get all linked users for a given agent ID.
 */
export function getUsersByAgent(agentId: string): LinkedUser[] {
  const stmt = db.prepare(
    "SELECT * FROM linked_users WHERE agent_id = ?"
  );
  const rows = stmt.all(agentId) as LinkedUserRow[];
  return rows.map(parseRow);
}

/**
 * Update subscription filters for a user.
 */
export function updateFilters(
  telegramUserId: string,
  filters: {
    tokens?: string[];
    minUsd?: number;
    visibility?: "all" | "public" | "private";
    side?: "all" | "buy" | "sell";
    eventTypes?: AlertEventType[];
    alertsEnabled?: boolean;
  }
): LinkedUser | null {
  const user = getUser(telegramUserId);
  if (!user) return null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (filters.tokens !== undefined) {
    updates.push("filter_tokens = ?");
    values.push(JSON.stringify(filters.tokens.map((t) => t.toLowerCase())));
  }
  if (filters.minUsd !== undefined) {
    updates.push("filter_min_usd = ?");
    values.push(Math.max(0, filters.minUsd));
  }
  if (filters.visibility !== undefined) {
    updates.push("filter_visibility = ?");
    values.push(filters.visibility);
  }
  if (filters.side !== undefined) {
    updates.push("filter_side = ?");
    values.push(filters.side);
  }
  if (filters.eventTypes !== undefined) {
    updates.push("filter_event_types = ?");
    values.push(JSON.stringify(filters.eventTypes));
  }
  if (filters.alertsEnabled !== undefined) {
    updates.push("alerts_enabled = ?");
    values.push(filters.alertsEnabled ? 1 : 0);
  }

  if (updates.length === 0) return user;

  updates.push("updated_at = datetime('now')");
  values.push(telegramUserId);

  const sql = `UPDATE linked_users SET ${updates.join(", ")} WHERE telegram_user_id = ?`;
  db.prepare(sql).run(...values);

  return getUser(telegramUserId);
}

/**
 * Decrypt the stored API key for a user.
 */
export function decryptUserApiKey(user: LinkedUser): string {
  return decryptApiKey({
    ciphertext: user.apiKeyEncrypted,
    iv: user.apiKeyIv,
    tag: user.apiKeyTag,
  });
}
