"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import Link from "next/link";
import { MakerInterface } from "@/components/MakerInterface";
import { ReadOnlyFeed } from "@/components/maker";
import { useMakerRelay } from "@/lib/makerRelay";
import { useMakerPreferences } from "@/hooks/useMakerPreferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Trophy,
  Zap,
  BarChart3,
  Loader2,
  Lock,
  ArrowRight,
  Settings,
  Bell,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatAddress } from "@/lib/utils";

const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "999");
const RFQ_CONTRACT = process.env.NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS ?? "";
const RELAY_ENABLED = process.env.NEXT_PUBLIC_USE_RELAY === "true";

interface MakerStats {
  points: number;
  volume: number;
  fills: number;
  avgImprovementBps: number;
}

interface ProfileResponse {
  address: string;
  tier: "bronze" | "silver" | "gold";
  maker30d: MakerStats;
}

const TIER_CONFIG = {
  bronze: {
    label: "Bronze",
    className: "border-amber-600/50 text-amber-600 bg-amber-600/10",
  },
  silver: {
    label: "Silver",
    className: "border-gray-400/50 text-gray-400 bg-gray-400/10",
  },
  gold: {
    label: "Gold",
    className: "border-yellow-500/50 text-yellow-500 bg-yellow-500/10",
  },
};

/** Tier thresholds in points */
const TIER_THRESHOLDS = {
  silver: 10_000,
  gold: 100_000,
};

function getTierProgress(tier: "bronze" | "silver" | "gold", points: number) {
  if (tier === "gold") {
    return { pct: 100, nextTier: null as string | null, remaining: 0, threshold: TIER_THRESHOLDS.gold };
  }
  if (tier === "silver") {
    const pct = Math.min(100, (points / TIER_THRESHOLDS.gold) * 100);
    return { pct, nextTier: "Gold", remaining: Math.max(0, TIER_THRESHOLDS.gold - points), threshold: TIER_THRESHOLDS.gold };
  }
  // bronze
  const pct = Math.min(100, (points / TIER_THRESHOLDS.silver) * 100);
  return { pct, nextTier: "Silver", remaining: Math.max(0, TIER_THRESHOLDS.silver - points), threshold: TIER_THRESHOLDS.silver };
}

function MakerStatsCard({ address }: { address: string }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`/api/v1/profile/${address}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ProfileResponse = await res.json();
        setData(json);
      } catch {
        // Silently fail — stats card is supplementary
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [address]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No maker activity yet. Fill RFQs to start earning points.
        </CardContent>
      </Card>
    );
  }

  const tierCfg = TIER_CONFIG[data.tier];
  const stats = data.maker30d;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Your Maker Stats (30d)
          </span>
          <Badge variant="outline" className={tierCfg.className}>
            <Trophy className="h-3 w-3 mr-1" />
            {tierCfg.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xs text-muted-foreground mb-1">Points</div>
            <div className="font-mono font-medium text-sm">
              {stats.points.toLocaleString()}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xs text-muted-foreground mb-1">Volume</div>
            <div className="font-mono font-medium text-sm">
              ${stats.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xs text-muted-foreground mb-1">Avg Improvement</div>
            <div className="font-mono font-medium text-sm">
              {stats.avgImprovementBps > 0 ? "+" : ""}{stats.avgImprovementBps} bps
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="text-xs text-muted-foreground mb-1">Fills</div>
            <div className="font-mono font-medium text-sm">
              {stats.fills.toLocaleString()}
            </div>
          </div>
        </div>
        {/* Tier Progress */}
        {(() => {
          const { pct, nextTier, remaining } = getTierProgress(data.tier, stats.points);
          return (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {nextTier
                    ? `${remaining.toLocaleString()} pts to ${nextTier}`
                    : "Max tier reached"}
                </span>
                <span className="font-mono">
                  Silver: {TIER_THRESHOLDS.silver.toLocaleString()} | Gold: {TIER_THRESHOLDS.gold.toLocaleString()}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    data.tier === "gold"
                      ? "bg-yellow-500"
                      : data.tier === "silver"
                        ? "bg-gray-400"
                        : "bg-amber-600"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}

        <div className="mt-3 text-right">
          <Link
            href={`/profile/${address}`}
            className="text-xs text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1"
          >
            View full profile <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Feed Filters sidebar card (auto-saved to localStorage)
// ---------------------------------------------------------------------------

function FeedFiltersCard() {
  const { prefs, updatePrefs, loaded } = useMakerPreferences();
  const [watchlistInput, setWatchlistInput] = useState("");

  // Sync watchlist input when prefs load
  useEffect(() => {
    if (loaded && prefs.tokenWatchlist.length > 0) {
      setWatchlistInput(prefs.tokenWatchlist.join(", "));
    }
  }, [loaded, prefs.tokenWatchlist]);

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          My Feed Filters
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-1">
          Applies only to your view of the live RFQ feed (saved in this browser)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Min RFQ Size */}
        <div className="space-y-1.5">
          <Label htmlFor="min-size" className="text-xs text-muted-foreground">
            Min Size (USD, stable pairs only)
          </Label>
          <Input
            id="min-size"
            type="number"
            placeholder="No minimum"
            className="h-9 text-sm"
            value={prefs.minSizeUsd ?? ""}
            onChange={(e) =>
              updatePrefs({
                minSizeUsd: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Applies only to RFQs with stablecoin-denominated size
          </p>
        </div>

        {/* Token Watchlist */}
        <div className="space-y-1.5">
          <Label htmlFor="watchlist" className="text-xs text-muted-foreground">
            Token Watchlist
          </Label>
          <Input
            id="watchlist"
            placeholder="e.g. HYPE, USDC, PURR"
            className="h-9 text-sm"
            value={watchlistInput}
            onChange={(e) => {
              const raw = e.target.value;
              setWatchlistInput(raw);
              // Parse: split on commas or spaces, trim, uppercase, deduplicate
              const tokens = [
                ...new Set(
                  raw
                    .split(/[,\s]+/)
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean)
                ),
              ];
              updatePrefs({ tokenWatchlist: tokens });
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Only show RFQs involving these tokens. Leave empty to show all.
          </p>
        </div>

        {/* Alert Preferences pointer */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/30">
          <Bell className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground">
            Alert preferences are configured in the{" "}
            <span className="text-foreground font-medium">Alerts</span> tab
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Private RFQ callout card
// ---------------------------------------------------------------------------

function PrivateRfqCallout() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-5">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Large trades?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Create a private RFQ to receive quotes from selected makers only.
              Reduce information leakage on size.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <Link href="/swap">
              Create Private RFQ
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard page
// ---------------------------------------------------------------------------

export default function MakerPage() {
  const { address, isConnected } = useAccount();
  const { prefs, updatePrefs, loaded: prefsLoaded } = useMakerPreferences();
  const { status, liveRequests } = useMakerRelay({
    enabled: RELAY_ENABLED,
    chainId: CHAIN_ID,
    rfqContract: RFQ_CONTRACT,
  });

  const relayConnected = status === "connected";

  // Build filters from localStorage prefs (only when loaded)
  const feedFilters = prefsLoaded
    ? { minSizeUsd: prefs.minSizeUsd, tokenWatchlist: prefs.tokenWatchlist }
    : undefined;

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 space-y-8">
      {/* ── A) Header Strip ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Maker Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Quote selectively. No LP. No impermanent loss.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {RELAY_ENABLED && (
            <Badge
              variant="outline"
              className={
                relayConnected
                  ? "border-success/50 text-success bg-success/10"
                  : "border-destructive/50 text-destructive bg-destructive/10"
              }
            >
              {relayConnected ? (
                <Wifi className="h-3 w-3 mr-1" />
              ) : (
                <WifiOff className="h-3 w-3 mr-1" />
              )}
              Relay {relayConnected ? "Connected" : "Disconnected"}
            </Badge>
          )}
          {isConnected && address && (
            <Badge variant="outline" className="font-mono text-xs">
              {formatAddress(address)}
            </Badge>
          )}
        </div>
      </div>

      {/* ── B) KPI Cards ─────────────────────────────────────────────────── */}
      {isConnected && address && <MakerStatsCard address={address} />}

      {/* ── C) Main Content Grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — Maker Interface (2/3) */}
        <div className="lg:col-span-2">
          <MakerInterface />
        </div>

        {/* Right — Preferences + Private RFQ Callout (1/3) */}
        <div className="space-y-6">
          <FeedFiltersCard />
          <PrivateRfqCallout />
        </div>
      </div>

      {/* ── D) ReadOnlyFeed (full width) ─────────────────────────────────── */}
      <ReadOnlyFeed
        requests={liveRequests}
        relayStatus={status}
        filters={feedFilters}
        onClearFilters={() => updatePrefs({ minSizeUsd: null, tokenWatchlist: [] })}
      />

      {/* ── E) Points explainer ──────────────────────────────────────────── */}
      <div className="text-center">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
          <BarChart3 className="h-3 w-3" />
          Maker points = volume x (1 + improvement/1000). Tier: Bronze (&lt;10k), Silver (&lt;100k), Gold (&ge;100k)
        </p>
      </div>
    </div>
  );
}
