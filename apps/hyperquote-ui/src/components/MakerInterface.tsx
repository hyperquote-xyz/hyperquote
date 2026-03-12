"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import {
  LiveFeed,
  ImportPrivateRFQ,
  ResponseDrawer,
  MyQuotes,
  MakerSettings,
  AlertPreferencesCard,
} from "./maker";
import { useMakerRelay } from "@/lib/makerRelay";
import { useMakerRFQ } from "@/hooks/useRFQ";
import { RFQRequest, RFQQuote, requestFromJSON, RFQRequestJSON } from "@/types";
import { RFQ_CONTRACT_ADDRESS } from "@/config/contracts";
import { hyperEVM } from "@/config/chains";
import { Shield, Radio, Wallet, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export function MakerInterface() {
  const { address, isConnected } = useAccount();
  const relayEnabled = process.env.NEXT_PUBLIC_USE_RELAY === "true";

  // Relay hook (maker side)
  const {
    status: relayStatus,
    isConnected: relayConnected,
    liveRequests,
    sendQuote,
    removeRequest,
  } = useMakerRelay({
    enabled: relayEnabled && isConnected,
    chainId: hyperEVM.id,
    rfqContract: RFQ_CONTRACT_ADDRESS,
  });

  // Maker hook for signing
  const { importRequestJSON } = useMakerRFQ();

  // Local state
  const [importedRequests, setImportedRequests] = useState<RFQRequest[]>([]);
  const [activeRequest, setActiveRequest] = useState<RFQRequest | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quotesHistory, setQuotesHistory] = useState<
    Array<{ quote: RFQQuote; status: "signed" | "sent" | "filled" }>
  >([]);

  // Merged requests: relay live + imported
  const allRequests = [...liveRequests, ...importedRequests];

  // Handle respond: open the drawer
  const handleRespond = useCallback((request: RFQRequest) => {
    setActiveRequest(request);
    setDrawerOpen(true);
  }, []);

  // Handle private import
  const handleImportPrivate = useCallback(
    (request: RFQRequest) => {
      // Also add to the maker hook's pending list for signing
      importRequestJSON(JSON.stringify({
        id: request.id,
        kind: request.kind,
        taker: request.taker,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn?.toString(),
        amountOut: request.amountOut?.toString(),
        minOut: request.minOut?.toString(),
        maxIn: request.maxIn?.toString(),
        expiry: request.expiry,
        createdAt: request.createdAt,
        visibility: request.visibility ?? "private",
      }));

      setImportedRequests((prev) => {
        if (prev.some((r) => r.id === request.id)) return prev;
        return [request, ...prev];
      });

      // Auto-open the drawer
      setActiveRequest(request);
      setDrawerOpen(true);
    },
    [importRequestJSON]
  );

  // Handle send quote via relay (callback for ResponseDrawer)
  const handleSendToRelay = useCallback(
    (quote: RFQQuote): boolean => {
      const sent = sendQuote(quote);
      if (sent) {
        setQuotesHistory((prev) => [{ quote, status: "sent" }, ...prev]);
      } else {
        setQuotesHistory((prev) => [{ quote, status: "signed" }, ...prev]);
      }
      return sent;
    },
    [sendQuote]
  );

  // Handle drawer close — if a quote was signed, add to history
  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setActiveRequest(null);
  }, []);

  // ── Not Connected ──
  if (!isConnected) {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="py-16 text-center">
          <Wallet className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-xl font-semibold mb-2">Connect Maker Wallet</h2>
          <p className="text-muted-foreground text-sm">
            Connect your wallet to view live RFQ requests and start providing quotes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Tabs Layout */}
      <Tabs defaultValue="feed" className="w-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <TabsList>
            <TabsTrigger value="feed" className="gap-1.5">
              <Radio className="h-3.5 w-3.5" />
              Live Feed
              {allRequests.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                  {allRequests.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="quotes" className="gap-1.5">
              My Quotes
              {quotesHistory.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                  {quotesHistory.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="settings">
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Status pill */}
          {relayEnabled && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  relayConnected
                    ? "bg-emerald-500"
                    : relayStatus === "connecting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-zinc-500"
                )}
              />
              Relay {relayStatus}
            </div>
          )}
        </div>

        {/* ── Live Feed Tab ── */}
        <TabsContent value="feed" className="space-y-4">
          {/* Import Private RFQ */}
          <ImportPrivateRFQ onImport={handleImportPrivate} />

          {/* Live Feed */}
          <LiveFeed
            requests={allRequests}
            relayStatus={relayStatus}
            relayEnabled={relayEnabled}
            onRespond={handleRespond}
          />
        </TabsContent>

        {/* ── My Quotes Tab ── */}
        <TabsContent value="quotes">
          <MyQuotes quotes={quotesHistory} />
        </TabsContent>

        {/* ── Alerts Tab ── */}
        <TabsContent value="alerts">
          <AlertPreferencesCard />
        </TabsContent>

        {/* ── Settings Tab ── */}
        <TabsContent value="settings">
          <MakerSettings
            address={address}
            relayEnabled={relayEnabled}
            relayStatus={relayStatus}
          />
        </TabsContent>
      </Tabs>

      {/* Response Drawer */}
      <ResponseDrawer
        request={activeRequest}
        open={drawerOpen}
        onClose={handleDrawerClose}
        onSendToRelay={relayEnabled ? handleSendToRelay : undefined}
        relayEnabled={relayEnabled && relayConnected}
      />
    </>
  );
}
