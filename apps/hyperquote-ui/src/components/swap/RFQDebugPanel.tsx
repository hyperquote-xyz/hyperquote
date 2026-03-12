"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  QuoteKind,
  type RFQRequest,
  type Token,
  type QuoteWithMeta,
} from "@/types";
import { formatAmount, cn, safeSymbol } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Row helper (only used in this panel)
// ---------------------------------------------------------------------------

/** Tiny table row for the debug panel */
function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <tr>
      <td className="pr-2 text-muted-foreground align-top whitespace-nowrap">
        {label}
      </td>
      <td
        className={cn(
          "break-all",
          highlight && "text-yellow-600 dark:text-yellow-400 font-semibold"
        )}
      >
        {value}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// RFQDebugPanel
// ---------------------------------------------------------------------------

export function RFQDebugPanel({
  mode,
  request,
  selectedQuote,
  tokenIn,
  tokenOut,
  minOut,
  maxIn,
}: {
  mode: "EXACT_IN" | "EXACT_OUT";
  request: RFQRequest | null;
  selectedQuote: QuoteWithMeta | null;
  tokenIn: Token | null;
  tokenOut: Token | null;
  minOut: string;
  maxIn: string;
}) {
  const [open, setOpen] = useState(false);

  // Also log to console whenever request or quote changes
  useEffect(() => {
    if (!request) return;
    const payload: Record<string, unknown> = {
      mode,
      id: request.id,
      kind: request.kind === QuoteKind.EXACT_IN ? "EXACT_IN" : "EXACT_OUT",
      tokenIn: `${tokenIn?.symbol ?? "?"} (${request.tokenIn.address.slice(0, 10)}…)`,
      tokenOut: `${tokenOut?.symbol ?? "?"} (${request.tokenOut.address.slice(0, 10)}…)`,
      amountIn: request.amountIn?.toString() ?? "—",
      amountOut: request.amountOut?.toString() ?? "—",
      minOut: request.minOut?.toString() ?? "—",
      maxIn: request.maxIn?.toString() ?? "—",
      expiry: request.expiry,
      visibility: request.visibility,
    };
    console.log("[HyperQuote Debug] RFQ Request:", payload);

    if (selectedQuote) {
      const qPayload: Record<string, unknown> = {
        kind: selectedQuote.kind === QuoteKind.EXACT_IN ? "EXACT_IN" : "EXACT_OUT",
        maker: selectedQuote.maker,
        amountIn: selectedQuote.amountIn.toString(),
        amountOut: selectedQuote.amountOut.toString(),
        price: selectedQuote.price,
        priceInverse: selectedQuote.priceInverse,
        feeAmount: selectedQuote.feeAmount.toString(),
        netAmountIn: selectedQuote.netAmountIn.toString(),
        expiresIn: selectedQuote.expiresIn,
        fillConstraint:
          selectedQuote.kind === QuoteKind.EXACT_IN
            ? `minOut=${minOut || selectedQuote.amountOut.toString()}`
            : `maxIn=${maxIn || selectedQuote.amountIn.toString()}`,
        fillFunction:
          selectedQuote.kind === QuoteKind.EXACT_IN
            ? "fillExactIn"
            : "fillExactOut",
      };
      console.log("[HyperQuote Debug] Selected Quote:", qPayload);
    }
  }, [request, selectedQuote, mode, tokenIn, tokenOut, minOut, maxIn]);

  if (!request) return null;

  const kindLabel =
    request.kind === QuoteKind.EXACT_IN ? "EXACT_IN" : "EXACT_OUT";
  const inDec = tokenIn?.decimals ?? 18;
  const outDec = tokenOut?.decimals ?? 18;

  return (
    <Card className="border-border/30 bg-card/50">
      <CardHeader className="pb-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Advanced / Debug
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 text-[11px] font-mono leading-relaxed">
          {/* Request payload */}
          <div>
            <span className="text-yellow-600 dark:text-yellow-400 font-semibold">
              Request Payload
            </span>
            <table className="mt-1 w-full">
              <tbody>
                <Row label="mode" value={kindLabel} />
                <Row label="id" value={request.id.slice(0, 12) + "…"} />
                <Row
                  label="tokenIn"
                  value={`${safeSymbol(tokenIn)} ${request.tokenIn.address.slice(0, 10)}…`}
                />
                <Row
                  label="tokenOut"
                  value={`${safeSymbol(tokenOut)} ${request.tokenOut.address.slice(0, 10)}…`}
                />
                <Row
                  label="amountIn"
                  value={
                    request.amountIn != null
                      ? `${formatAmount(request.amountIn, inDec)} (raw: ${request.amountIn.toString()})`
                      : "—"
                  }
                  highlight={request.kind === QuoteKind.EXACT_IN}
                />
                <Row
                  label="amountOut"
                  value={
                    request.amountOut != null
                      ? `${formatAmount(request.amountOut, outDec)} (raw: ${request.amountOut.toString()})`
                      : "—"
                  }
                  highlight={request.kind === QuoteKind.EXACT_OUT}
                />
                <Row
                  label="minOut"
                  value={
                    request.minOut != null && request.minOut > 0n
                      ? formatAmount(request.minOut, outDec)
                      : "—"
                  }
                />
                <Row
                  label="maxIn"
                  value={
                    request.maxIn != null &&
                    request.maxIn <
                      BigInt(
                        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
                      )
                      ? formatAmount(request.maxIn, inDec)
                      : "—"
                  }
                />
                <Row label="expiry" value={new Date(request.expiry * 1000).toISOString()} />
                <Row label="visibility" value={request.visibility} />
              </tbody>
            </table>
          </div>

          {/* Selected quote */}
          {selectedQuote && (
            <div>
              <span className="text-yellow-600 dark:text-yellow-400 font-semibold">
                Selected Quote
              </span>
              <table className="mt-1 w-full">
                <tbody>
                  <Row label="maker" value={selectedQuote.maker} />
                  <Row
                    label="amountIn"
                    value={`${formatAmount(selectedQuote.amountIn, inDec)} (raw: ${selectedQuote.amountIn.toString()})`}
                    highlight={selectedQuote.kind === QuoteKind.EXACT_OUT}
                  />
                  <Row
                    label="amountOut"
                    value={`${formatAmount(selectedQuote.amountOut, outDec)} (raw: ${selectedQuote.amountOut.toString()})`}
                    highlight={selectedQuote.kind === QuoteKind.EXACT_IN}
                  />
                  <Row label="price" value={selectedQuote.price.toFixed(8)} />
                  <Row label="priceInverse" value={selectedQuote.priceInverse.toFixed(8)} />
                  <Row
                    label="fee"
                    value={`${formatAmount(selectedQuote.feeAmount, inDec)} ${safeSymbol(tokenIn)}`}
                  />
                  <Row label="expiresIn" value={`${selectedQuote.expiresIn}s`} />
                  <Row
                    label="fillFn"
                    value={
                      selectedQuote.kind === QuoteKind.EXACT_IN
                        ? "fillExactIn(quote, sig, minOut)"
                        : "fillExactOut(quote, sig, maxIn)"
                    }
                  />
                  <Row
                    label="constraint"
                    value={
                      selectedQuote.kind === QuoteKind.EXACT_IN
                        ? minOut
                          ? `minOut=${minOut}`
                          : `minOut=quote.amountOut (${formatAmount(selectedQuote.amountOut, outDec)})`
                        : maxIn
                          ? `maxIn=${maxIn}`
                          : `maxIn=quote.amountIn (${formatAmount(selectedQuote.amountIn, inDec)})`
                    }
                  />
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
