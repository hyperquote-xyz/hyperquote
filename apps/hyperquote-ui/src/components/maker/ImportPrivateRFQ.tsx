"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { RFQRequest, RFQRequestJSON, requestFromJSON } from "@/types";
import { cn, safeSymbol } from "@/lib/utils";
import { Lock, Upload, FileText } from "lucide-react";

interface ImportPrivateRFQProps {
  onImport: (request: RFQRequest) => void;
}

export function ImportPrivateRFQ({ onImport }: ImportPrivateRFQProps) {
  const [value, setValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const handleLoad = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast({ title: "Empty input", description: "Paste a request JSON first", variant: "destructive" });
      return;
    }
    try {
      const json = JSON.parse(trimmed) as RFQRequestJSON;
      const request = requestFromJSON(json);

      // Validate basics
      if (!request.id || !request.taker || !request.tokenIn || !request.tokenOut) {
        throw new Error("Missing required fields");
      }
      const now = Math.floor(Date.now() / 1000);
      if (request.expiry <= now) {
        toast({ title: "Request expired", description: "This request has already expired", variant: "destructive" });
        return;
      }

      onImport(request);
      setValue("");
      setIsOpen(false);
      toast({ title: "Request loaded", description: `${safeSymbol(request.tokenIn)} → ${safeSymbol(request.tokenOut)}` });
    } catch {
      toast({ title: "Invalid JSON", description: "Check the format and try again", variant: "destructive" });
    }
  };

  return (
    <Card className="border-dashed border-primary/20 bg-primary/[0.01]">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full group"
        >
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Import Private RFQ
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {isOpen ? "Close" : "Open"}
          </Badge>
        </button>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-3 pt-0">
          <p className="text-xs text-muted-foreground">
            Paste a private RFQ request JSON shared directly by a taker.
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='{"id":"...","kind":0,"taker":"0x...","tokenIn":{...},...}'
            className={cn(
              "w-full min-h-[100px] rounded-lg border border-border/50 bg-background/50 p-3",
              "text-xs font-mono resize-none",
              "focus:outline-none focus:ring-2 focus:ring-ring"
            )}
          />
          <Button size="sm" onClick={handleLoad} className="w-full gap-2" disabled={!value.trim()}>
            <Upload className="h-3.5 w-3.5" />
            Load Request
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
