"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Info, Trophy, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "./formatNumber";

interface VenueRow {
  source: string;
  amountOut: number;
  route: string;
  status: string;
  isWinner: boolean;
  venues?: string[];
}

interface VenueDetailModalProps {
  rows: VenueRow[];
  tokenOutSymbol: string;
}

export function VenueDetailModal({ rows, tokenOutSymbol }: VenueDetailModalProps) {
  if (rows.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1 text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-help">
          <Info className="h-3 w-3" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Venue Comparison Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {rows.map((row, i) => (
            <div
              key={row.source}
              className={cn(
                "rounded-lg border p-3 space-y-1.5",
                row.isWinner
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/30 bg-card/30"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {row.isWinner && <Trophy className="h-3.5 w-3.5 text-primary" />}
                  <span className={cn(
                    "text-sm font-medium",
                    row.isWinner ? "text-primary" : "text-foreground/80"
                  )}>
                    {row.source}
                    {row.isWinner && <span className="text-[10px] ml-1.5 text-primary/70">(Winner)</span>}
                  </span>
                </div>
                <span className="text-sm font-mono tabular-nums">
                  {row.amountOut > 0 ? fmtNum(row.amountOut) : "—"}
                  {row.amountOut > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">{tokenOutSymbol}</span>
                  )}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground/80">
                Route: {row.route || "—"}
              </div>
              <div className={cn(
                "text-[10px]",
                row.amountOut > 0 ? "text-success/70" : "text-muted-foreground/70"
              )}>
                {row.status}
              </div>
              {row.venues && row.venues.length > 0 && (
                <div className="text-[10px] text-muted-foreground/70">
                  Venues: {row.venues.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
