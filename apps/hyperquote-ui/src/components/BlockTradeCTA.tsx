"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, ArrowRight } from "lucide-react";

interface BlockTradeCTAProps {
  onStartBlockTrade: () => void;
}

export function BlockTradeCTA({ onStartBlockTrade }: BlockTradeCTAProps) {
  return (
    <Card className="border-dashed border-primary/30 bg-primary/[0.03]">
      <CardContent className="py-5">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Block Trade</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Send a private RFQ to selected liquidity providers.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={onStartBlockTrade}
          >
            Start Block Trade
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
