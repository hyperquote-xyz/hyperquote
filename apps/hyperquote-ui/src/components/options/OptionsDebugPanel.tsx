"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatAddress } from "@/lib/utils";
import { Bug, ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import type { OptionsDebugInfo } from "./OptionsInterface";

interface OptionsDebugPanelProps {
  debug: OptionsDebugInfo;
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <span
        className={cn(
          "text-[11px] text-right break-all",
          mono && "font-mono",
          !value && "text-muted-foreground/40",
        )}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

export function OptionsDebugPanel({ debug }: OptionsDebugPanelProps) {
  const [open, setOpen] = useState(false);

  const hasAny =
    debug.rfqId || debug.quoteHash || debug.recoveredRequester || debug.recoveredMaker;

  return (
    <Card className="border-dashed border-muted-foreground/20">
      <CardHeader
        className="pb-0 pt-3 px-4 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
          <Bug className="h-3 w-3" />
          Debug
          {open ? (
            <ChevronDown className="h-3 w-3 ml-auto" />
          ) : (
            <ChevronRight className="h-3 w-3 ml-auto" />
          )}
        </CardTitle>
      </CardHeader>

      {open && (
        <CardContent className="px-4 pb-3 pt-2 space-y-1 divide-y divide-border/20">
          {/* RFQ Section */}
          <div className="space-y-0.5 pb-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              RFQ
            </div>
            <Row label="rfqId" value={debug.rfqId} mono />
            <Row label="signed hash" value={debug.signedMessageHash} mono />
            <Row
              label="recovered requester"
              value={debug.recoveredRequester ? formatAddress(debug.recoveredRequester, 8) : null}
              mono
            />
            {debug.recoveredRequester && (
              <div className="text-[10px] font-mono text-muted-foreground/50 break-all">
                {debug.recoveredRequester}
              </div>
            )}
          </div>

          {/* Quote Section */}
          <div className="space-y-0.5 pt-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Quote
            </div>
            <Row label="quote hash" value={debug.quoteHash} mono />
            <Row
              label="recovered maker"
              value={debug.recoveredMaker ? formatAddress(debug.recoveredMaker, 8) : null}
              mono
            />
            {debug.recoveredMaker && (
              <div className="text-[10px] font-mono text-muted-foreground/50 break-all">
                {debug.recoveredMaker}
              </div>
            )}
            {debug.verifiedMaker !== null && (
              <div className="flex items-center gap-1.5 pt-1">
                {debug.verifiedMaker ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    <Badge
                      variant="outline"
                      className="text-[10px] border-emerald-500/40 text-emerald-500 px-1.5 py-0"
                    >
                      Sig Valid
                    </Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 text-red-500" />
                    <Badge
                      variant="outline"
                      className="text-[10px] border-red-500/40 text-red-500 px-1.5 py-0"
                    >
                      Sig Invalid
                    </Badge>
                  </>
                )}
              </div>
            )}
          </div>

          {!hasAny && (
            <p className="text-[10px] text-muted-foreground/40 pt-2">
              Submit an RFQ to see debug info
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
