"use client";

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedRfqStatus = "OPEN" | "QUOTED" | "FILLED" | "EXPIRED" | "KILLED";

export interface FeedRfqItem {
  id: string;
  taker: string;
  tokenIn: { address: string; symbol: string; decimals: number; logoUrl?: string };
  tokenOut: { address: string; symbol: string; decimals: number; logoUrl?: string };
  kind: number;
  amountIn: string | null;
  amountOut: string | null;
  expiry: number;
  status: FeedRfqStatus;
  quoteCount: number;
  fillTxHash: string | null;
  createdAt: string; // ISO string
}

interface FeedEvent {
  type: string;
  rfqId: string;
  data: {
    id?: string;
    taker: string;
    tokenIn: { address: string; symbol: string; decimals: number; logoUrl?: string };
    tokenOut: { address: string; symbol: string; decimals: number; logoUrl?: string };
    kind: number;
    amountIn?: string | null;
    amountOut?: string | null;
    expiry: number;
    createdAt?: number;
  };
  status: FeedRfqStatus;
  quoteCount?: number;
  fillTxHash?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFeedStream() {
  const [items, setItems] = useState<FeedRfqItem[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/v1/feed/stream");

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "snapshot") {
          // Initial load from Prisma rows
          const parsed = (msg.data as unknown[]).map(parseFeedRow);
          setItems(parsed);
          return;
        }

        // Live events: rfq.created, rfq.quoted, rfq.filled, rfq.cancelled, rfq.expired
        setItems((prev) => applyFeedEvent(prev, msg as FeedEvent));
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      es.close();
    };
  }, []);

  return { items, connected };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseFeedRow(row: any): FeedRfqItem {
  // Handle both Prisma camelCase and raw snake_case forms
  const tokenIn =
    typeof row.tokenInJson === "string"
      ? JSON.parse(row.tokenInJson)
      : row.tokenIn ?? { address: row.token_in ?? "", symbol: "?", decimals: 18 };
  const tokenOut =
    typeof row.tokenOutJson === "string"
      ? JSON.parse(row.tokenOutJson)
      : row.tokenOut ?? { address: row.token_out ?? "", symbol: "?", decimals: 18 };

  return {
    id: row.id,
    taker: row.taker,
    tokenIn,
    tokenOut,
    kind: row.kind,
    amountIn: row.amountIn ?? row.amount_in ?? null,
    amountOut: row.amountOut ?? row.amount_out ?? null,
    expiry: row.expiry,
    status: row.status ?? "OPEN",
    quoteCount: row.quoteCount ?? row.quote_count ?? 0,
    fillTxHash: row.fillTxHash ?? row.fill_tx_hash ?? null,
    createdAt:
      row.createdAt ?? row.created_at ?? new Date().toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function applyFeedEvent(prev: FeedRfqItem[], event: FeedEvent): FeedRfqItem[] {
  switch (event.type) {
    case "rfq.created": {
      // Prepend new item, dedup by id
      if (prev.some((i) => i.id === event.rfqId)) return prev;
      const newItem: FeedRfqItem = {
        id: event.rfqId,
        taker: event.data.taker,
        tokenIn: event.data.tokenIn,
        tokenOut: event.data.tokenOut,
        kind: event.data.kind,
        amountIn: event.data.amountIn ?? null,
        amountOut: event.data.amountOut ?? null,
        expiry: event.data.expiry,
        status: "OPEN",
        quoteCount: 0,
        fillTxHash: null,
        createdAt: new Date(event.timestamp * 1000).toISOString(),
      };
      return [newItem, ...prev];
    }

    case "rfq.quoted":
      return prev.map((i) =>
        i.id === event.rfqId
          ? {
              ...i,
              status: event.status ?? "QUOTED",
              quoteCount: event.quoteCount ?? i.quoteCount,
            }
          : i
      );

    case "rfq.filled":
      return prev.map((i) =>
        i.id === event.rfqId
          ? { ...i, status: "FILLED" as const, fillTxHash: event.fillTxHash ?? null }
          : i
      );

    case "rfq.cancelled":
      return prev.map((i) =>
        i.id === event.rfqId ? { ...i, status: "KILLED" as const } : i
      );

    case "rfq.expired":
      return prev.map((i) =>
        i.id === event.rfqId ? { ...i, status: "EXPIRED" as const } : i
      );

    default:
      return prev;
  }
}
