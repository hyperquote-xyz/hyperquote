"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatAddress, formatUsd } from "@/lib/utils";
import {
  Star,
  Users,
  TrendingUp,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Image from "next/image";
import { useBadges } from "@/hooks/useBadges";
import { BadgePills } from "@/components/BadgePills";
import { NFT_BADGES } from "@/lib/badges";
import { getAddress } from "viem";
import { useAccount } from "wagmi";
import { MOCK_MODE } from "@/lib/mockMode";
import { MOCK_MAKERS, MOCK_TAKERS } from "@/lib/mockLeagueData";

/** Derive mock badge ownership from boostMultiplier so pills render without API. */
function mockBadgesFromBoost(boost: number): { hasHypio: boolean; hasHypurr: boolean } {
  if (boost >= 2.0) return { hasHypio: true, hasHypurr: true };
  if (boost >= 1.5) return { hasHypio: false, hasHypurr: true };
  if (boost >= 1.25) return { hasHypio: true, hasHypurr: false };
  return { hasHypio: false, hasHypurr: false };
}

/** Safely checksum an address — returns null on invalid input. */
function safeChecksum(addr: string): string | null {
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

/** Convert cancelRate (0-1, higher = worse) to reliability (0-100%, higher = better). */
function toReliability(cancelRate: number | null): string {
  if (cancelRate == null) return "\u2014";
  return `${Math.round((1 - cancelRate) * 100)}%`;
}

/** Is reliability below 80%? (cancelRate > 0.2) */
function isLowReliability(cancelRate: number | null): boolean {
  if (cancelRate == null) return false;
  return cancelRate > 0.2;
}

type Tab = "makers" | "takers";
type Window = "7d" | "30d" | "all";

interface LeaderboardEntry {
  rank: number;
  address: string;
  points: number;
  rawPoints: number;
  volume: number;
  fills: number;
  avgImprovementBps: number;
  cancelRate: number | null;
  boostMultiplier: number;
}

interface LeaderboardResponse {
  tab: Tab;
  window: Window;
  entries: LeaderboardEntry[];
  totalParticipants: number;
  hasMore: boolean;
}

interface MyRankResponse {
  rank: number | null;
  entry: LeaderboardEntry | null;
  totalParticipants: number;
}

export default function PointsPage() {
  const { address: walletAddress } = useAccount();
  const [tab, setTab] = useState<Tab>("makers");
  const [timeWindow, setTimeWindow] = useState<Window>("7d");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // My Rank state
  const [myRank, setMyRank] = useState<MyRankResponse | null>(null);
  const [myRankLoading, setMyRankLoading] = useState(false);

  // Sheet state
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // How Points Work disclosure
  const [howOpen, setHowOpen] = useState(false);

  // Fetch points data
  const fetchPoints = useCallback(async () => {
    setLoading(true);
    setError(null);

    // ── Mock mode: convert league data to points format ──
    if (MOCK_MODE) {
      const source = tab === "makers" ? MOCK_MAKERS : MOCK_TAKERS;
      const entries: LeaderboardEntry[] = source.map((e, i) => ({
        rank: i + 1,
        address: e.address,
        points: e.points,
        rawPoints: e.rawScore,
        volume: e.filledNotional,
        fills: e.fills,
        avgImprovementBps: e.avgImprovementBps,
        cancelRate: e.cancelRate,
        boostMultiplier: e.boostMultiplier,
      }));
      setData({
        tab,
        window: timeWindow,
        entries,
        totalParticipants: source.length,
        hasMore: false,
      });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/v1/leaderboard?tab=${tab}&window=${timeWindow}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: LeaderboardResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load points");
    } finally {
      setLoading(false);
    }
  }, [tab, timeWindow]);

  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  // Fetch My Rank when wallet connected
  useEffect(() => {
    if (!walletAddress || MOCK_MODE) {
      setMyRank(null);
      return;
    }

    let cancelled = false;
    setMyRankLoading(true);

    fetch(`/api/v1/leaderboard/me?address=${walletAddress}&tab=${tab}&window=${timeWindow}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: MyRankResponse) => {
        if (!cancelled) setMyRank(json);
      })
      .catch(() => {
        if (!cancelled) setMyRank(null);
      })
      .finally(() => {
        if (!cancelled) setMyRankLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletAddress, tab, timeWindow]);

  // Derive addresses for badge lookups (skip in mock mode)
  const pointsAddresses = useMemo(
    () => (MOCK_MODE ? [] : (data?.entries ?? []).map((e) => e.address)),
    [data]
  );
  const badges = useBadges(pointsAddresses);

  // Copy address to clipboard
  const handleCopy = useCallback((addr: string) => {
    navigator.clipboard.writeText(safeChecksum(addr) ?? addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // Open row detail sheet
  const handleRowClick = useCallback((entry: LeaderboardEntry) => {
    setSelectedEntry(entry);
    setSheetOpen(true);
    setCopied(false);
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      {MOCK_MODE && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2 mb-4 text-center">
          <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
            DEV MODE — Mock Points Data
          </p>
        </div>
      )}
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2 flex items-center justify-center gap-2">
          <Star className="h-7 w-7 text-primary" />
          Points Program
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Earn points for providing and executing liquidity on HyperQuote.
          Points reward size, price improvement, reliability, and privacy.
        </p>
      </div>

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Controls */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="makers" className="gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Makers
              </TabsTrigger>
              <TabsTrigger value="takers" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" />
                Takers
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-2">
            {(["7d", "30d", "all"] as Window[]).map((w) => (
              <Button
                key={w}
                variant={timeWindow === w ? "default" : "outline"}
                size="sm"
                onClick={() => setTimeWindow(w)}
              >
                {w === "all" ? "All" : w.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {/* NFT Boost Info Card */}
        <Card className="border-primary/20 bg-primary/[0.02]">
          <CardContent className="py-4 px-5">
            <div className="flex items-start justify-between gap-4">
              {/* Left: text content */}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium flex items-center gap-1.5 mb-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  HyperEVM NFT Boosts Active
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Holding eligible NFTs increases your points multiplier:
                </p>
                <ul className="text-xs text-muted-foreground mt-1.5 space-y-0.5 ml-4 list-disc">
                  <li>Hypurr — 1.5x points</li>
                  <li>Lucky Hypio Winners — 1.25x points</li>
                  <li>Holding both — 2.0x multiplier</li>
                </ul>
                <p className="text-xs text-muted-foreground mt-2">
                  Boosts apply automatically when your wallet holds the NFT.
                </p>
              </div>

              {/* Right: NFT avatars */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full overflow-hidden border-2 border-border/60 shadow-sm" style={{ width: 48, height: 48 }}>
                  <Image
                    src={NFT_BADGES.hypurr.icon}
                    alt="Hypurr"
                    width={48}
                    height={48}
                    className="block object-cover w-full h-full"
                  />
                </span>
                <span className="rounded-full overflow-hidden border-2 border-border/60 shadow-sm" style={{ width: 48, height: 48 }}>
                  <Image
                    src={NFT_BADGES.hypio.icon}
                    alt="Hypio"
                    width={48}
                    height={48}
                    className="block object-cover w-full h-full"
                  />
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* How Points Work — collapsible disclosure */}
        <div className="border-t border-border/30 pt-4">
          <button
            type="button"
            onClick={() => setHowOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {howOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            How Points Work
          </button>
          {howOpen && (
            <div className="mt-3 space-y-3 text-xs text-muted-foreground leading-relaxed">
              <p>
                Points reward meaningful liquidity contribution on HyperQuote.
              </p>
              <div>
                <p className="mb-1.5">Base scoring considers:</p>
                <ul className="ml-4 list-disc space-y-0.5">
                  <li>Filled notional size — larger trades earn more points</li>
                  <li>Price improvement vs on-chain baseline — tighter execution earns more</li>
                  <li>Private participation — block trades and selective liquidity are rewarded</li>
                  <li>Execution reliability — consistent fills matter</li>
                </ul>
              </div>
              <p>
                Points scale sublinearly with size and discourage repetitive or low-quality activity.
              </p>
              <p>
                Eligible NFT boosts are applied after base points are calculated.
              </p>
              <p>
                Scoring parameters may evolve over time to maintain fairness and protect program integrity.
              </p>
            </div>
          )}
        </div>

        {/* My Rank Card */}
        {walletAddress && !myRankLoading && myRank && (
          <Card className="border-primary/20 bg-primary/[0.03]">
            <CardContent className="py-4">
              {myRank.entry ? (
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    {myRank.rank && myRank.rank <= 3 ? (
                      <Badge
                        variant="outline"
                        className={
                          myRank.rank === 1
                            ? "border-yellow-500/50 text-yellow-500 bg-yellow-500/10"
                            : myRank.rank === 2
                              ? "border-gray-400/50 text-gray-400 bg-gray-400/10"
                              : "border-amber-600/50 text-amber-600 bg-amber-600/10"
                        }
                      >
                        #{myRank.rank}
                      </Badge>
                    ) : (
                      <span className="text-sm font-mono text-muted-foreground">
                        #{myRank.rank}
                      </span>
                    )}
                    <span className="text-sm font-medium">Your Rank</span>
                  </div>

                  <div className="flex items-center gap-4 text-sm ml-auto">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Points</p>
                      <p className="font-mono font-medium">{myRank.entry.points.toLocaleString()}</p>
                    </div>
                    <div className="text-center hidden sm:block">
                      <p className="text-xs text-muted-foreground">Notional</p>
                      <p className="font-mono font-medium">{formatUsd(myRank.entry.volume)}</p>
                    </div>
                    <div className="text-center hidden sm:block">
                      <p className="text-xs text-muted-foreground">Fills</p>
                      <p className="font-mono font-medium">{myRank.entry.fills}</p>
                    </div>
                    {myRank.entry.boostMultiplier > 1 && (
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Boost</p>
                        <p className="font-mono font-medium text-primary">{myRank.entry.boostMultiplier}x</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  Complete your first RFQ swap to start earning points.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Subheading */}
        <p className="text-xs text-muted-foreground text-center">
          Ranked by points earned through competitive liquidity and execution quality.
        </p>

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
                <Button variant="outline" size="sm" className="mt-4" onClick={fetchPoints}>
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
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium hidden sm:table-cell">Boost</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Points</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium hidden sm:table-cell">Notional</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">Avg Improvement (bps)</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">Fills</th>
                      {tab === "makers" && (
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
                            {entry.rank <= 3 ? (
                              <Badge
                                variant="outline"
                                className={
                                  entry.rank === 1
                                    ? "border-yellow-500/50 text-yellow-500 bg-yellow-500/10"
                                    : entry.rank === 2
                                      ? "border-gray-400/50 text-gray-400 bg-gray-400/10"
                                      : "border-amber-600/50 text-amber-600 bg-amber-600/10"
                                }
                              >
                                #{entry.rank}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">#{entry.rank}</span>
                            )}
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
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <div className="min-h-[24px] flex items-center">
                              {(() => {
                                if (MOCK_MODE) {
                                  const mb = mockBadgesFromBoost(entry.boostMultiplier);
                                  return <BadgePills hasHypio={mb.hasHypio} hasHypurr={mb.hasHypurr} size="md" />;
                                }
                                const key = safeChecksum(entry.address);
                                const b = key ? badges.get(key) : undefined;
                                return (
                                  <BadgePills
                                    hasHypio={b?.hasHypio ?? false}
                                    hasHypurr={b?.hasHypurr ?? false}
                                    size="md"
                                  />
                                );
                              })()}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-medium">
                            {entry.points.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono hidden sm:table-cell">
                            {formatUsd(entry.volume)}
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            {entry.avgImprovementBps > 0 ? (
                              <span className="text-success">+{entry.avgImprovementBps} bps</span>
                            ) : entry.avgImprovementBps < 0 ? (
                              <span className="text-destructive">{entry.avgImprovementBps} bps</span>
                            ) : (
                              <span className="text-muted-foreground">0 bps</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono hidden md:table-cell">
                            {entry.fills}
                          </td>
                          {tab === "makers" && (
                            <td className="px-4 py-3 text-right hidden lg:table-cell">
                              <span className={isLowReliability(entry.cancelRate) ? "text-destructive" : "text-muted-foreground"}>
                                {toReliability(entry.cancelRate)}
                              </span>
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
                <Star className="h-10 w-10 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium mb-1">No points earned yet</p>
                <p className="text-sm">
                  Complete RFQ swaps to earn points and climb the rankings.
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
              {data.totalParticipants} {tab === "makers" ? "makers" : "takers"} active
              {timeWindow !== "all" ? ` in the last ${timeWindow}` : ""}
            </p>
          </div>
        )}

        {/* Footer disclaimer */}
        <p className="text-[11px] text-muted-foreground/60 text-center mt-2">
          HyperQuote may update scoring parameters to prevent manipulation and ensure fair incentives across the ecosystem.
        </p>
      </div>

      {/* Detail Sheet */}
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
                  <span className="inline-flex items-center gap-2">
                    {tab === "makers" ? "Maker" : "Taker"} stats for {timeWindow === "all" ? "all time" : `the last ${timeWindow}`}
                    {(() => {
                      if (MOCK_MODE) {
                        const mb = mockBadgesFromBoost(selectedEntry.boostMultiplier);
                        return <BadgePills hasHypio={mb.hasHypio} hasHypurr={mb.hasHypurr} size="sm" />;
                      }
                      const key = safeChecksum(selectedEntry.address);
                      const b = key ? badges.get(key) : undefined;
                      return (
                        <BadgePills
                          hasHypio={b?.hasHypio ?? false}
                          hasHypurr={b?.hasHypurr ?? false}
                          size="sm"
                        />
                      );
                    })()}
                  </span>
                </SheetDescription>
              </SheetHeader>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <StatCard label="Rank" value={`#${selectedEntry.rank}`} />
                <StatCard label="Points" value={selectedEntry.points.toLocaleString()} />
                <StatCard label="Notional" value={formatUsd(selectedEntry.volume)} />
                <StatCard label="Fills" value={String(selectedEntry.fills)} />
                <StatCard
                  label="Avg Improvement (bps)"
                  value={`${selectedEntry.avgImprovementBps > 0 ? "+" : ""}${selectedEntry.avgImprovementBps} bps`}
                />
                {tab === "makers" && (
                  <StatCard
                    label="Reliability"
                    value={toReliability(selectedEntry.cancelRate)}
                  />
                )}
                {selectedEntry.boostMultiplier > 1 && (
                  <StatCard
                    label="Boost Multiplier"
                    value={`${selectedEntry.boostMultiplier}x`}
                    highlight
                  />
                )}
              </div>

              <Link
                href={`/profile/${selectedEntry.address}`}
                className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                View Full Profile <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card for the detail sheet
// ---------------------------------------------------------------------------

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
