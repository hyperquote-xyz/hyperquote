"use client";

import { QuoteWithMeta, Token, TransactionState, QuoteKind, QuoteValidationResult } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import {
  CheckCircle2,
  Loader2,
  ExternalLink,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  ShieldX,
  Lock,
  XCircle,
  Clock,
} from "lucide-react";

interface ExecutionPanelProps {
  quote: QuoteWithMeta | null;
  tokenIn: Token;
  tokenOut: Token;
  txState: TransactionState;
  needsApproval: boolean;
  validation?: QuoteValidationResult;
  minOut: bigint;
  maxIn: bigint;
  onApprove: () => void;
  onFill: () => void;
  onReset?: () => void;
  /** Price improvement vs best venue, in bps. Positive = better than venues. */
  priceImprovementBps?: number | null;
  explorerUrl?: string;
}

export function ExecutionPanel({
  quote,
  tokenIn,
  tokenOut,
  txState,
  needsApproval,
  validation,
  minOut,
  maxIn,
  onApprove,
  onFill,
  onReset,
  priceImprovementBps,
  explorerUrl = "https://explorer.hyperevm.io",
}: ExecutionPanelProps) {
  // Hook must be called unconditionally (before any early returns)
  const { isExpired: countdownExpired, isUrgent, isExpiringSoon, formattedTime } = useQuoteExpiry(quote?.expiry);

  if (!quote) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground">
          Select a quote to execute
        </CardContent>
      </Card>
    );
  }

  const isApproving = txState.status === "approving";
  const isApproved = txState.status === "approved" || !needsApproval;
  const isFilling = txState.status === "filling";
  const isSuccess = txState.status === "success";
  const isError = txState.status === "error";

  // Validation-gated: only allow fill if signature is verified
  const vStatus = validation?.status;
  const sigVerified = vStatus === "valid" || vStatus === "expiring_soon" || vStatus === "needs_approval";
  const sigInvalid = vStatus === "invalid_signature" || vStatus === "structural_mismatch";
  const sigValidating = vStatus === "validating";
  const sigExpired = vStatus === "expired" || countdownExpired;

  // Fill is blocked when quote is expired (prevents wasted gas)
  const fillBlocked = sigExpired || countdownExpired;

  const constraint =
    quote.kind === QuoteKind.EXACT_IN
      ? `Min output: ${formatAmount(minOut, tokenOut.decimals)} ${safeSymbol(tokenOut)}`
      : `Max input: ${formatAmount(maxIn, tokenIn.decimals)} ${safeSymbol(tokenIn)}`;

  return (
    <Card className={cn(
      "transition-colors duration-300",
      countdownExpired && "border-red-500/40",
      isUrgent && !countdownExpired && "border-red-500/50 animate-pulse",
      isExpiringSoon && "border-amber-500/40",
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Execute Trade</CardTitle>
          {!isSuccess && (
            <div className={cn(
              "flex items-center gap-1.5 text-sm font-mono",
              countdownExpired
                ? "text-red-500"
                : isUrgent
                  ? "text-red-500 animate-countdown-pulse"
                  : isExpiringSoon
                    ? "text-amber-500"
                    : "text-muted-foreground"
            )}>
              <Clock className="h-3.5 w-3.5" />
              <span>{formattedTime}</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trade Summary */}
        <div className="p-3 rounded-lg bg-muted/30 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">You Pay</span>
            <span className="font-medium">
              {formatAmount(quote.amountIn, tokenIn.decimals)} {safeSymbol(tokenIn)}
            </span>
          </div>
          <div className="flex items-center justify-center">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">You Receive</span>
            <span className="font-medium text-success">
              {formatAmount(quote.amountOut, tokenOut.decimals)} {safeSymbol(tokenOut)}
            </span>
          </div>
          <div className="pt-2 border-t border-border/50 text-xs text-muted-foreground">
            {constraint}
          </div>
        </div>

        {/* ── Validation Status Banner ── */}
        {sigValidating && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Verifying quote signature…
          </div>
        )}

        {sigVerified && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 text-sm text-emerald-600">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Signature verified — maker {formatAddress(quote.maker, 4)} confirmed
          </div>
        )}

        {sigInvalid && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-sm text-red-500">
            <ShieldX className="h-4 w-4 shrink-0" />
            {validation?.message ?? "Quote signature is invalid or does not match maker."}
          </div>
        )}

        {sigExpired && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-sm text-red-500">
            <XCircle className="h-4 w-4 shrink-0" />
            Quote has expired — select a new quote to continue
          </div>
        )}

        {vStatus === "expiring_soon" && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Quote expires in {validation?.secondsLeft ?? "<10"}s — fill quickly
          </div>
        )}

        {/* Steps — only show when signature is verified */}
        {sigVerified && !sigExpired && (
          <div className="space-y-3">
            {/* Step 1: Approve */}
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full border-2",
                  isApproved
                    ? "border-success bg-success/10 text-success"
                    : isApproving
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {isApproved ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : isApproving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="text-sm font-medium">1</span>
                )}
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Approve {safeSymbol(tokenIn)}</div>
                <div className="text-xs text-muted-foreground">
                  {isApproved
                    ? "Token approved"
                    : isApproving
                      ? "Waiting for approval…"
                      : "Allow contract to spend your tokens"}
                </div>
              </div>
              {needsApproval && !isApproved && (
                <Button
                  size="sm"
                  onClick={onApprove}
                  loading={isApproving}
                  disabled={isApproving || isFilling}
                >
                  Approve
                </Button>
              )}
            </div>

            {/* Step 2: Fill */}
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full border-2",
                  isSuccess
                    ? "border-success bg-success/10 text-success"
                    : isFilling
                      ? "border-primary bg-primary/10 text-primary"
                      : isApproved
                        ? "border-muted-foreground text-muted-foreground"
                        : "border-muted-foreground/30 text-muted-foreground/50"
                )}
              >
                {isSuccess ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : isFilling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="text-sm font-medium">2</span>
                )}
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Execute Swap</div>
                <div className="text-xs text-muted-foreground">
                  {isSuccess
                    ? "Swap completed!"
                    : isFilling
                      ? "Confirming transaction…"
                      : "Fill the quote on-chain"}
                </div>
              </div>
              {isApproved && !isSuccess && (
                <Button
                  size="sm"
                  onClick={onFill}
                  loading={isFilling}
                  disabled={isFilling || fillBlocked}
                  variant={fillBlocked ? "destructive" : "default"}
                >
                  {fillBlocked ? "Expired" : "Fill Quote"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Blocked message when sig is invalid */}
        {sigInvalid && (
          <div className="p-3 rounded-lg border border-red-500/20 text-center text-sm text-red-400">
            Filling is disabled — this quote has an invalid signature.
          </div>
        )}

        {/* Transaction Links */}
        {(txState.approvalTxHash || txState.fillTxHash) && (
          <div className="pt-3 border-t border-border/50 space-y-2">
            {txState.approvalTxHash && (
              <a
                href={`${explorerUrl}/tx/${txState.approvalTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Approval Tx: {formatAddress(txState.approvalTxHash, 8)}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {txState.fillTxHash && (
              <a
                href={`${explorerUrl}/tx/${txState.fillTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <span>Swap Tx: {formatAddress(txState.fillTxHash, 8)}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Error State */}
        {isError && txState.error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{txState.error}</span>
          </div>
        )}

        {/* Success State — Rich overlay */}
        {isSuccess && (
          <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-4">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Trade Executed Successfully</span>
            </div>

            {/* Trade summary */}
            <div className="rounded-lg bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">You Paid</span>
                <span className="font-mono font-medium">
                  {formatAmount(quote.amountIn, tokenIn.decimals)} {safeSymbol(tokenIn)}
                </span>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">You Received</span>
                <span className="font-mono font-medium text-success">
                  {formatAmount(quote.amountOut, tokenOut.decimals)} {safeSymbol(tokenOut)}
                </span>
              </div>
            </div>

            {/* Price improvement */}
            {priceImprovementBps != null && priceImprovementBps > 0 && (
              <div className="flex items-center gap-2 text-xs text-emerald-500 bg-emerald-500/10 rounded-lg px-3 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  +{priceImprovementBps.toFixed(1)} bps better than best venue
                </span>
              </div>
            )}

            {/* Tx link — prominent */}
            {txState.fillTxHash && (
              <a
                href={`${explorerUrl}/tx/${txState.fillTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary hover:bg-primary/10 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                View Transaction
              </a>
            )}

            {/* New Trade button */}
            {onReset && (
              <Button
                variant="outline"
                className="w-full"
                onClick={onReset}
              >
                New Trade
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
