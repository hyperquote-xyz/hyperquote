"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatAddress, formatUsd } from "@/lib/utils";
import {
  Trophy,
  Users,
  TrendingUp,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  DollarSign,
  BarChart3,
  Shield,
  Activity,
  Search,
  ExternalLink,
} from "lucide-react";
import { getAddress } from "viem";
import { useAccount } from "wagmi";

import type {
  LeagueEntry,
  LeagueResponse,
  ActivityFill,
} from "@/lib/mockLeagueData";
import {
  MOCK_MAKERS,
  MOCK_TAKERS,
  MOCK_KPI,
  MOCK_ACTIVITY,
} from "@/lib/mockLeagueData";
import { MOCK_MODE } from "@/lib/mockMode";

// ---------------------------------------------------------------------------
// Types (local-only, not shared)
// ---------------------------------------------------------------------------

type Role = "maker" | "taker";
type Period = "7d" | "30d" | "all";
type MinUsd = 0 | 25000 | 100000 | 250000 | 1000000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeChecksum(addr: string): string | null {
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

function formatNotional(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return formatUsd(usd);
}

function formatCompactNotional(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

const SIZE_FILTERS: { label: string; value: MinUsd }[] = [
  { label: "All", value: 0 },
  { label: "\u2265$25K", value: 25000 },
  { label: "\u2265$100K", value: 100000 },
  { label: "\u2265$250K", value: 250000 },
  { label: "\u2265$1M", value: 1000000 },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function LeaguePage() {
  const { address: walletAddress } = useAccount();

  // Controls
  const [role, setRole] = useState<Role>("maker");
  const [period, setPeriod] = useState<Period>("30d");
  const [minUsd, setMinUsd] = useState<MinUsd>(0);
  const [search, setSearch] = useState("");

  // Data
  const [data, setData] = useState<LeagueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sheet / drawer
  const [selectedEntry, setSelectedEntry] = useState<LeagueEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activity, setActivity] = useState<ActivityFill[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // ---------- Fetch league data ----------
  const fetchLeague = useCallback(async () => {
    setLoading(true);
    setError(null);

    // ── Mock mode: use static data, skip API ──
    if (MOCK_MODE) {
      const entries = role === "maker" ? MOCK_MAKERS : MOCK_TAKERS;
      let filtered = minUsd > 0
        ? entries.filter((e) => e.filledNotional >= minUsd)
        : [...entries];
      if (search.length >= 4) {
        filtered = filtered.filter((e) =>
          e.address.includes(search.toLowerCase())
        );
      }
      filtered = filtered.map((e, i) => ({ ...e, rank: i + 1 }));
      setData({
        role,
        period,
        minUsd,
        entries: filtered,
        totalParticipants: entries.length,
        hasMore: false,
        kpi: MOCK_KPI,
      });
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({
        role,
        period,
        ...(minUsd > 0 && { minUsd: String(minUsd) }),
        ...(search.length >= 4 && { search }),
      });
      const res = await fetch(`/api/v1/league?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LeagueResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load league");
    } finally {
      setLoading(false);
    }
  }, [role, period, minUsd, search]);

  useEffect(() => {
    fetchLeague();
  }, [fetchLeague]);

  // ---------- Fetch activity for drawer ----------
  const fetchActivity = useCallback(
    async (address: string) => {
      setActivityLoading(true);

      // ── Mock mode ──
      if (MOCK_MODE) {
        setActivity(MOCK_ACTIVITY);
        setActivityLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams({
          role,
          address,
          period,
          limit: "10",
        });
        const res = await fetch(`/api/v1/league/activity?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setActivity(json.fills ?? []);
      } catch {
        setActivity([]);
      } finally {
        setActivityLoading(false);
      }
    },
    [role, period]
  );

  // ---------- Handlers ----------
  const handleCopy = useCallback((addr: string) => {
    navigator.clipboard.writeText(safeChecksum(addr) ?? addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleRowClick = useCallback(
    (entry: LeagueEntry) => {
      setSelectedEntry(entry);
      setSheetOpen(true);
      setCopied(false);
      fetchActivity(entry.address);
    },
    [fetchActivity]
  );

  // ---------- Derived ----------
  const myEntry = useMemo(() => {
    if (!walletAddress || !data) return null;
    return data.entries.find(
      (e) => e.address === walletAddress.toLowerCase()
    ) ?? null;
  }, [walletAddress, data]);

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      {/* DEV banner */}
      {MOCK_MODE && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2 mb-4 text-center">
          <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
            DEV MODE — Mock Liquidity Data
          </p>
        </div>
      )}

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2 flex items-center justify-center gap-2">
          <Trophy className="h-7 w-7 text-primary" />
          Liquidity League
        </h1>
        <p className="text-muted-foreground">
          Ranked by executed notional and execution quality
        </p>
      </div>

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Controls row */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Left: Role tabs */}
          <Tabs value={role} onValueChange={(v) => setRole(v as Role)}>
            <TabsList>
              <TabsTrigger value="maker" className="gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Makers
              </TabsTrigger>
              <TabsTrigger value="taker" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" />
                Takers
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Right: Period + Size filter */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Period buttons */}
            {(["7d", "30d", "all"] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriod(p)}
              >
                {p === "all" ? "All" : p.toUpperCase()}
              </Button>
            ))}

            {/* Separator */}
            <div className="w-px h-6 bg-border/50 mx-1 hidden sm:block" />

            {/* Size filter */}
            {SIZE_FILTERS.map((sf) => (
              <Button
                key={sf.value}
                variant={minUsd === sf.value ? "secondary" : "ghost"}
                size="sm"
                className="text-xs hidden sm:inline-flex"
                onClick={() => setMinUsd(sf.value)}
              >
                {sf.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by address (0x...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-9 text-sm"
          />
        </div>

        {/* KPI Cards */}
        {data?.kpi && !loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard
              icon={<DollarSign className="h-4 w-4" />}
              label="Total Notional"
              value={formatCompactNotional(data.kpi.totalNotional)}
            />
            <KPICard
              icon={<BarChart3 className="h-4 w-4" />}
              label="Avg Improvement"
              value={data.kpi.avgImprovementBps > 0 ? `+${data.kpi.avgImprovementBps} bps` : `${data.kpi.avgImprovementBps} bps`}
              positive={data.kpi.avgImprovementBps > 0}
            />
            <KPICard
              icon={<Shield className="h-4 w-4" />}
              label="Private Volume"
              value={`${data.kpi.privateVolumePct}%`}
            />
            <KPICard
              icon={<Activity className="h-4 w-4" />}
              label="Fill Count"
              value={data.kpi.fillCount.toLocaleString()}
            />
          </div>
        )}

        {/* My Rank Card */}
        {walletAddress && myEntry && (
          <Card className="border-primary/20 bg-primary/[0.03]">
            <CardContent className="py-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <RankBadge rank={myEntry.rank} />
                  <span className="text-sm font-medium">Your Rank</span>
                </div>
                <div className="flex items-center gap-4 text-sm ml-auto">
                  <StatMini label="Score" value={formatNotional(myEntry.score)} />
                  <StatMini label="Notional" value={formatNotional(myEntry.filledNotional)} className="hidden sm:block" />
                  <StatMini label="Fills" value={String(myEntry.fills)} className="hidden sm:block" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {walletAddress && !loading && !myEntry && data && (
          <Card className="border-border/30 bg-muted/10">
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground text-center">
                Complete your first RFQ swap to appear on the Liquidity League.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Callout */}
        <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
          <p className="text-xs text-muted-foreground text-center">
            HyperQuote rewards size, privacy, and capital-efficient liquidity — not spam.
          </p>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-center py-16 text-muted-foreground">
                <p>{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={fetchLeague}>
                  Retry
                </Button>
              </div>
            ) : data && data.entries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium w-16">Rank</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Address</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Filled Notional</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium hidden sm:table-cell">Avg Improvement (bps)</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">Private</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">Fills</th>
                      {role === "maker" && (
                        <th className="text-right px-4 py-3 text-muted-foreground font-medium hidden lg:table-cell">Reliability</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => {
                      const isMe = walletAddress && entry.address === walletAddress.toLowerCase();
                      return (
                        <tr
                          key={entry.address}
                          className={`border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer ${isMe ? "bg-primary/[0.03]" : ""}`}
                          onClick={() => handleRowClick(entry)}
                        >
                          <td className="px-4 py-3">
                            <RankBadge rank={entry.rank} />
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-primary inline-flex items-center gap-1">
                              {formatAddress(entry.address)}
                              {isMe && (
                                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                  You
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-medium">
                            {formatNotional(entry.filledNotional)}
                          </td>
                          <td className="px-4 py-3 text-right hidden sm:table-cell">
                            {entry.avgImprovementBps > 0 ? (
                              <span className="text-success">+{entry.avgImprovementBps} bps</span>
                            ) : entry.avgImprovementBps < 0 ? (
                              <span className="text-destructive">{entry.avgImprovementBps} bps</span>
                            ) : (
                              <span className="text-muted-foreground">0 bps</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <span className="text-muted-foreground">
                              {Math.round(entry.privateShare * 100)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono hidden md:table-cell">
                            {entry.fills}
                          </td>
                          {role === "maker" && (
                            <td className="px-4 py-3 text-right hidden lg:table-cell">
                              {entry.reliability != null ? (
                                <span className={entry.reliability < 0.8 ? "text-destructive" : "text-muted-foreground"}>
                                  {(entry.reliability * 100).toFixed(0)}%
                                </span>
                              ) : (
                                <span className="text-muted-foreground">&mdash;</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <Trophy className="h-10 w-10 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium mb-1">No activity yet</p>
                <p className="text-sm">
                  Complete RFQ swaps to earn a league ranking.
                </p>
                <Link href="/swap">
                  <Button variant="outline" size="sm" className="mt-4 gap-1">
                    Start Trading <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {data && data.totalParticipants > 0 && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              {data.totalParticipants} {role === "maker" ? "makers" : "takers"} ranked
              {period !== "all" ? ` in the last ${period}` : ""}
              {minUsd > 0 ? ` (min ${formatCompactNotional(minUsd)})` : ""}
            </p>
          </div>
        )}
      </div>

      {/* Detail Sheet / Drawer */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          {selectedEntry && (
              <>
                <SheetHeader className="mb-6">
                  <SheetTitle className="flex items-center gap-2">
                    <span className="font-mono text-base">
                      {safeChecksum(selectedEntry.address) ?? selectedEntry.address}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(selectedEntry.address)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      title="Copy address"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  </SheetTitle>
                  <SheetDescription>
                    {role === "maker" ? "Maker" : "Taker"} stats for{" "}
                    {period === "all" ? "all time" : `the last ${period}`}
                  </SheetDescription>
                </SheetHeader>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <StatCard label="Rank" value={`#${selectedEntry.rank}`} />
                  <StatCard label="League Score" value={formatNotional(selectedEntry.score)} />
                  <StatCard label="Filled Notional" value={formatNotional(selectedEntry.filledNotional)} />
                  <StatCard label="Fills" value={String(selectedEntry.fills)} />
                  <StatCard
                    label="Avg Improvement"
                    value={`${selectedEntry.avgImprovementBps > 0 ? "+" : ""}${selectedEntry.avgImprovementBps} bps`}
                  />
                  <StatCard
                    label="Private Share"
                    value={`${Math.round(selectedEntry.privateShare * 100)}%`}
                  />
                  {role === "maker" && (
                    <StatCard
                      label="Reliability"
                      value={selectedEntry.reliability != null ? `${(selectedEntry.reliability * 100).toFixed(0)}%` : "\u2014"}
                    />
                  )}
                </div>

                {/* Recent Activity */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    Recent Fills
                  </h3>
                  {activityLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : activity.length > 0 ? (
                    <div className="space-y-2">
                      {activity.map((fill) => (
                        <div
                          key={fill.txHash}
                          className="rounded-lg border border-border/40 bg-muted/10 p-3 text-xs"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-muted-foreground">
                              {formatAddress(fill.counterparty)}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(fill.filledAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="font-mono">
                              {fill.notionalUsd != null ? formatUsd(fill.notionalUsd) : "\u2014"}
                            </span>
                            <div className="flex items-center gap-2">
                              {fill.improvementBps != null && fill.benchmarkAvailable && (
                                <span className={fill.improvementBps > 0 ? "text-success" : fill.improvementBps < 0 ? "text-destructive" : "text-muted-foreground"}>
                                  {fill.improvementBps > 0 ? "+" : ""}{fill.improvementBps} bps
                                </span>
                              )}
                              {fill.isPrivate && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  Private
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No fills in this period
                    </p>
                  )}
                </div>

                <Link
                  href={`/profile/${selectedEntry.address}`}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  View Full Profile <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <Badge
        variant="outline"
        className={
          rank === 1
            ? "border-yellow-500/50 text-yellow-500 bg-yellow-500/10"
            : rank === 2
              ? "border-gray-400/50 text-gray-400 bg-gray-400/10"
              : "border-amber-600/50 text-amber-600 bg-amber-600/10"
        }
      >
        #{rank}
      </Badge>
    );
  }
  return <span className="text-muted-foreground">#{rank}</span>;
}

function KPICard({
  icon,
  label,
  value,
  positive,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className={`text-lg font-mono font-semibold ${positive ? "text-success" : ""}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-mono font-medium text-sm ${highlight ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function StatMini({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div className={`text-center ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono font-medium ${highlight ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}
