"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { useMakerRFQ } from "@/hooks/useRFQ";
import { formatAddress } from "@/lib/utils";
import { Shield, Hash, XCircle, Loader2, Info } from "lucide-react";
import type { ConnectionStatus } from "@/lib/makerRelay";

interface MakerSettingsProps {
  address?: `0x${string}`;
  relayEnabled: boolean;
  relayStatus: ConnectionStatus;
}

export function MakerSettings({
  address,
  relayEnabled,
  relayStatus,
}: MakerSettingsProps) {
  const { makerNonce, cancelAllQuotes } = useMakerRFQ();
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancelAll = async () => {
    setIsCancelling(true);
    const ok = await cancelAllQuotes();
    setIsCancelling(false);
    if (ok) {
      toast({ title: "All quotes cancelled", description: "Nonce incremented — all outstanding quotes are invalidated" });
    } else {
      toast({ title: "Failed", description: "Could not cancel quotes", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      {/* Account */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Maker Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Address</span>
            <span className="font-mono">{address ? formatAddress(address, 6) : "—"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1">
              <Hash className="h-3 w-3" />
              Nonce
            </span>
            <span className="font-mono">{makerNonce?.toString() ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Relay</span>
            <Badge variant={relayEnabled ? "default" : "outline"} className="text-[10px]">
              {relayEnabled ? `${relayStatus}` : "Disabled"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Cancel All */}
      <Card className="border-destructive/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-destructive">
            <XCircle className="h-4 w-4" />
            Cancel All Quotes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Increments your on-chain nonce, instantly invalidating every outstanding signed quote.
            This is irreversible — you will need to sign new quotes.
          </p>
          <Button
            variant="destructive"
            size="sm"
            className="w-full gap-2"
            disabled={isCancelling || !address}
            onClick={handleCancelAll}
          >
            {isCancelling ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancelling…</>
            ) : (
              "Cancel All Quotes"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Info */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Quotes are signed off-chain using EIP-712. Your private key never leaves your wallet.
          Takers execute fills on-chain — you need sufficient token balance and approval for the RFQ contract.
        </span>
      </div>
    </div>
  );
}
