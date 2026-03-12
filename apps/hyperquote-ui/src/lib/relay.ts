"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  QuoteKind,
  RFQRequest,
  RFQQuote,
  Token,
  quoteFromJSON,
} from "@/types";

// ============ Types ============

interface RelayConfig {
  url: string;
  chainId: number;
  rfqContract: string;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

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

interface RelayRFQQuote {
  v: 1;
  requestId: string;
  maker: string;
  taker: string;
  mode: "EXACT_IN" | "EXACT_OUT";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  expiry: number;
  nonce: string;
  signature: string;
  metadata?: {
    latencyMs?: number;
    source?: "bot" | "manual";
    reputationHint?: number;
  };
}

// ============ Relay Client Class ============

class RelayClient {
  private ws: WebSocket | null = null;
  private config: RelayConfig;
  private connectionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private pingInterval: NodeJS.Timeout | null = null;

  // Callbacks
  public onStatusChange: ((status: ConnectionStatus) => void) | null = null;
  public onQuoteReceived: ((quote: RelayRFQQuote) => void) | null = null;
  public onRequestExpired: ((requestId: string) => void) | null = null;
  public onError: ((error: string) => void) | null = null;

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

        // Subscribe as taker
        this.send({
          v: 1,
          type: "SUBSCRIBE",
          role: "taker",
          chainIds: [this.config.chainId],
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch {
          console.error("Failed to parse relay message");
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
    } catch (error) {
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

  private handleMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case "CONNECTED":
        this.connectionId = message.connectionId as string;
        break;

      case "SUBSCRIBED":
        console.log("Subscribed to relay");
        break;

      case "QUOTE_RECEIVED":
        if (this.onQuoteReceived && message.quote) {
          this.onQuoteReceived(message.quote as RelayRFQQuote);
        }
        break;

      case "REQUEST_EXPIRED":
        if (this.onRequestExpired && message.requestId) {
          this.onRequestExpired(message.requestId as string);
        }
        break;

      case "ERROR":
        console.error("Relay error:", message.message);
        this.onError?.(message.message as string);
        break;

      case "PONG":
        // Ping response received
        break;
    }
  }

  private send(message: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ v: 1, type: "PING" });
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onError?.("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Send RFQ request to relay
   */
  sendRequest(request: RelayRFQRequest): boolean {
    return this.send({
      v: 1,
      type: "RFQ_REQUEST",
      request,
    });
  }

  /**
   * Cancel a request
   */
  cancelRequest(requestId: string): boolean {
    return this.send({
      v: 1,
      type: "CANCEL_REQUEST",
      requestId,
    });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ============ React Hook ============

interface UseRelayOptions {
  enabled: boolean;
  chainId: number;
  rfqContract: string;
}

export function useRelay(options: UseRelayOptions) {
  const { enabled, chainId, rfqContract } = options;
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [quotes, setQuotes] = useState<Map<string, RelayRFQQuote[]>>(new Map());
  const clientRef = useRef<RelayClient | null>(null);

  // Initialize client
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

    const client = new RelayClient({
      url: relayUrl,
      chainId,
      rfqContract,
    });

    client.onStatusChange = setStatus;

    client.onQuoteReceived = (quote) => {
      setQuotes((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(quote.requestId) || [];
        // Replace quote from same maker or add new
        const filtered = existing.filter(
          (q) => q.maker.toLowerCase() !== quote.maker.toLowerCase()
        );
        newMap.set(quote.requestId, [...filtered, quote]);
        return newMap;
      });
    };

    client.onRequestExpired = (requestId) => {
      setQuotes((prev) => {
        const newMap = new Map(prev);
        newMap.delete(requestId);
        return newMap;
      });
    };

    client.onError = (error) => {
      console.error("Relay error:", error);
    };

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, [enabled, chainId, rfqContract]);

  /**
   * Create and broadcast RFQ request
   */
  const createRequest = useCallback(
    (params: {
      taker: `0x${string}`;
      kind: QuoteKind;
      tokenIn: Token;
      tokenOut: Token;
      amountIn?: bigint;
      amountOut?: bigint;
      minOut?: bigint;
      maxIn?: bigint;
      ttlSeconds: number;
      visibility?: "public" | "private";
    }): string | null => {
      // Private RFQs should NOT be sent to the relay at all
      if (params.visibility === "private") {
        // Just create the requestId locally — no broadcast
        const requestId = uuidv4();
        setQuotes((prev) => {
          const newMap = new Map(prev);
          newMap.set(requestId, []);
          return newMap;
        });
        return requestId;
      }

      if (!clientRef.current?.isConnected) {
        return null;
      }

      const requestId = uuidv4();
      const now = Math.floor(Date.now() / 1000);

      const request: RelayRFQRequest = {
        v: 1,
        requestId,
        createdAt: now,
        chainId,
        rfqContract,
        taker: params.taker,
        mode: params.kind === QuoteKind.EXACT_IN ? "EXACT_IN" : "EXACT_OUT",
        tokenIn: params.tokenIn.address,
        tokenOut: params.tokenOut.address,
        amountIn: params.amountIn?.toString() ?? null,
        amountOut: params.amountOut?.toString() ?? null,
        minOut: params.minOut?.toString() ?? null,
        maxIn: params.maxIn?.toString() ?? null,
        expiry: now + params.ttlSeconds,
        requestTtlSec: params.ttlSeconds,
        private: false,
      };

      const sent = clientRef.current.sendRequest(request);
      if (sent) {
        // Initialize quotes array for this request
        setQuotes((prev) => {
          const newMap = new Map(prev);
          newMap.set(requestId, []);
          return newMap;
        });
        return requestId;
      }

      return null;
    },
    [chainId, rfqContract]
  );

  /**
   * Cancel a request
   */
  const cancelRequest = useCallback((requestId: string) => {
    clientRef.current?.cancelRequest(requestId);
    setQuotes((prev) => {
      const newMap = new Map(prev);
      newMap.delete(requestId);
      return newMap;
    });
  }, []);

  /**
   * Get quotes for a request
   */
  const getQuotes = useCallback(
    (requestId: string): RFQQuote[] => {
      const relayQuotes = quotes.get(requestId) || [];
      return relayQuotes.map((rq) => ({
        kind: rq.mode === "EXACT_IN" ? QuoteKind.EXACT_IN : QuoteKind.EXACT_OUT,
        maker: rq.maker as `0x${string}`,
        taker: rq.taker as `0x${string}`,
        tokenIn: rq.tokenIn as `0x${string}`,
        tokenOut: rq.tokenOut as `0x${string}`,
        amountIn: BigInt(rq.amountIn),
        amountOut: BigInt(rq.amountOut),
        expiry: rq.expiry,
        nonce: BigInt(rq.nonce),
        requestId: rq.requestId,
        signature: rq.signature as `0x${string}`,
        createdAt: Math.floor(Date.now() / 1000),
      }));
    },
    [quotes]
  );

  /**
   * Clear quotes for a request
   */
  const clearQuotes = useCallback((requestId: string) => {
    setQuotes((prev) => {
      const newMap = new Map(prev);
      newMap.delete(requestId);
      return newMap;
    });
  }, []);

  return {
    status,
    isConnected: status === "connected",
    createRequest,
    cancelRequest,
    getQuotes,
    clearQuotes,
    quotesMap: quotes,
  };
}

export type { ConnectionStatus, RelayRFQRequest, RelayRFQQuote };
