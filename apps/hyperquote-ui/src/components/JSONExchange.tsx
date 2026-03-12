"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { Copy, Download, Upload, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface JSONExchangeProps {
  title: string;
  description: string;
  exportLabel: string;
  importLabel: string;
  exportData: string | null;
  onImport: (json: string) => boolean;
  importPlaceholder?: string;
}

export function JSONExchange({
  title,
  description,
  exportLabel,
  importLabel,
  exportData,
  onImport,
  importPlaceholder = "Paste JSON here...",
}: JSONExchangeProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!exportData) return;

    try {
      await navigator.clipboard.writeText(exportData);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "JSON copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  const handleImport = () => {
    if (!importValue.trim()) {
      toast({
        title: "Empty input",
        description: "Please paste valid JSON",
        variant: "destructive",
      });
      return;
    }

    const success = onImport(importValue);
    if (success) {
      setImportOpen(false);
      setImportValue("");
      toast({
        title: "Imported!",
        description: "Data imported successfully",
      });
    } else {
      toast({
        title: "Invalid JSON",
        description: "Please check the format and try again",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-dashed bg-muted/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Badge variant="outline" className="text-xs">
            Demo Mode
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{description}</p>

        <div className="flex gap-2">
          {/* Export Button */}
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            onClick={handleCopy}
            disabled={!exportData}
          >
            {copied ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {exportLabel}
          </Button>

          {/* Import Dialog */}
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="flex-1 gap-2">
                <Upload className="h-4 w-4" />
                {importLabel}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{importLabel}</DialogTitle>
              </DialogHeader>
              <textarea
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                placeholder={importPlaceholder}
                className={cn(
                  "min-h-[200px] w-full rounded-lg border border-border/50 bg-background/50 p-3 text-sm font-mono",
                  "focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                )}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleImport}>Import</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Preview */}
        {exportData && (
          <details className="group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
              Preview exported data
            </summary>
            <pre className="mt-2 p-2 rounded bg-muted/50 text-xs font-mono overflow-x-auto max-h-32 overflow-y-auto">
              {exportData}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
