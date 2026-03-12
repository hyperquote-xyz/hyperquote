"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  Trophy,
  TrendingUp,
  BarChart3,
  Zap,
} from "lucide-react";

interface PeriodStats {
  points: number;
  volume: number;
  fills: number;
  avgImprovementBps: number;
}

interface ProfileData {
  address: string;
  tier: "bronze" | "silver" | "gold";
  maker7d: PeriodStats;
  maker30d: PeriodStats;
  taker7d: PeriodStats;
  taker30d: PeriodStats;
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

function StatCard({
  label,
  stat7d,
  stat30d,
  format = "number",
}: {
  label: string;
  stat7d: number;
  stat30d: number;
  format?: "number" | "usd" | "bps";
}) {
  const fmt = (v: number) => {
    if (format === "usd") return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (format === "bps") return `${v > 0 ? "+" : ""}${v} bps`;
    return v.toLocaleString();
  };

  return (
    <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
      <div className="text-xs text-muted-foreground mb-2">{label}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-muted-foreground/60 mb-0.5">7d</div>
          <div className="font-mono font-medium text-sm">{fmt(stat7d)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground/60 mb-0.5">30d</div>
          <div className="font-mono font-medium text-sm">{fmt(stat30d)}</div>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchProfile() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/profile/${address}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ProfileData = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [address]);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 md:py-12 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-8 md:py-12 text-center">
        <p className="text-muted-foreground mb-4">{error ?? "Profile not found"}</p>
        <Link href="/points">
          <Button variant="outline" size="sm" className="gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Points
          </Button>
        </Link>
      </div>
    );
  }

  const tierCfg = TIER_CONFIG[data.tier];

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Back link */}
        <Link
          href="/points"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Points
        </Link>

        {/* Header */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg md:text-xl">{address}</span>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
          <Badge variant="outline" className={tierCfg.className}>
            <Trophy className="h-3 w-3 mr-1" />
            {tierCfg.label}
          </Badge>
        </div>

        {/* Maker Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Maker Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3">
              <StatCard label="Points" stat7d={data.maker7d.points} stat30d={data.maker30d.points} />
              <StatCard label="Volume" stat7d={data.maker7d.volume} stat30d={data.maker30d.volume} format="usd" />
              <StatCard label="Avg Improvement" stat7d={data.maker7d.avgImprovementBps} stat30d={data.maker30d.avgImprovementBps} format="bps" />
              <StatCard label="Fills" stat7d={data.maker7d.fills} stat30d={data.maker30d.fills} />
            </div>
          </CardContent>
        </Card>

        {/* Taker Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Taker Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3">
              <StatCard label="Points" stat7d={data.taker7d.points} stat30d={data.taker30d.points} />
              <StatCard label="Volume" stat7d={data.taker7d.volume} stat30d={data.taker30d.volume} format="usd" />
              <StatCard label="Avg Improvement" stat7d={data.taker7d.avgImprovementBps} stat30d={data.taker30d.avgImprovementBps} format="bps" />
              <StatCard label="Fills" stat7d={data.taker7d.fills} stat30d={data.taker30d.fills} />
            </div>
          </CardContent>
        </Card>

        {/* Activity summary */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
            <BarChart3 className="h-3 w-3" />
            Tier is based on 30-day maker points: Bronze (&lt;10k), Silver (&lt;100k), Gold (&ge;100k)
          </p>
        </div>
      </div>
    </div>
  );
}
