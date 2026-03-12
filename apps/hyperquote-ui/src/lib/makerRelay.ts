"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  QuoteKind,
  RFQRequest,
  RFQQuote,
  RFQVisibility,
  Token,
  requestFromJSON,
  quoteToJSON,
} from "@/types";
import { getTokenByAddress } from "@/config/tokens";

// ============ Types ============

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface RelayConfig {
  url: string;
  chainId: number;
  rfqContract: string;
}

// Wire format for requests coming from relay
interface RelayRFQRequest {
  v: 1;
  requestId: string;
  createdAt: number;
  chainId: number;
  rfqContract: string;
  taker: string;
  mode: "EXACT_IN" | "EXACT_OUT";
  tokenIn: string;
  tokenOut: string;
  amountIn: string | null;
  amountOut: string | null;
  minOut: string | null;
  maxIn: string | null;
  expiry: number;
  requestTtlSec: number;
  private: boolean;
}

// ============ Relay Client (maker mode) ============

class MakerRelayClient {
  private ws: WebSocket | null = null;
  private config: RelayConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private pingInterval: NodeJS.Timeout | null = null;

  public onStatusChange: ((s: ConnectionStatus) => void) | null = null;
  public onRequestReceived: ((req: RelayRFQRequest) => void) | null = null;
  public onError: ((msg: string) => void) | null = null;

  constructor(config: RelayConfig) {
    this.config = config;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.onStatusChange?.("connecting");
    try {
      this.ws = new WebSocket(this.config.url);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.onStatusChange?.("connected");
        this.startPing();
        // Subscribe as maker
        this.send({
          v: 1,
          type: "SUBSCRIBE",
          role: "maker",
          chainIds: [this.config.chainId],
        });
      };
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch {
          // ignore parse errors
        }
      };
      this.ws.onclose = () => {
        this.stopPing();
        this.onStatusChange?.("disconnected");
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        this.onStatusChange?.("error");
      };
    } catch {
      this.onStatusChange?.("error");
    }
  }

  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange?.("disconnected");
  }

  private handleMessage(msg: { type: string; [k: string]: unknown }): void {
    switch (msg.type) {
      case "CONNECTED":
        break;
      case "SUBSCRIBED":
        break;
      case "REQUEST_BROADCAST":
        if (this.onRequestReceived && msg.request) {
          this.onRequestReceived(msg.request as RelayRFQRequest);
        }
        break;
      case "ERROR":
        this.onError?.(msg.message as string);
        break;
      case "PONG":
        break;
    }
  }

  private send(message: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  sendQuote(quote: RFQQuote): boolean {
    return this.send({
      v: 1,
      type: "RFQ_QUOTE",
      quote: {
        v: 1,
        requestId: quote.requestId,
        maker: quote.maker,
        taker: quote.taker,
        mode: quote.kind === QuoteKind.EXACT_IN ? "EXACT_IN" : "EXACT_OUT",
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        expiry: quote.expiry,
        nonce: quote.nonce.toString(),
        signature: quote.signature,
        metadata: { source: "manual" },
      },
    });
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => this.send({ v: 1, type: "PING" }), 30000);
  }
  private stopPing(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onError?.("Max reconnect attempts reached");
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ============ Conversion helper ============

function relayRequestToLocal(rr: RelayRFQRequest): RFQRequest {
  const tokenIn: Token = getTokenByAddress(rr.tokenIn) ?? {
    address: rr.tokenIn as `0x${string}`,
    symbol: rr.tokenIn.slice(0, 6),
    name: "Unknown",
    decimals: 18,
  };
  const tokenOut: Token = getTokenByAddress(rr.tokenOut) ?? {
    address: rr.tokenOut as `0x${string}`,
    symbol: rr.tokenOut.slice(0, 6),
    name: "Unknown",
    decimals: 18,
  };

  return {
    id: rr.requestId,
    kind: rr.mode === "EXACT_IN" ? QuoteKind.EXACT_IN : QuoteKind.EXACT_OUT,
    taker: rr.taker as `0x${string}`,
    tokenIn,
    tokenOut,
    amountIn: rr.amountIn ? BigInt(rr.amountIn) : undefined,
    amountOut: rr.amountOut ? BigInt(rr.amountOut) : undefined,
    minOut: rr.minOut ? BigInt(rr.minOut) : undefined,
    maxIn: rr.maxIn ? BigInt(rr.maxIn) : undefined,
    expiry: rr.expiry,
    createdAt: rr.createdAt,
    visibility: "public" as RFQVisibility,
  };
}

// ============ React Hook ============

interface UseMakerRelayOptions {
  enabled: boolean;
  chainId: number;
  rfqContract: string;
}

export function useMakerRelay(options: UseMakerRelayOptions) {
  const { enabled, chainId, rfqContract } = options;
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [liveRequests, setLiveRequests] = useState<RFQRequest[]>([]);
  const clientRef = useRef<MakerRelayClient | null>(null);

  useEffect(() => {
    if (!enabled) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setStatus("disconnected");
      return;
    }

    const relayUrl = process.env.NEXT_PUBLIC_RELAY_WS_URL || "ws://127.0.0.1:8080";
    if (!relayUrl) {
      console.warn("NEXT_PUBLIC_RELAY_WS_URL not set");
      return;
    }

    const client = new MakerRelayClient({ url: relayUrl, chainId, rfqContract });
    client.onStatusChange = setStatus;
    client.onRequestReceived = (rr) => {
      if (rr.private) return; // makers only see public on the feed
      const local = relayRequestToLocal(rr);
      setLiveRequests((prev) => {
        // deduplicate
        if (prev.some((r) => r.id === local.id)) return prev;
        return [local, ...prev];
      });
    };
    client.onError = (e) => console.error("Maker relay error:", e);

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, [enabled, chainId, rfqContract]);

  // Prune expired requests every second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setLiveRequests((prev) => prev.filter((r) => r.expiry > now));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const sendQuote = useCallback((quote: RFQQuote): boolean => {
    return clientRef.current?.sendQuote(quote) ?? false;
  }, []);

  const removeRequest = useCallback((id: string) => {
    setLiveRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return {
    status,
    isConnected: status === "connected",
    liveRequests,
    sendQuote,
    removeRequest,
  };
}
