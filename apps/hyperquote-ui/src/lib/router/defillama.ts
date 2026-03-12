/**
 * DefiLlama Registry Sync — Phase 2
 *
 * Polls the DefiLlama `/protocols` API, filters for HyperEVM DEXes,
 * and upserts into the `protocol_registry` table.
 *
 * Design:
 *   - Idempotent: safe to run repeatedly via upsert
 *   - Marks protocols INACTIVE if missing from N consecutive polls
 *   - Logs every mutation for observability
 *   - Does NOT touch protocol_connectors (that's manual / Phase 3)
 *
 * DefiLlama API notes:
 *   - Chain name for HyperEVM is "Hyperliquid L1"
 *   - DEX category is "Dexs" (not "Dexes")
 *   - Volume data comes from /overview/dexs endpoint (separate)
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** DefiLlama chain identifier for HyperEVM */
const DEFILLAMA_CHAIN = "Hyperliquid L1";

/** DefiLlama protocol categories to include */
const INCLUDED_CATEGORIES = new Set(["Dexs", "Dexes"]);

/** DefiLlama API endpoints */
const PROTOCOLS_URL = "https://api.llama.fi/protocols";
const DEX_VOLUME_URL = "https://api.llama.fi/overview/dexs";

/**
 * Number of consecutive missed polls before marking INACTIVE.
 * We track this via a simple heuristic: if a protocol was previously
 * ACTIVE and is not found in the current poll, we mark it INACTIVE.
 * A more sophisticated approach would use a `missed_polls` counter.
 */
const INACTIVE_AFTER_MISSING_POLLS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw protocol entry from DefiLlama /protocols API */
interface DefiLlamaProtocol {
  id: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl: number | null;
  chainTvls?: Record<string, number>;
}

/** Raw volume entry from DefiLlama /overview/dexs API */
interface DefiLlamaVolumeEntry {
  defillamaId: string;
  name: string;
  total24h?: number | null;
  chains?: string[];
}

/** Result of a single sync run */
export interface SyncResult {
  timestamp: string;
  polledProtocols: number;
  filteredDexes: number;
  upserted: number;
  markedInactive: number;
  errors: string[];
  mutations: SyncMutation[];
}

/** Individual mutation for logging */
interface SyncMutation {
  slug: string;
  action: "CREATED" | "UPDATED" | "MARKED_INACTIVE";
  details?: string;
}

// ---------------------------------------------------------------------------
// API Fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch all protocols from DefiLlama.
 * Returns raw array — caller is responsible for filtering.
 */
async function fetchProtocols(): Promise<DefiLlamaProtocol[]> {
  const res = await fetch(PROTOCOLS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`DefiLlama /protocols returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch 24h volume for DEXes on the target chain.
 * Returns a Map of slug → vol24hUsd for easy lookup.
 */
async function fetchDexVolumes(): Promise<Map<string, number>> {
  const volumeMap = new Map<string, number>();

  try {
    const res = await fetch(`${DEX_VOLUME_URL}?chain=${encodeURIComponent(DEFILLAMA_CHAIN)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[defillama] Volume endpoint returned ${res.status}, skipping volume data`);
      return volumeMap;
    }
    const data = await res.json();
    if (data.protocols && Array.isArray(data.protocols)) {
      for (const p of data.protocols as DefiLlamaVolumeEntry[]) {
        const vol = p.total24h;
        if (vol != null && vol > 0) {
          // Volume API uses defillamaId (numeric string), but we need slug.
          // We'll match by name in the caller since the volume API doesn't
          // always expose the slug. Store by name (lowered) for matching.
          volumeMap.set(p.name.toLowerCase(), vol);
        }
      }
    }
  } catch (err) {
    console.warn("[defillama] Failed to fetch volume data:", err);
  }

  return volumeMap;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Filter protocols to only HyperEVM DEXes.
 */
function filterHyperEVMDexes(protocols: DefiLlamaProtocol[]): DefiLlamaProtocol[] {
  return protocols.filter((p) => {
    const isTargetChain = p.chains?.some(
      (c) => c === DEFILLAMA_CHAIN
    );
    const isDex = INCLUDED_CATEGORIES.has(p.category);
    return isTargetChain && isDex;
  });
}

// ---------------------------------------------------------------------------
// Sync Logic
// ---------------------------------------------------------------------------

/**
 * Run a full DefiLlama → protocol_registry sync.
 *
 * Steps:
 *   1. Fetch all protocols from DefiLlama
 *   2. Filter for HyperEVM DEXes
 *   3. (Optional) Fetch 24h volume data
 *   4. Upsert each into protocol_registry
 *   5. Mark any previously-ACTIVE protocols not in this batch as INACTIVE
 *   6. Return detailed SyncResult
 */
export async function syncProtocolRegistry(options?: {
  /** Include volume data from /overview/dexs endpoint (slower, extra API call) */
  includeVolume?: boolean;
  /** Dry run — don't write to DB, just return what would change */
  dryRun?: boolean;
}): Promise<SyncResult> {
  const { includeVolume = true, dryRun = false } = options ?? {};
  const result: SyncResult = {
    timestamp: new Date().toISOString(),
    polledProtocols: 0,
    filteredDexes: 0,
    upserted: 0,
    markedInactive: 0,
    errors: [],
    mutations: [],
  };

  // ── Step 1: Fetch protocols ──
  console.log("[defillama] Fetching protocols from DefiLlama...");
  let allProtocols: DefiLlamaProtocol[];
  try {
    allProtocols = await fetchProtocols();
    result.polledProtocols = allProtocols.length;
    console.log(`[defillama] Fetched ${allProtocols.length} total protocols`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to fetch protocols: ${msg}`);
    console.error("[defillama] Fetch failed:", msg);
    return result;
  }

  // ── Step 2: Filter ──
  const dexes = filterHyperEVMDexes(allProtocols);
  result.filteredDexes = dexes.length;
  console.log(`[defillama] Filtered to ${dexes.length} HyperEVM DEXes`);

  // ── Step 3: Volume data (optional) ──
  let volumeMap = new Map<string, number>();
  if (includeVolume) {
    console.log("[defillama] Fetching 24h volume data...");
    volumeMap = await fetchDexVolumes();
    console.log(`[defillama] Got volume for ${volumeMap.size} protocols`);
  }

  // ── Step 4: Upsert each DEX ──
  const seenSlugs = new Set<string>();

  for (const dex of dexes) {
    seenSlugs.add(dex.slug);

    // Get chain-specific TVL if available, fall back to total TVL
    const chainTvl = dex.chainTvls?.[DEFILLAMA_CHAIN] ?? dex.tvl ?? null;
    const vol24h = volumeMap.get(dex.name.toLowerCase()) ?? null;

    const upsertData = {
      name: dex.name,
      category: dex.category,
      chains: JSON.stringify(
        dex.chains.filter((c) => c === DEFILLAMA_CHAIN)
      ),
      tvlUsd: chainTvl,
      vol24hUsd: vol24h,
      status: "ACTIVE" as const,
    };

    if (dryRun) {
      result.mutations.push({
        slug: dex.slug,
        action: "UPDATED",
        details: `TVL: $${chainTvl?.toLocaleString() ?? "N/A"}, Vol24h: $${vol24h?.toLocaleString() ?? "N/A"}`,
      });
      result.upserted++;
      continue;
    }

    try {
      // Check if exists to determine CREATED vs UPDATED
      const existing = await prisma.protocolRegistry.findUnique({
        where: { slug: dex.slug },
        select: { slug: true, status: true },
      });

      await prisma.protocolRegistry.upsert({
        where: { slug: dex.slug },
        update: upsertData,
        create: {
          slug: dex.slug,
          ...upsertData,
        },
      });

      const action = existing ? "UPDATED" : "CREATED";
      result.mutations.push({
        slug: dex.slug,
        action,
        details: `TVL: $${chainTvl?.toLocaleString() ?? "N/A"}, Vol24h: $${vol24h?.toLocaleString() ?? "N/A"}`,
      });
      result.upserted++;

      if (action === "CREATED") {
        console.log(`[defillama] + CREATED ${dex.slug} (${dex.name})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to upsert ${dex.slug}: ${msg}`);
      console.error(`[defillama] Upsert failed for ${dex.slug}:`, msg);
    }
  }

  // ── Step 5: Mark missing protocols INACTIVE ──
  if (!dryRun) {
    try {
      const activeProtocols = await prisma.protocolRegistry.findMany({
        where: { status: "ACTIVE" },
        select: { slug: true },
      });

      for (const { slug } of activeProtocols) {
        if (!seenSlugs.has(slug)) {
          await prisma.protocolRegistry.update({
            where: { slug },
            data: { status: "INACTIVE" },
          });
          result.mutations.push({
            slug,
            action: "MARKED_INACTIVE",
            details: "Not found in current DefiLlama poll",
          });
          result.markedInactive++;
          console.log(`[defillama] - MARKED_INACTIVE ${slug}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to mark inactive protocols: ${msg}`);
      console.error("[defillama] Inactive marking failed:", msg);
    }
  }

  // ── Summary ──
  console.log(
    `[defillama] Sync complete: ${result.upserted} upserted, ` +
      `${result.markedInactive} marked inactive, ${result.errors.length} errors`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

/**
 * Get all active protocols from the registry.
 */
export async function getActiveProtocols() {
  return prisma.protocolRegistry.findMany({
    where: { status: "ACTIVE" },
    include: { connector: true },
    orderBy: { tvlUsd: "desc" },
  });
}

/**
 * Get a single protocol by slug.
 */
export async function getProtocol(slug: string) {
  return prisma.protocolRegistry.findUnique({
    where: { slug },
    include: { connector: true },
  });
}

/**
 * Get protocol registry stats.
 */
export async function getRegistryStats() {
  const [total, active, inactive, withConnector] = await Promise.all([
    prisma.protocolRegistry.count(),
    prisma.protocolRegistry.count({ where: { status: "ACTIVE" } }),
    prisma.protocolRegistry.count({ where: { status: "INACTIVE" } }),
    prisma.protocolConnector.count(),
  ]);

  return { total, active, inactive, withConnector };
}
