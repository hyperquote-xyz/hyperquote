"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { Copy, Link2, CheckCircle2, FileOutput } from "lucide-react";

interface ExportRFQPanelProps {
  /** Stringified request JSON — null when no RFQ is selected. */
  requestJSON: string | null;
  requestId?: string;
  shareToken?: string | null;
  /** Display context (only meaningful when an RFQ is selected) */
  pairLabel?: string; // "USDC → PURR"
  sizeLabel?: string; // "70,000 USDC"
  visibility?: "public" | "private";
}

export function ExportRFQPanel({
  requestJSON,
  requestId,
  shareToken,
  pairLabel,
  sizeLabel,
  visibility,
}: ExportRFQPanelProps) {
  const [copiedJSON, setCopiedJSON] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyJSON = async () => {
    if (!requestJSON) return;
    try {
      await navigator.clipboard.writeText(requestJSON);
      setCopiedJSON(true);
      toast({ title: "Copied!", description: "Request JSON copied to clipboard" });
      setTimeout(() => setCopiedJSON(false), 2000);
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  const handleCopyLink = async () => {
    if (!requestJSON) return;
    // Prefer short share-token URL when available, fall back to base64
    const link = shareToken
      ? `${window.location.origin}/api/rfq/${shareToken}`
      : `${window.location.origin}/swap?rfq=${btoa(requestJSON)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      toast({ title: "Copied!", description: "Shareable link copied to clipboard" });
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  // ── No RFQ selected — show helper text ──
  if (!requestJSON) {
    return (
      <Card className="border-dashed border-border/50 bg-muted/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileOutput className="h-4 w-4 text-muted-foreground" />
            Export Selected RFQ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-2">
            Select an active RFQ from &lsquo;Your Live RFQs&rsquo; to export or share it.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── RFQ selected — show context + action buttons ──
  return (
    <Card className="border-dashed border-primary/30 bg-primary/[0.02]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileOutput className="h-4 w-4 text-primary" />
          Export Selected RFQ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Context line: Selected RFQ details */}
        {pairLabel && (
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs">
            <span className="text-muted-foreground">Selected RFQ:</span>
            <span className="font-medium">{pairLabel}</span>
            {sizeLabel && (
              <>
                <span className="text-muted-foreground">&middot;</span>
                <span className="font-mono">{sizeLabel}</span>
              </>
            )}
            {visibility && (
              <>
                <span className="text-muted-foreground">&middot;</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${
                    visibility === "private"
                      ? "border-primary/40 text-primary"
                      : "border-emerald-500/40 text-emerald-500"
                  }`}
                >
                  {visibility === "private" ? "Private" : "Public"}
                </Badge>
              </>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Copy the request JSON or a shareable link for this RFQ.
        </p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            onClick={handleCopyJSON}
            disabled={!requestJSON}
          >
            {copiedJSON ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copy Request JSON
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            onClick={handleCopyLink}
            disabled={!requestJSON}
          >
            {copiedLink ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Copy Shareable Link
          </Button>
        </div>

        {/* JSON Preview */}
        {requestJSON && (
          <details className="group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
              Preview request JSON
            </summary>
            <pre className="mt-2 p-2 rounded bg-muted/50 text-xs font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {requestJSON}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
