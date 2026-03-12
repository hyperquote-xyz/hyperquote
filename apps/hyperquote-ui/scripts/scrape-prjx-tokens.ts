/**
 * scripts/scrape-prjx-tokens.ts
 *
 * Scrape https://www.prjx.com/liquidity using Playwright (headless Chromium)
 * to extract all unique ERC-20 token addresses appearing in liquidity pools.
 *
 * Strategy:
 *   1. Intercept XHR/fetch responses for pool/token data (API-first)
 *   2. Parse the rendered DOM for token addresses in links, data attributes,
 *      and visible text as a fallback
 *   3. Deduplicate and return all unique addresses
 *
 * Usage:
 *   npx ts-node scripts/scrape-prjx-tokens.ts
 *
 * Requires: playwright (npm install -D playwright)
 */

import { chromium, type Page, type BrowserContext } from "playwright";
import { fileURLToPath } from "url";
const TARGET_URL = "https://www.prjx.com/liquidity";
const PAGE_TIMEOUT_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 45_000;

// Regex: 0x followed by exactly 40 hex chars (ERC-20 address)
const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

// Addresses to ignore (common non-token contracts, routers, factories)
const IGNORED_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

/**
 * Extract token addresses from intercepted API responses.
 */
function extractAddressesFromJSON(data: unknown): Set<string> {
  const addresses = new Set<string>();
  const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
  const matches = jsonStr.match(ADDRESS_RE);
  if (matches) {
    for (const m of matches) {
      const lower = m.toLowerCase();
      if (!IGNORED_ADDRESSES.has(lower)) {
        addresses.add(lower);
      }
    }
  }
  return addresses;
}

/**
 * Extract token addresses from the rendered DOM.
 */
async function extractAddressesFromDOM(page: Page): Promise<Set<string>> {
  return page.evaluate(() => {
    const addressRe = /0x[0-9a-fA-F]{40}/g;
    const ignored = new Set([
      "0x0000000000000000000000000000000000000000",
      "0x000000000000000000000000000000000000dead",
    ]);
    const found = new Set<string>();

    // 1. Check all <a> href attributes
    document.querySelectorAll("a[href]").forEach((el) => {
      const href = (el as HTMLAnchorElement).href;
      const matches = href.match(addressRe);
      if (matches) matches.forEach((m) => found.add(m.toLowerCase()));
    });

    // 2. Check all data-* attributes
    document.querySelectorAll("[data-address], [data-token], [data-token0], [data-token1]").forEach((el) => {
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-")) {
          const matches = attr.value.match(addressRe);
          if (matches) matches.forEach((m) => found.add(m.toLowerCase()));
        }
      }
    });

    // 3. Scan all visible text (pool rows, labels, etc.)
    const body = document.body.innerText;
    const bodyMatches = body.match(addressRe);
    if (bodyMatches) bodyMatches.forEach((m) => found.add(m.toLowerCase()));

    // 4. Check all elements with class or id containing "token" or "pool"
    document.querySelectorAll("[class*='token'], [class*='pool'], [id*='token'], [id*='pool']").forEach((el) => {
      const text = el.textContent ?? "";
      const matches = text.match(addressRe);
      if (matches) matches.forEach((m) => found.add(m.toLowerCase()));

      // Also check data attributes on these elements
      for (const attr of el.attributes) {
        const matches = attr.value.match(addressRe);
        if (matches) matches.forEach((m) => found.add(m.toLowerCase()));
      }
    });

    // Remove ignored
    for (const addr of ignored) found.delete(addr);

    return [...found];
  }).then((arr) => new Set(arr));
}

/**
 * Main scraper function.
 * Returns a deduplicated array of lowercase ERC-20 addresses.
 */
export async function scrapePRJXTokens(): Promise<string[]> {
  console.log("[scrape] Launching headless Chromium…");
  const browser = await chromium.launch({ headless: true });

  let context: BrowserContext;
  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
  } catch (err) {
    await browser.close();
    throw err;
  }

  const allAddresses = new Set<string>();

  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);

  // ── Intercept API responses ──
  page.on("response", async (response) => {
    const url = response.url();
    const ct = response.headers()["content-type"] ?? "";

    // Only process JSON responses that look like pool/token data
    if (!ct.includes("json")) return;
    if (
      !url.includes("pool") &&
      !url.includes("token") &&
      !url.includes("liquidity") &&
      !url.includes("pair") &&
      !url.includes("api")
    ) {
      return;
    }

    try {
      const body = await response.text();
      const found = extractAddressesFromJSON(body);
      if (found.size > 0) {
        console.log(
          `[scrape] Intercepted ${found.size} addresses from: ${url.slice(0, 100)}`
        );
        for (const a of found) allAddresses.add(a);
      }
    } catch {
      // Response body may not be available (e.g., redirect)
    }
  });

  // ── Navigate ──
  console.log(`[scrape] Navigating to ${TARGET_URL}…`);
  try {
    await page.goto(TARGET_URL, {
      waitUntil: "networkidle",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
  } catch (err) {
    console.warn(
      "[scrape] Navigation did not reach networkidle — continuing with DOM extraction"
    );
  }

  // ── Wait for content to render ──
  // Try scrolling to trigger lazy-loaded pools
  console.log("[scrape] Scrolling page to load all pools…");
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(800);
  }

  // ── Click "Show more" / pagination if present ──
  for (let attempt = 0; attempt < 5; attempt++) {
    const showMore = page.locator(
      'button:has-text("Show more"), button:has-text("Load more"), button:has-text("View all"), [class*="load-more"], [class*="show-more"]'
    );
    const count = await showMore.count();
    if (count === 0) break;
    try {
      await showMore.first().click({ timeout: 3000 });
      console.log(`[scrape] Clicked "Show more" (attempt ${attempt + 1})`);
      await page.waitForTimeout(2000);
    } catch {
      break;
    }
  }

  // ── Extract from DOM ──
  console.log("[scrape] Extracting addresses from DOM…");
  const domAddresses = await extractAddressesFromDOM(page);
  for (const a of domAddresses) allAddresses.add(a);

  // ── Also grab page source as final fallback ──
  const html = await page.content();
  const htmlMatches = html.match(ADDRESS_RE);
  if (htmlMatches) {
    for (const m of htmlMatches) {
      const lower = m.toLowerCase();
      if (!IGNORED_ADDRESSES.has(lower)) {
        allAddresses.add(lower);
      }
    }
  }

  await browser.close();

  const result = [...allAddresses].sort();
  console.log(`[scrape] Found ${result.length} unique token addresses`);
  return result;
}

// ── CLI entry point ──
// — CLI entry point (ESM-safe) —
const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  scrapePRJXTokens()
    .then((addresses) => {
      console.log(JSON.stringify(addresses, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[scrape] Fatal error:", err);
      process.exit(1);
    });
}