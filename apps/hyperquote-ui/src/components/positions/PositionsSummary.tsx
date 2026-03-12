"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, DollarSign, Lock } from "lucide-react";
import type { PositionsSummary as SummaryData } from "@/lib/positions-utils";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PositionsSummaryProps {
  summary: SummaryData;
}

export function PositionsSummary({ summary }: PositionsSummaryProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Active Positions */}
      <Card>
        <CardContent className="flex items-center gap-3 py-4 px-5">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Active Positions</p>
            <p className="text-lg font-semibold font-mono">
              {summary.activeCount}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Premium Collected */}
      <Card>
        <CardContent className="flex items-center gap-3 py-4 px-5">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Premium Collected</p>
            <p className="text-lg font-semibold font-mono">
              ${summary.totalPremiumCollected.toFixed(2)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Collateral Locked */}
      <Card>
        <CardContent className="flex items-center gap-3 py-4 px-5">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Lock className="h-4 w-4 text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Collateral Locked</p>
            <p className="text-lg font-semibold font-mono">
              {summary.totalCollateralLocked.toFixed(2)}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
