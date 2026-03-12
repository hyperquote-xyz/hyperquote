"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { QuoteBuilder } from "./QuoteBuilder";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import { useMakerRFQ } from "@/hooks/useRFQ";
import { QuoteKind, RFQRequest, RFQQuote, quoteToJSON } from "@/types";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import { TakerBadge } from "@/components/TakerBadge";
import {
  Clock,
  ArrowRight,
  Globe,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Send,
  Wallet,
  Loader2,
} from "lucide-react";

type QuoteStatus = "idle" | "signing" | "signed" | "sending" | "sent" | "error";

interface ResponseDrawerProps {
  request: RFQRequest | null;
  open: boolean;
  onClose: () => void;
  onSendToRelay?: (quote: RFQQuote) => boolean;
  relayEnabled: boolean;
}

export function ResponseDrawer({
  request,
  open,
  onClose,
  onSendToRelay,
  relayEnabled,
}: ResponseDrawerProps) {
  const { address, isConnected } = useAccount();
  const { makerNonce, createQuote, exportQuoteJSON, refetchNonce, feePips } = useMakerRFQ();

  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>("idle");
  const [signedQuote, setSignedQuote] = useState<RFQQuote | null>(null);
  const [quoteJSON, setQuoteJSON] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live amounts from QuoteBuilder
  const [amounts, setAmounts] = useState<{
    amountIn: bigint;
    amountOut: bigint;
    quoteExpiry: number;
    isValid: boolean;
  }>({ amountIn: 0n, amountOut: 0n, quoteExpiry: 0, isValid: false });

  const { formattedTime, isExpired, isUrgent } = useQuoteExpiry(request?.expiry);

  // Reset on open/close
  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setQuoteStatus("idle");
      setSignedQuote(null);
      setQuoteJSON(null);
      setErrorMsg(null);
      onClose();
    }
  };

  // Sign quote
  const handleSign = useCallback(async () => {
    if (!request || !isConnected || !amounts.isValid) return;

    setQuoteStatus("signing");
    setErrorMsg(null);

    try {
      await refetchNonce();

      const isExactIn = request.kind === QuoteKind.EXACT_IN;
      // For createQuote: pass the floating amount (the one the maker is quoting)
      const quotedAmount = isExactIn ? amounts.amountOut : amounts.amountIn;

      const quote = await createQuote(request, quotedAmount);

      if (quote) {
        setSignedQuote(quote);
        setQuoteJSON(exportQuoteJSON(quote));
        setQuoteStatus("signed");
        toast({ title: "Quote signed!", description: "Ready to send or copy" });
      } else {
        setQuoteStatus("error");
        setErrorMsg("Signing failed — check wallet");
      }
    } catch (err) {
      setQuoteStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Signing failed");
    }
  }, [request, isConnected, amounts, createQuote, exportQuoteJSON, refetchNonce]);

  // Send via relay
  const handleSend = useCallback(() => {
    if (!signedQuote || !onSendToRelay) return;
    setQuoteStatus("sending");
    const ok = onSendToRelay(signedQuote);
    if (ok) {
      setQuoteStatus("sent");
      toast({ title: "Quote sent!", description: "Delivered to taker via relay" });
    } else {
      setQuoteStatus("error");
      setErrorMsg("Failed to send — relay may be disconnected");
    }
  }, [signedQuote, onSendToRelay]);

  // Copy JSON
  const handleCopy = async () => {
    if (!quoteJSON) return;
    await navigator.clipboard.writeText(quoteJSON);
    toast({ title: "Copied!", description: "Quote JSON copied to clipboard" });
  };

  // Retry
  const handleRetry = () => {
    setQuoteStatus("idle");
    setSignedQuote(null);
    setQuoteJSON(null);
    setErrorMsg(null);
  };

  if (!request) return null;

  const isExactIn = request.kind === QuoteKind.EXACT_IN;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Respond to RFQ
            <Badge
              variant={request.visibility === "public" ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0 gap-1"
            >
              {request.visibility === "public" ? (
                <><Globe className="h-2.5 w-2.5" /> Public</>
              ) : (
                <><Lock className="h-2.5 w-2.5" /> Private</>
              )}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Sign an off-chain quote. The taker executes the fill on-chain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* ── Section A: Request Summary ── */}
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
            {/* ID + TTL */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">
                {request.id.slice(0, 12)}…
              </span>
              <div
                className={cn(
                  "flex items-center gap-1.5 text-sm font-mono",
                  isExpired ? "text-destructive" : isUrgent ? "text-warning" : "text-muted-foreground"
                )}
              >
                <Clock className="h-3.5 w-3.5" />
                {formattedTime}
              </div>
            </div>

            {/* Trade */}
            <div className="flex items-center gap-3">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  {isExactIn ? "Pays (Fixed)" : "Pays"}
                </div>
                <div className="font-mono text-sm font-medium">
                  {request.amountIn
                    ? formatAmount(request.amountIn, request.tokenIn.decimals, 4)
                    : "?"}{" "}
                  {safeSymbol(request.tokenIn)}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  {isExactIn ? "Receives" : "Receives (Fixed)"}
                </div>
                <div className="font-mono text-sm font-medium">
                  {request.amountOut
                    ? formatAmount(request.amountOut, request.tokenOut.decimals, 4)
                    : "?"}{" "}
                  {safeSymbol(request.tokenOut)}
                </div>
              </div>
            </div>

            {/* Taker + Mode */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span>Taker: <span className="font-mono">{formatAddress(request.taker, 6)}</span></span>
              <TakerBadge address={request.taker} />
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {isExactIn ? "Exact In" : "Exact Out"}
              </Badge>
            </div>

            {/* Expiry warning */}
            {isUrgent && !isExpired && (
              <div className="flex items-center gap-1.5 text-xs text-warning bg-warning/10 rounded px-2 py-1">
                <AlertTriangle className="h-3 w-3" />
                Expiring soon — sign quickly
              </div>
            )}
            {isExpired && (
              <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
                <AlertTriangle className="h-3 w-3" />
                This request has expired
              </div>
            )}
          </div>

          {/* ── Section B: Quote Builder ── */}
          {!isExpired && quoteStatus === "idle" && (
            <QuoteBuilder
              request={request}
              feePips={feePips}
              onAmountsChange={setAmounts}
            />
          )}

          {/* ── Section C: Actions ── */}
          <div className="space-y-3">
            {/* Not connected */}
            {!isConnected && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                <Wallet className="h-4 w-4" />
                Connect your wallet to sign quotes
              </div>
            )}

            {/* Idle state — Sign button */}
            {isConnected && quoteStatus === "idle" && !isExpired && (
              <Button
                className="w-full gap-2"
                disabled={!amounts.isValid}
                onClick={handleSign}
              >
                Sign Quote
              </Button>
            )}

            {/* Signing */}
            {quoteStatus === "signing" && (
              <Button className="w-full gap-2" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing…
              </Button>
            )}

            {/* Signed */}
            {(quoteStatus === "signed" || quoteStatus === "sent") && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Quote signed successfully
                </div>

                <div className="flex gap-2">
                  {/* Send via relay */}
                  {relayEnabled && quoteStatus === "signed" && (
                    <Button className="flex-1 gap-2" onClick={handleSend}>
                      <Send className="h-3.5 w-3.5" />
                      Send to Taker
                    </Button>
                  )}

                  {quoteStatus === "sent" && (
                    <Button className="flex-1 gap-2" variant="secondary" disabled>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Sent
                    </Button>
                  )}

                  {/* Copy JSON (always available) */}
                  <Button variant="outline" className="flex-1 gap-2" onClick={handleCopy}>
                    <Copy className="h-3.5 w-3.5" />
                    Copy Quote JSON
                  </Button>
                </div>

                {/* JSON preview */}
                {quoteJSON && (
                  <details className="group">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Preview quote JSON
                    </summary>
                    <pre className="mt-2 p-2 rounded bg-muted/50 text-[10px] font-mono overflow-x-auto max-h-32 overflow-y-auto">
                      {quoteJSON}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {/* Sending */}
            {quoteStatus === "sending" && (
              <Button className="w-full gap-2" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </Button>
            )}

            {/* Error */}
            {quoteStatus === "error" && (
              <div className="space-y-2">
                <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
                  {errorMsg ?? "Something went wrong"}
                </div>
                <Button variant="outline" className="w-full" onClick={handleRetry}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
