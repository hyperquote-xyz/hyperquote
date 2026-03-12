"use client";

/**
 * PositionsInterface — orchestrator for the Positions tab.
 *
 * Composes:
 *   - usePositions hook (multicall + polling)
 *   - PositionsSummary (summary strip)
 *   - PositionsTable (active positions with expandable detail)
 *   - ExpiredPositions (collapsed section)
 *   - Empty state (no positions CTA)
 */

import { useAccount } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Loader2, Shield, Wallet, ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePositions } from "@/hooks/usePositions";
import { computeSummary } from "@/lib/positions-utils";
import { PositionsSummary } from "./PositionsSummary";
import { PositionsTable } from "./PositionsTable";
import { ExpiredPositions } from "./ExpiredPositions";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PositionsInterface() {
  const { isConnected } = useAccount();
  const { positions, loading, error, refetch, lastUpdated } = usePositions();

  // Split by lifecycle — pending_expiry stays in active table (keeper hasn't finalized)
  const active = positions.filter(
    (p) => p.lifecycle === "active" || p.lifecycle === "pending_expiry",
  );
  const expired = positions.filter(
    (p) => p.lifecycle === "expired" || p.lifecycle === "settled",
  );

  const summary = computeSummary(positions);

  // ---------------------------------------------------------------------------
  // Not connected state
  // ---------------------------------------------------------------------------
  if (!isConnected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div className="p-3 rounded-full bg-muted/50">
            <Wallet className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="font-medium">Connect Your Wallet</p>
            <p className="text-sm text-muted-foreground">
              Connect your wallet to view your HyperQuote Options positions.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading state (initial only)
  // ---------------------------------------------------------------------------
  if (loading && positions.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Loading positions…
          </span>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (error && positions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty state — no positions at all
  // ---------------------------------------------------------------------------
  if (positions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div className="p-3 rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div className="text-center space-y-1">
            <p className="font-medium">No Positions Yet</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              You haven&apos;t written any options yet. Start by creating a
              covered call or cash-secured put on the Options page.
            </p>
          </div>
          <Link href="/options">
            <Button className="gap-2 mt-2">
              Go to Options
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Main positions view
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header bar — refresh + last updated */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastUpdated && (
            <span>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {loading && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          {error && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              Stale
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      {/* Summary strip */}
      <PositionsSummary summary={summary} />

      {/* Keeper transparency */}
      <p className="text-xs text-muted-foreground">
        Settlement automated via permissionless keepers.
      </p>

      {/* Active positions table */}
      <PositionsTable positions={active} />

      {/* Expired / settled positions (collapsed) */}
      <ExpiredPositions positions={expired} />
    </div>
  );
}
