#!/usr/bin/env node
/**
 * preflight.mjs — Pre-start environment variable checker.
 *
 * Verifies that all required env vars are set before `next dev` or `next build`
 * runs.
 *
 * Behaviour:
 *   - Production (NODE_ENV=production): exits with code 1 if critical vars missing.
 *   - Development (default): warns on missing vars but never exits — falls back
 *     to localhost defaults so `npm run dev` works out-of-the-box.
 *
 * Usage:
 *   node scripts/preflight.mjs          # run standalone
 *   Called automatically via `npm run dev` and `npm run build`
 */

import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const isProd = process.env.NODE_ENV === "production";

// ── Default values for local development ────────────────────────────────────
const DEV_DEFAULTS = {
  NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS: "0x0000000000000000000000000000000000000000",
  NEXT_PUBLIC_RELAY_WS_URL: "ws://127.0.0.1:8080",
  NEXT_PUBLIC_TERMINAL_API_URL: "http://127.0.0.1:4200",
};

const isValidAddress = (v) =>
  /^0x[0-9a-fA-F]{40}$/.test(v) && v !== "0x0000000000000000000000000000000000000000";

const isUrl = (v) => /^https?:\/\/.+/.test(v);
const isWsUrl = (v) => /^wss?:\/\/.+/.test(v);
const isNotLocalhost = (v) => !/localhost|127\.0\.0\.1/.test(v);

// ── Critical variables (production build fails without these) ───────────────
const CRITICAL = [
  {
    name: "NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS",
    help: "Deployed HyperEvmRfq (spot) contract address (0x...)",
    validate: isValidAddress,
    validationMsg: "Must be a valid non-zero 0x address",
  },
  {
    name: "DATABASE_URL",
    help: "PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/dbname)",
    validate: (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
    validationMsg: "Must be a postgresql:// connection string",
    prodOnly: true,
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    help: "Public app URL (e.g. https://hyperquote.xyz)",
    validate: (v) => isUrl(v) && isNotLocalhost(v),
    validationMsg: "Must be a non-localhost https URL",
    prodOnly: true,
  },
  {
    name: "NEXT_PUBLIC_RELAY_WS_URL",
    help: "Production relay WebSocket URL (e.g. wss://relay.hyperquote.io)",
    validate: (v) => isWsUrl(v) && isNotLocalhost(v),
    validationMsg: "Must be a non-localhost wss:// URL",
    prodOnly: true,
    when: () => process.env.NEXT_PUBLIC_USE_RELAY === "true",
  },
  {
    name: "NEXT_PUBLIC_TERMINAL_API_URL",
    help: "Production terminal API URL (e.g. https://api.hyperquote.io)",
    validate: (v) => isUrl(v) && isNotLocalhost(v),
    validationMsg: "Must be a non-localhost https URL",
    prodOnly: true,
    when: () => process.env.NEXT_PUBLIC_ENABLE_TERMINAL === "true",
  },
];

// ── Recommended variables (app works without but with limited features) ─────
const RECOMMENDED = [
  {
    name: "NEXT_PUBLIC_OPTIONS_ENGINE_ADDRESS",
    help: "Deployed OptionsEngine contract address (0x...)",
  },
  {
    name: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    help: "Get one at https://cloud.walletconnect.com (needed for WalletConnect)",
  },
  {
    name: "NEXT_PUBLIC_RELAY_WS_URL",
    help: "WebSocket relay URL (default: ws://127.0.0.1:8080)",
    when: () => process.env.NEXT_PUBLIC_USE_RELAY === "true",
  },
  {
    name: "NEXT_PUBLIC_TERMINAL_API_URL",
    help: "Terminal REST API URL (default: http://127.0.0.1:4200)",
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function log(color, prefix, msg) {
  console.log(`${color}${BOLD}${prefix}${RESET} ${msg}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log("");
console.log(`${BOLD}🔍 HyperQuote Preflight Check${RESET}${isProd ? ` ${RED}(production)${RESET}` : ""}`);
console.log(`${DIM}${"─".repeat(50)}${RESET}`);

let errors = 0;
let warnings = 0;

// 1. Check .env.local exists
const envLocalPath = resolve(ROOT, ".env.local");
if (!existsSync(envLocalPath)) {
  log(YELLOW, "WARN", ".env.local not found — using defaults / system env only");
  log(DIM, "    ", `Run: cp .env.example .env.local`);
  warnings++;
} else {
  log(GREEN, " OK ", ".env.local found");
}

// 2. Check critical vars
for (const req of CRITICAL) {
  // Skip prod-only checks in development
  if (req.prodOnly && !isProd) continue;
  // Skip conditional checks when guard returns false
  if (req.when && !req.when()) continue;

  const val = process.env[req.name];

  if (!val || val.trim() === "") {
    if (isProd) {
      log(RED, "FAIL", `${req.name} is not set`);
      log(DIM, "    ", req.help);
      errors++;
    } else {
      const fallback = DEV_DEFAULTS[req.name];
      if (fallback) {
        log(YELLOW, "WARN", `${req.name} not set — using dev default: ${fallback.slice(0, 6)}...${fallback.slice(-4)}`);
        process.env[req.name] = fallback;
      } else {
        log(YELLOW, "WARN", `${req.name} not set`);
      }
      warnings++;
    }
  } else if (req.validate && !req.validate(val)) {
    if (isProd) {
      log(RED, "FAIL", `${req.name} = "${val}" — ${req.validationMsg}`);
      log(DIM, "    ", req.help);
      errors++;
    } else {
      log(YELLOW, "WARN", `${req.name} = "${val}" — ${req.validationMsg}`);
      warnings++;
    }
  } else {
    log(GREEN, " OK ", `${req.name} = ${val.slice(0, 6)}...${val.slice(-4)}`);
  }
}

// 3. Check recommended vars
for (const rec of RECOMMENDED) {
  if (rec.when && !rec.when()) continue;

  const val = process.env[rec.name];
  if (!val || val.trim() === "") {
    const fallback = DEV_DEFAULTS[rec.name];
    if (fallback) {
      log(DIM, "INFO", `${rec.name} not set — default: ${fallback}`);
    } else {
      log(YELLOW, "WARN", `${rec.name} is not set (optional)`);
      log(DIM, "    ", rec.help);
      warnings++;
    }
  } else {
    log(GREEN, " OK ", `${rec.name} is set`);
  }
}

// 4. Summary
console.log(`${DIM}${"─".repeat(50)}${RESET}`);

if (errors > 0) {
  log(RED, "✗", `${errors} critical variable(s) missing — cannot build for production`);
  log(DIM, "    ", "See .env.example for reference");
  console.log("");
  process.exit(1);
}

if (warnings > 0) {
  log(YELLOW, "⚠", `${warnings} warning(s) — some features may use defaults`);
} else {
  log(GREEN, "✓", "All checks passed");
}

console.log("");
