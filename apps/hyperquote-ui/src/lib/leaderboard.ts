/**
 * Leaderboard aggregation utilities — shared between the main leaderboard
 * route and the /me endpoint.
 *
 * Groups fills by address, aggregates points/volume/fills, and applies
 * NFT badge boosts at query time.
 */

import { prisma } from "@/lib/db";
import { computeBoost } from "@/lib/badges";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "makers" | "takers";
type Window = "7d" | "30d" | "all";

export interface LeaderboardEntry {
  rank: number;
  address: string;
  /** Post-boost points. */
  points: number;
  /** Pre-boost points (from Fill table). */
  rawPoints: number;
  volume: number;
  fills: number;
  avgImprovementBps: number;
  /** Makers only: kill/cancel rate 0.0–1.0. Null for takers. */
  cancelRate: number | null;
  boostMultiplier: number;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  totalParticipants: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseTab(raw: string | null): Tab {
  return raw === "takers" ? "takers" : "makers";
}

export function parseWindow(raw: string | null): Window {
  if (raw === "30d") return "30d";
  if (raw === "all") return "all";
  return "7d";
}

export function windowToDate(w: Window): Date | null {
  if (w === "all") return null;
  const ms = w === "30d" ? 30 * 86400_000 : 7 * 86400_000;
  return new Date(Date.now() - ms);
}

// ---------------------------------------------------------------------------
// Badge fetcher — server-side batch lookup
// ---------------------------------------------------------------------------

/**
 * Batch fetch badge data for a list of addresses.
 * Returns a Map<lowercaseAddress, { hasHypio, hasHypurr, boostMultiplier }>.
 *
 * Uses the internal badge API endpoint. Falls back to boost=1.0 on errors.
 */
async function fetchBadgeBatch(
  addresses: string[]
): Promise<Map<string, { hasHypio: boolean; hasHypurr: boolean; boostMultiplier: number }>> {
  const result = new Map<string, { hasHypio: boolean; hasHypurr: boolean; boostMultiplier: number }>();
  if (addresses.length === 0) return result;

  // Fetch in parallel, with a concurrency limit of 10
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 10) {
    chunks.push(addresses.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (addr) => {
      try {
        // Use internal fetch to the badges API
        const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${origin}/api/v1/badges/${addr}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          result.set(addr, {
            hasHypio: data.hasHypio ?? false,
            hasHypurr: data.hasHypurr ?? false,
            boostMultiplier: data.boostMultiplier ?? 1.0,
          });
        } else {
          result.set(addr, { hasHypio: false, hasHypurr: false, boostMultiplier: 1.0 });
        }
      } catch {
        result.set(addr, { hasHypio: false, hasHypurr: false, boostMultiplier: 1.0 });
      }
    });
    await Promise.all(promises);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cancel rate computation
// ---------------------------------------------------------------------------

/**
 * Compute kill/cancel rates for a set of maker addresses.
 * Returns Map<lowercaseAddress, cancelRate 0.0–1.0>.
 */
async function fetchCancelRates(
  addresses: string[],
  since: Date | null
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (addresses.length === 0) return result;

  const where: Record<string, unknown> = {
    taker: { in: addresses },
  };
  if (since) {
    where.createdAt = { gte: since };
  }

  // Get all FeedRfqs for these maker addresses
  const rfqs = await prisma.feedRfq.findMany({
    where,
    select: { taker: true, status: true },
  });

  // Group by address
  const counts = new Map<string, { total: number; killed: number }>();
  for (const rfq of rfqs) {
    const entry = counts.get(rfq.taker) ?? { total: 0, killed: 0 };
    entry.total++;
    if (rfq.status === "KILLED") entry.killed++;
    counts.set(rfq.taker, entry);
  }

  for (const [addr, { total, killed }] of counts) {
    result.set(addr, total > 0 ? killed / total : 0);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

export async function buildLeaderboard(
  tab: Tab,
  window: Window,
  options?: { limit?: number; cursor?: string }
): Promise<LeaderboardResult> {
  const limit = options?.limit ?? 100;
  const since = windowToDate(window);

  // Build Prisma where clause
  const where: Record<string, unknown> = {};
  if (since) {
    where.timestamp = { gte: since };
  }

  // Fetch all fills in window
  const fills = await prisma.fill.findMany({
    where,
    select: {
      taker: true,
      maker: true,
      takerPoints: true,
      makerPoints: true,
      amountInUsd: true,
      improvementBps: true,
    },
  });

  // Group by address
  const grouped = new Map<string, {
    rawPoints: number;
    volume: number;
    fills: number;
    totalImprovementBps: number;
  }>();

  for (const fill of fills) {
    const address = tab === "takers" ? fill.taker : fill.maker;
    const points = tab === "takers" ? fill.takerPoints : fill.makerPoints;

    const entry = grouped.get(address) ?? {
      rawPoints: 0,
      volume: 0,
      fills: 0,
      totalImprovementBps: 0,
    };

    entry.rawPoints += points;
    entry.volume += fill.amountInUsd;
    entry.fills += 1;
    entry.totalImprovementBps += fill.improvementBps;

    grouped.set(address, entry);
  }

  const totalParticipants = grouped.size;

  // Sort by raw points descending, take top N for badge lookup
  const sorted = [...grouped.entries()]
    .sort(([, a], [, b]) => b.rawPoints - a.rawPoints)
    .slice(0, limit);

  const topAddresses = sorted.map(([addr]) => addr);

  // Batch fetch badges for top addresses
  const badges = await fetchBadgeBatch(topAddresses);

  // Fetch cancel rates for makers
  let cancelRates = new Map<string, number>();
  if (tab === "makers") {
    cancelRates = await fetchCancelRates(topAddresses, since);
  }

  // Apply boost and build entries
  let entries: LeaderboardEntry[] = sorted.map(([address, data]) => {
    const badge = badges.get(address);
    const boostMultiplier = badge
      ? computeBoost(badge.hasHypio, badge.hasHypurr)
      : 1.0;

    return {
      rank: 0, // Set after re-sorting
      address,
      points: Math.round(data.rawPoints * boostMultiplier),
      rawPoints: Math.round(data.rawPoints),
      volume: Math.round(data.volume * 100) / 100,
      fills: data.fills,
      avgImprovementBps: data.fills > 0
        ? Math.round(data.totalImprovementBps / data.fills)
        : 0,
      cancelRate: tab === "makers" ? (cancelRates.get(address) ?? 0) : null,
      boostMultiplier,
    };
  });

  // Re-sort after boost application (boost can change ordering)
  entries.sort((a, b) => b.points - a.points);

  // Apply cursor-based pagination
  if (options?.cursor) {
    const cursorIdx = entries.findIndex((e) => e.address === options.cursor);
    if (cursorIdx >= 0) {
      entries = entries.slice(cursorIdx + 1);
    }
  }

  // Assign ranks
  entries.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  return { entries, totalParticipants };
}
