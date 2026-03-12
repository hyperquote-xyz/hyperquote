"use client";

/**
 * CoverageTooltip — Protocol Coverage Awareness Widget
 *
 * Small info icon next to the AMM Baseline header that shows
 * which protocols are included in the baseline and any gaps
 * (MANUAL_REQUIRED, no pools, no state data).
 */

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { CoverageData } from "@/hooks/useCoverage";
import { cn } from "@/lib/utils";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface CoverageTooltipProps {
  data: CoverageData | null;
  warnings: string[];
  loading?: boolean;
}

export function CoverageTooltip({
  data,
  warnings,
  loading,
}: CoverageTooltipProps) {
  if (loading || !data) return null;

  const hasWarnings = warnings.length > 0;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="inline-flex items-center">
            {hasWarnings ? (
              <AlertTriangle className="h-3 w-3 text-amber-500/70" />
            ) : (
              <Info className="h-3 w-3 text-muted-foreground/50" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm p-3">
          <div className="space-y-2">
            <p className="text-xs font-medium">Protocol Coverage</p>
            <div className="text-[11px] text-muted-foreground">
              {data.summary.withConnector}/{data.summary.totalProtocols} protocols have connectors ·{" "}
              {data.summary.totalPoolsWithState} pools with live state
            </div>

            {/* Protocol list */}
            <div className="space-y-1 pt-1">
              {data.protocols.map((p) => {
                const isActive = p.status === "ACTIVE";
                const hasState = p.poolsWithStateCount > 0;
                const isManual = p.discoveryMethod === "MANUAL_REQUIRED";

                return (
                  <div
                    key={p.slug}
                    className={cn(
                      "flex items-center justify-between text-[11px] gap-2",
                      !isActive && "opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {hasState ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : isManual ? (
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-muted-foreground/50" />
                      )}
                      <span>{p.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {isManual && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-500">
                          Manual
                        </Badge>
                      )}
                      {p.poolsWithStateCount > 0 && (
                        <span className="text-muted-foreground font-mono">
                          {p.poolsWithStateCount} pools
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Warnings */}
            {hasWarnings && (
              <div className="pt-1 border-t border-border/30 space-y-1">
                {warnings.map((w, i) => (
                  <p key={i} className="text-[10px] text-amber-500">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
