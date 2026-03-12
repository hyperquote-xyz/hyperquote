"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import {
  CheckCircle2,
  Loader2,
  ExternalLink,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Token } from "@/types";
import { resolveSettlementToken } from "@/lib/native-wrap";
import type {
  OptionSide,
  OptionQuoteWithMeta,
  OptionTxState,
} from "@/types/options";

interface OptionsExecutionPanelProps {
  quote: OptionQuoteWithMeta | null;
  underlying: Token;
  collateral: Token;
  side: OptionSide;
  txState: OptionTxState;
  explorerUrl?: string;
  onApprove?: () => void;
  onExecute?: () => void;
}

export function OptionsExecutionPanel({
  quote,
  underlying,
  collateral,
  side,
  txState,
  explorerUrl = "https://explorer.hyperevm.io",
  onApprove,
  onExecute,
}: OptionsExecutionPanelProps) {
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
  const isApproved = txState.status === "approved";
  const isExecuting = txState.status === "executing";
  const isSuccess = txState.status === "success";
  const isError = txState.status === "error";

  // For CSP: seller locks collateral (stablecoin)
  // For CC: seller locks underlying — resolve HYPE → wHYPE for display/approval
  const lockToken = resolveSettlementToken(side === "put" ? collateral : underlying);
  const lockAmount = quote.collateralRequired;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Execute Option</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trade Summary */}
        <div className="p-3 rounded-lg bg-muted/30 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">You Lock</span>
            <span className="font-medium">
              {formatAmount(lockAmount, lockToken.decimals)}{" "}
              {safeSymbol(lockToken)}
            </span>
          </div>
          <div className="flex items-center justify-center">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">You Receive</span>
            <span className="font-medium text-success">
              {formatAmount(quote.premium, collateral.decimals)}{" "}
              {safeSymbol(collateral)} premium
            </span>
          </div>
          <div className="pt-2 border-t border-border/50 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Type</span>
              <span>{quote.isCall ? "Covered Call" : "Cash-Secured Put"}</span>
            </div>
            <div className="flex justify-between">
              <span>Strike</span>
              <span className="font-mono">
                {formatAmount(quote.strike, 18)} {safeSymbol(collateral)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Quantity</span>
              <span className="font-mono">
                {formatAmount(quote.quantity, 18)} {safeSymbol(underlying)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Expiry</span>
              <span className="font-mono">
                {new Date(quote.expiry * 1000).toISOString().slice(0, 10)} 08:00 UTC
              </span>
            </div>
            <div className="flex justify-between">
              <span>Maker</span>
              <span className="font-mono">{formatAddress(quote.maker, 6)}</span>
            </div>
          </div>
        </div>

        {/* Execution Steps */}
        <div className="space-y-3">
          {/* Step 1: Approve Collateral */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full border-2",
                isApproved || isExecuting || isSuccess
                  ? "border-success bg-success/10 text-success"
                  : isApproving
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {isApproved || isExecuting || isSuccess ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : isApproving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="text-sm font-medium">1</span>
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">
                Approve {safeSymbol(lockToken)}
              </div>
              <div className="text-xs text-muted-foreground">
                {isApproved || isExecuting || isSuccess
                  ? "Token approved"
                  : isApproving
                    ? "Waiting for approval…"
                    : `Allow OptionsEngine to lock your ${safeSymbol(lockToken)}`}
              </div>
            </div>
            {!isApproved && !isExecuting && !isSuccess && (
              <Button
                size="sm"
                onClick={onApprove}
                loading={isApproving}
                disabled={isApproving || quote.isExpired}
              >
                Approve
              </Button>
            )}
          </div>

          {/* Step 2: Execute */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full border-2",
                isSuccess
                  ? "border-success bg-success/10 text-success"
                  : isExecuting
                    ? "border-primary bg-primary/10 text-primary"
                    : isApproved
                      ? "border-muted-foreground text-muted-foreground"
                      : "border-muted-foreground/30 text-muted-foreground/50",
              )}
            >
              {isSuccess ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : isExecuting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="text-sm font-medium">2</span>
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Execute Option</div>
              <div className="text-xs text-muted-foreground">
                {isSuccess
                  ? `Position minted${txState.positionId ? ` (#${txState.positionId})` : ""}!`
                  : isExecuting
                    ? "Confirming transaction…"
                    : "Lock collateral, receive premium, mint position NFT"}
              </div>
            </div>
            {isApproved && !isSuccess && (
              <Button
                size="sm"
                onClick={onExecute}
                loading={isExecuting}
                disabled={isExecuting || quote.isExpired}
                variant={quote.isExpired ? "destructive" : "default"}
              >
                {quote.isExpired ? "Expired" : "Execute"}
              </Button>
            )}
          </div>
        </div>

        {/* Transaction Links */}
        {(txState.approvalTxHash || txState.executeTxHash) && (
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
            {txState.executeTxHash && (
              <a
                href={`${explorerUrl}/tx/${txState.executeTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <span>Execute Tx: {formatAddress(txState.executeTxHash, 8)}</span>
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

        {/* Success State */}
        {isSuccess && (
          <div className="p-3 rounded-lg bg-success/10 border border-success/20 text-success text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Option position created!
              {txState.positionId && ` Position #${txState.positionId}`}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
