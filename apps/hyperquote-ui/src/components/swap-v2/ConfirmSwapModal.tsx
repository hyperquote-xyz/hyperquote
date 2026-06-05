"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  formatAmount,
  formatAddress,
  safeSymbol,
  formatUsd,
  calculatePrice,
} from "@/lib/utils";
import {
  ArrowDown,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useQuoteExpiry } from "@/hooks/useCountdown";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Quote {
  maker: string;
  amountIn: bigint;
  amountOut: bigint;
  expiry: number;
  kind: number;
  tokenIn: string;
  tokenOut: string;
  signature: string;
  nonce: bigint;
  taker: string;
}

interface TokenMeta {
  symbol: string;
  decimals: number;
  address: string;
}

interface TxState {
  status: string;
  fillTxHash?: string;
  error?: string;
}

export interface ConfirmSwapModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  quote: Quote | null;
  tokenIn: TokenMeta | null;
  tokenOut: TokenMeta | null;
  amountInUsd: number | null;
  amountOutUsd: number | null;
  publicBestAmount: string | null;
  feePips: number;
  txState: TxState;
  needsApproval: boolean;
  onApprove: () => void;
}

// ---------------------------------------------------------------------------
// Explorer helper
// ---------------------------------------------------------------------------

const EXPLORER_URL =
  process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL ?? "https://explorer.hyperevm.io";

function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function ExpiryCountdown({ expiry }: { expiry: number }) {
  const { formattedTime, isExpired, isUrgent, isExpiringSoon } =
    useQuoteExpiry(expiry);

  return (
    <span
      className={
        isExpired
          ? "text-destructive"
          : isUrgent
            ? "text-destructive animate-pulse"
            : isExpiringSoon
              ? "text-yellow-500"
              : "text-foreground"
      }
    >
      {formattedTime}
    </span>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConfirmSwapModal({
  open,
  onClose,
  onConfirm,
  quote,
  tokenIn,
  tokenOut,
  amountInUsd,
  amountOutUsd,
  publicBestAmount,
  feePips,
  txState,
  needsApproval,
  onApprove,
}: ConfirmSwapModalProps) {
  if (!quote || !tokenIn || !tokenOut) return null;

  const inSymbol = safeSymbol(tokenIn);
  const outSymbol = safeSymbol(tokenOut);

  const formattedIn = formatAmount(quote.amountIn, tokenIn.decimals);
  const formattedOut = formatAmount(quote.amountOut, tokenOut.decimals);

  const rate = calculatePrice(
    quote.amountIn,
    quote.amountOut,
    tokenIn.decimals,
    tokenOut.decimals,
  );

  // Public best route comparison (basis-point improvement)
  let bpsImprovement: number | null = null;
  if (publicBestAmount !== null) {
    const publicNum = parseFloat(publicBestAmount);
    const rfqNum =
      Number(quote.amountOut) / 10 ** tokenOut.decimals;
    if (publicNum > 0) {
      bpsImprovement = Math.round(
        ((rfqNum - publicNum) / publicNum) * 10_000,
      );
    }
  }

  const feePercent = (feePips / 10_000).toFixed(2);

  const isFilling = txState.status === "filling";
  const isSuccess = txState.status === "success";
  const isError = txState.status === "error";
  const canExecute =
    !needsApproval &&
    (txState.status === "idle" || txState.status === "approved");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Swap</DialogTitle>
          <DialogDescription>
            Review the details below before executing.
          </DialogDescription>
        </DialogHeader>

        {/* ── You pay ──────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/40 bg-card/40 p-4 space-y-1">
          <span className="text-xs text-muted-foreground">You pay</span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-semibold font-mono tabular-nums">
              {formattedIn}
            </span>
            <span className="text-sm font-medium">{inSymbol}</span>
          </div>
          {amountInUsd != null && (
            <span className="text-xs text-muted-foreground">
              {formatUsd(amountInUsd)}
            </span>
          )}
        </div>

        {/* ── Arrow separator ──────────────────────────────────────── */}
        <div className="flex justify-center -my-2">
          <div className="rounded-full border border-border/40 bg-card/60 p-1.5">
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* ── You receive ──────────────────────────────────────────── */}
        <div className="rounded-lg border border-border/40 bg-card/40 p-4 space-y-1">
          <span className="text-xs text-muted-foreground">You receive</span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-semibold font-mono tabular-nums text-primary">
              {formattedOut}
            </span>
            <span className="text-sm font-medium">{outSymbol}</span>
          </div>
          {amountOutUsd != null && (
            <span className="text-xs text-muted-foreground">
              {formatUsd(amountOutUsd)}
            </span>
          )}
        </div>

        {/* ── Details ──────────────────────────────────────────────── */}
        <div className="space-y-2 rounded-lg border border-border/30 bg-card/20 p-3">
          <DetailRow label="Rate">
            1 {inSymbol} = {rate.toFixed(6)} {outSymbol}
          </DetailRow>

          <DetailRow label="Protocol fee">{feePercent}%</DetailRow>

          <DetailRow label="Maker">
            {formatAddress(quote.maker)}
          </DetailRow>

          <DetailRow label="Quote expires">
            <ExpiryCountdown expiry={quote.expiry} />
          </DetailRow>

          <DetailRow label="Min receive">
            {formattedOut} {outSymbol}
          </DetailRow>
        </div>

        {/* ── Public best route comparison ─────────────────────────── */}
        {publicBestAmount !== null && bpsImprovement !== null && (
          <div className="text-xs rounded-lg border border-border/30 bg-card/20 p-3 space-y-0.5">
            <span className="text-muted-foreground">
              vs Public Best Route:{" "}
              <span className="font-mono text-foreground">
                {publicBestAmount} {outSymbol}
              </span>
            </span>
            {bpsImprovement > 0 ? (
              <p className="text-emerald-500 font-medium">
                +{bpsImprovement} bps improvement
              </p>
            ) : bpsImprovement === 0 ? (
              <p className="text-muted-foreground">Matches public route</p>
            ) : (
              <p className="text-yellow-500 font-medium">
                {bpsImprovement} bps vs public route
              </p>
            )}
          </div>
        )}

        {/* ── Error message ────────────────────────────────────────── */}
        {isError && txState.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <span className="text-xs text-destructive">{txState.error}</span>
          </div>
        )}

        {/* ── Success message ──────────────────────────────────────── */}
        {isSuccess && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-500 space-y-1">
              <span className="font-medium">Swap Complete!</span>
              {txState.fillTxHash && (
                <a
                  href={txUrl(txState.fillTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 underline underline-offset-2 hover:text-emerald-400 transition-colors"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* ── Footer buttons ──────────────────────────────────────── */}
        <DialogFooter className="gap-2 sm:gap-2">
          {/* Cancel — hidden while filling or after success */}
          {!isFilling && !isSuccess && (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}

          {/* Approve */}
          {needsApproval && !isFilling && !isSuccess && (
            <Button onClick={onApprove}>Approve {inSymbol}</Button>
          )}

          {/* Confirm & Execute */}
          {canExecute && (
            <Button
              variant="success"
              onClick={onConfirm}
            >
              Confirm &amp; Execute
            </Button>
          )}

          {/* Executing spinner */}
          {isFilling && (
            <Button disabled variant="secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Executing...
            </Button>
          )}

          {/* Success close */}
          {isSuccess && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}

          {/* Error retry */}
          {isError && (
            <Button onClick={onConfirm}>Try Again</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
