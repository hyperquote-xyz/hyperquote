"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Trophy, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface TakerProfile {
  tier: "bronze" | "silver" | "gold";
  taker30d: {
    points: number;
    volume: number;
    fills: number;
    avgImprovementBps: number;
  };
}

const TIER_BADGE_STYLES = {
  bronze: "border-amber-600/40 text-amber-600 bg-amber-600/10",
  silver: "border-gray-400/40 text-gray-400 bg-gray-400/10",
  gold: "border-yellow-500/40 text-yellow-500 bg-yellow-500/10",
} as const;

/**
 * Compact taker reputation badge — fetches /api/v1/profile/{address}
 * and shows fill count + tier. Renders inline next to a taker address.
 */
export function TakerBadge({ address }: { address: string }) {
  const [profile, setProfile] = useState<TakerProfile | null>(null);

  useEffect(() => {
    if (!address || !/^0x[0-9a-fA-F]{40}$/i.test(address)) return;

    let cancelled = false;
    fetch(`/api/v1/profile/${address}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TakerProfile | null) => {
        if (!cancelled && data) setProfile(data);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [address]);

  if (!profile) return null;

  const { tier, taker30d } = profile;
  const tierStyle = TIER_BADGE_STYLES[tier];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1">
            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 gap-0.5", tierStyle)}>
              <Trophy className="h-2.5 w-2.5" />
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </Badge>
            {taker30d.fills > 0 && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-0.5 border-muted-foreground/30 text-muted-foreground">
                <Activity className="h-2.5 w-2.5" />
                {taker30d.fills} fills
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-0.5">
            <p>Taker — 30d stats</p>
            <p>Fills: {taker30d.fills} | Volume: ${taker30d.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            {taker30d.avgImprovementBps > 0 && (
              <p>Avg improvement: +{taker30d.avgImprovementBps} bps</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
