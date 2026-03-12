"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { RFQRequestJSON, RFQQuoteJSON } from "@/types";
import { notFound } from "next/navigation";

// Gate console behind env var — developer tool only
const CONSOLE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_CONSOLE === "true";
import {
  Radio,
  ArrowRight,
  Send,
  Clock,
  Inbox,
  AlertCircle,
  CheckCircle2,
  Copy,
  RefreshCw,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types for SSE events
// ---------------------------------------------------------------------------

interface SSESnapshotEvent {
  type: "snapshot";
  data: RFQRequestJSON[];
}

interface SSERfqEvent {
  type: "rfq";
  data: RFQRequestJSON;
}

interface SSEQuoteEvent {
  type: "quote";
  rfqId: string;
  data: RFQQuoteJSON;
}

type SSEEvent = SSESnapshotEvent | SSERfqEvent | SSEQuoteEvent;

// ---------------------------------------------------------------------------
// SSE connection states
// ---------------------------------------------------------------------------

type StreamStatus = "connecting" | "connected" | "disconnected" | "error";

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function MakerConsolePage() {
  if (!CONSOLE_ENABLED) {
    notFound();
  }

  const [streamStatus, setStreamStatus] = useState<StreamStatus>("disconnected");
  const [rfqs, setRfqs] = useState<RFQRequestJSON[]>([]);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Quote form state
  const [selectedRfqId, setSelectedRfqId] = useState<string>("");
  const [quoteJson, setQuoteJson] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shareTokenInput, setShareTokenInput] = useState("");

  // --- SSE Connection ---
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStreamStatus("connecting");
    const es = new EventSource("/api/rfq/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      setStreamStatus("connected");
      addLog("Connected to SSE stream");
    };

    es.onmessage = (event) => {
      try {
        const parsed: SSEEvent = JSON.parse(event.data);

        if (parsed.type === "snapshot") {
          setRfqs(parsed.data);
          addLog(`Snapshot: ${parsed.data.length} active public RFQs`);
        } else if (parsed.type === "rfq") {
          setRfqs((prev) => {
            if (prev.some((r) => r.id === parsed.data.id)) return prev;
            return [parsed.data, ...prev];
          });
          addLog(`New RFQ: ${parsed.data.id.slice(0, 8)}… ${parsed.data.tokenIn?.symbol ?? "?"}→${parsed.data.tokenOut?.symbol ?? "?"}`);
        } else if (parsed.type === "quote") {
          addLog(`Quote for ${parsed.rfqId.slice(0, 8)}… from ${parsed.data.maker.slice(0, 10)}…`);
        }
      } catch {
        // Ignore parse errors (e.g. keep-alive comments)
      }
    };

    es.onerror = () => {
      setStreamStatus("error");
      addLog("SSE connection error — will retry…");
    };
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStreamStatus("disconnected");
    addLog("Disconnected from SSE stream");
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);

  // Prune expired RFQs every second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setRfqs((prev) => prev.filter((r) => r.expiry > now));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString();
    setEventLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 100));
  }

  // --- Quote Submission ---
  const handleSubmitQuote = async () => {
    if (!selectedRfqId || !quoteJson) {
      toast({ title: "Missing fields", description: "Select an RFQ and paste quote JSON", variant: "destructive" });
      return;
    }

    let parsed: RFQQuoteJSON;
    try {
      parsed = JSON.parse(quoteJson);
    } catch {
      toast({ title: "Invalid JSON", description: "Could not parse quote JSON", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/rfq/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqId: selectedRfqId,
          quote: parsed,
          token: shareTokenInput || undefined,
        }),
      });
      const result = await res.json();
      if (result.accepted) {
        toast({ title: "Quote accepted", description: `Quote submitted for RFQ ${selectedRfqId.slice(0, 8)}…` });
        addLog(`Quote submitted for ${selectedRfqId.slice(0, 8)}…`);
        setQuoteJson("");
      } else {
        toast({ title: "Quote rejected", description: result.reason, variant: "destructive" });
        addLog(`Quote rejected: ${result.reason}`);
      }
    } catch (err) {
      toast({ title: "Network error", description: "Could not reach server", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // --- Fetch RFQ Detail ---
  const handleFetchDetail = async (rfqId: string) => {
    try {
      const tokenParam = shareTokenInput ? `?token=${shareTokenInput}` : "";
      const res = await fetch(`/api/rfq/detail/${rfqId}${tokenParam}`);
      if (!res.ok) {
        const err = await res.json();
        addLog(`Detail ${rfqId.slice(0, 8)}…: ${err.error ?? res.status}`);
        return;
      }
      const detail = await res.json();
      addLog(`Detail ${rfqId.slice(0, 8)}…: ${detail.quotes?.length ?? 0} quotes`);
      toast({
        title: `RFQ ${rfqId.slice(0, 8)}…`,
        description: `${detail.quotes?.length ?? 0} quotes received`,
      });
    } catch {
      addLog(`Detail fetch failed for ${rfqId.slice(0, 8)}…`);
    }
  };

  // --- Status badge ---
  const statusConfig: Record<StreamStatus, { label: string; dotCls: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    connected: { label: "Connected", dotCls: "bg-emerald-500", variant: "default" },
    connecting: { label: "Connecting", dotCls: "bg-amber-500 animate-pulse", variant: "secondary" },
    disconnected: { label: "Disconnected", dotCls: "bg-zinc-500", variant: "outline" },
    error: { label: "Error", dotCls: "bg-red-500", variant: "destructive" },
  };
  const sc = statusConfig[streamStatus];

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Maker Console</h1>
        <p className="text-muted-foreground text-sm">
          Watch the live RFQ feed via SSE and submit quotes via the HTTP API
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
        {/* ── Left: Live Feed ── */}
        <div className="space-y-4">
          {/* Stream controls */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary" />
                  SSE Feed
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={sc.variant} className="gap-1.5 text-[10px] px-2 py-0.5">
                    <span className={cn("inline-block h-1.5 w-1.5 rounded-full", sc.dotCls)} />
                    {sc.label}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={streamStatus === "connected" ? disconnect : connect}
                    className="gap-1.5"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {streamStatus === "connected" ? "Disconnect" : "Connect"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {rfqs.length > 0 ? (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {rfqs.map((r) => (
                    <FeedRow
                      key={r.id}
                      rfq={r}
                      isSelected={selectedRfqId === r.id}
                      onSelect={() => setSelectedRfqId(r.id)}
                      onDetail={() => handleFetchDetail(r.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Inbox className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {streamStatus === "connected"
                      ? "No public RFQs yet — create one from /swap"
                      : "Connect to see live RFQs"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Event Log */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Event Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-3 max-h-[200px] overflow-y-auto font-mono text-[11px] text-muted-foreground space-y-0.5">
                {eventLog.length > 0
                  ? eventLog.map((line, i) => <div key={i}>{line}</div>)
                  : <div className="text-center py-4">No events yet</div>
                }
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Quote Submission ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4 w-4 text-primary" />
                Submit Quote
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">RFQ ID</Label>
                <Input
                  placeholder="Click an RFQ above, or paste an ID"
                  value={selectedRfqId}
                  onChange={(e) => setSelectedRfqId(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Share Token (for private RFQs)</Label>
                <Input
                  placeholder="Optional — required for private RFQs"
                  value={shareTokenInput}
                  onChange={(e) => setShareTokenInput(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Signed Quote JSON</Label>
                <textarea
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono min-h-[160px] resize-y"
                  placeholder={`Paste signed RFQQuoteJSON here…\n\n{\n  "kind": 0,\n  "maker": "0x...",\n  "taker": "0x...",\n  "tokenIn": "0x...",\n  "tokenOut": "0x...",\n  "amountIn": "1000000",\n  "amountOut": "500000000000000000",\n  "expiry": 1234567890,\n  "nonce": "0",\n  "requestId": "...",\n  "signature": "0x...",\n  "createdAt": 1234567890\n}`}
                  value={quoteJson}
                  onChange={(e) => setQuoteJson(e.target.value)}
                />
              </div>

              <Button
                className="w-full gap-2"
                onClick={handleSubmitQuote}
                disabled={submitting || !selectedRfqId || !quoteJson}
              >
                {submitting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitting ? "Submitting…" : "Submit Quote"}
              </Button>
            </CardContent>
          </Card>

          {/* Quick Reference */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">API Quick Reference</CardTitle>
            </CardHeader>
            <CardContent className="text-xs font-mono text-muted-foreground space-y-3">
              <div>
                <div className="text-foreground font-semibold mb-1">GET /api/rfq/stream</div>
                <div>SSE stream — snapshot + live rfq/quote events</div>
              </div>
              <div>
                <div className="text-foreground font-semibold mb-1">GET /api/rfq/detail/:id</div>
                <div>Returns {"{ rfq, quotes }"} — add ?token=… for private</div>
              </div>
              <div>
                <div className="text-foreground font-semibold mb-1">POST /api/rfq/quote</div>
                <div>Body: {"{ rfqId, quote, token? }"}</div>
              </div>
              <div>
                <div className="text-foreground font-semibold mb-1">POST /api/rfq</div>
                <div>Body: {"{ wallet, visibility, expiry, rfqData }"}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed Row — compact display of a single RFQ in the SSE feed
// ---------------------------------------------------------------------------

function FeedRow({
  rfq,
  isSelected,
  onSelect,
  onDetail,
}: {
  rfq: RFQRequestJSON;
  isSelected: boolean;
  onSelect: () => void;
  onDetail: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const secsLeft = rfq.expiry - now;
  const isUrgent = secsLeft <= 10 && secsLeft > 0;
  const isExpired = secsLeft <= 0;

  if (isExpired) return null;

  const isExactIn = rfq.kind === 0;
  const symbolIn = rfq.tokenIn?.symbol ?? "???";
  const symbolOut = rfq.tokenOut?.symbol ?? "???";

  const [copied, setCopied] = useState(false);
  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(rfq.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left",
        isSelected
          ? "bg-primary/10 border border-primary/30"
          : "hover:bg-muted/50 border border-transparent",
        isUrgent && "border-warning/40"
      )}
    >
      {/* Pair */}
      <div className="flex items-center gap-1.5 min-w-[100px]">
        <span className="text-sm font-semibold">{symbolIn}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-sm font-semibold">{symbolOut}</span>
      </div>

      {/* Mode */}
      <Badge
        variant={isExactIn ? "default" : "secondary"}
        className="text-[9px] px-1.5 py-0 shrink-0"
      >
        {isExactIn ? "In" : "Out"}
      </Badge>

      {/* ID */}
      <div className="flex-1 min-w-0 font-mono text-[10px] text-muted-foreground truncate">
        {rfq.id.slice(0, 12)}…
      </div>

      {/* TTL */}
      <div className={cn("flex items-center gap-1 text-xs font-mono", isUrgent ? "text-warning" : "text-muted-foreground")}>
        <Clock className="h-3 w-3" />
        {secsLeft}s
      </div>

      {/* Actions */}
      <button
        onClick={handleCopyId}
        className="p-1 rounded hover:bg-muted"
        title="Copy RFQ ID"
      >
        {copied ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onDetail(); }}
        className="p-1 rounded hover:bg-muted text-[10px] text-muted-foreground hover:text-foreground"
        title="Fetch detail"
      >
        Detail
      </button>
    </button>
  );
}
