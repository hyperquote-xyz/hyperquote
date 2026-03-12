"use client";

import { useState, useEffect, ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWrapUnwrap } from "@/hooks/useWrapUnwrap";
import { formatAmount } from "@/lib/utils";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ArrowDownUp,
} from "lucide-react";
import { formatAddress } from "@/lib/utils";
import { useChainId, useSwitchChain } from "wagmi";
import { hyperEVM } from "@/config/chains";

interface WrapModalProps {
  trigger: ReactNode;
  /** Pre-select tab: "wrap" or "unwrap" */
  defaultTab?: "wrap" | "unwrap";
  /** Pre-fill the amount input (in human-readable decimals, e.g. "1.5") */
  defaultAmount?: string;
  /** Called after a successful wrap transaction */
  onWrapSuccess?: () => void;
  /** Called after a successful unwrap transaction */
  onUnwrapSuccess?: () => void;
}

export function WrapModal({
  trigger,
  defaultTab = "wrap",
  defaultAmount = "",
  onWrapSuccess,
  onUnwrapSuccess,
}: WrapModalProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"wrap" | "unwrap">(defaultTab);
  const [amount, setAmount] = useState(defaultAmount);
  const {
    nativeBalance,
    whypeBalance,
    wrap,
    unwrap,
    txState,
    resetTx,
  } = useWrapUnwrap();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const isWrongNetwork = chainId !== hyperEVM.id;

  // Reset state when modal opens / tab changes
  useEffect(() => {
    if (open) {
      setTab(defaultTab);
      setAmount(defaultAmount);
      resetTx();
    }
  }, [open, defaultTab, defaultAmount, resetTx]);

  useEffect(() => {
    resetTx();
    setAmount("");
  }, [tab, resetTx]);

  const decimals = 18; // HYPE / wHYPE both 18 decimals

  const maxBalance = tab === "wrap" ? nativeBalance : whypeBalance;
  const maxHuman = formatAmount(maxBalance, decimals);

  const handleMax = () => {
    setAmount(maxHuman);
  };

  const parseAmountToBigInt = (val: string): bigint | null => {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return null;
    return BigInt(Math.floor(n * 10 ** decimals));
  };

  const handleSubmit = async () => {
    const parsed = parseAmountToBigInt(amount);
    if (!parsed) return;

    if (tab === "wrap") {
      const ok = await wrap(parsed);
      if (ok) onWrapSuccess?.();
    } else {
      const ok = await unwrap(parsed);
      if (ok) onUnwrapSuccess?.();
    }
  };

  const isLoading = txState.status === "wrapping" || txState.status === "unwrapping";
  const isSuccess = txState.status === "success";
  const isError = txState.status === "error";

  const parsedAmount = parseAmountToBigInt(amount);
  const hasValidAmount = parsedAmount !== null && parsedAmount > 0n;
  const exceedsBalance = parsedAmount !== null && parsedAmount > maxBalance;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownUp className="h-5 w-5 text-primary" />
            Wrap / Unwrap HYPE
          </DialogTitle>
        </DialogHeader>

        {isWrongNetwork ? (
          <div className="space-y-4 pt-2">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Wrong network</div>
                <div className="text-xs text-amber-600/80 mt-0.5">
                  Switch to HyperEVM to wrap or unwrap HYPE.
                </div>
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => switchChain({ chainId: hyperEVM.id })}
            >
              Switch to HyperEVM
            </Button>
          </div>
        ) : (
        <>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "wrap" | "unwrap")}>
          <TabsList className="w-full">
            <TabsTrigger value="wrap" className="flex-1">
              Wrap
            </TabsTrigger>
            <TabsTrigger value="unwrap" className="flex-1">
              Unwrap
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-4 pt-2">
          {/* Balances */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <div className="text-xs text-muted-foreground mb-1">HYPE (Native)</div>
              <div className="text-sm font-mono font-medium">
                {formatAmount(nativeBalance, decimals)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <div className="text-xs text-muted-foreground mb-1">wHYPE (ERC-20)</div>
              <div className="text-sm font-mono font-medium">
                {formatAmount(whypeBalance, decimals)}
              </div>
            </div>
          </div>

          {/* Amount input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {tab === "wrap" ? "HYPE to wrap" : "wHYPE to unwrap"}
              </span>
              <button
                type="button"
                onClick={handleMax}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Max: {maxHuman}
              </button>
            </div>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isLoading || isSuccess}
            />
            {exceedsBalance && (
              <p className="text-xs text-destructive">
                Exceeds available balance
              </p>
            )}
          </div>

          {/* Action button */}
          {!isSuccess && (
            <Button
              className="w-full"
              onClick={handleSubmit}
              loading={isLoading}
              disabled={!hasValidAmount || exceedsBalance || isLoading}
            >
              {isLoading
                ? tab === "wrap"
                  ? "Wrapping..."
                  : "Unwrapping..."
                : tab === "wrap"
                  ? "Wrap HYPE"
                  : "Unwrap wHYPE"}
            </Button>
          )}

          {/* Success state */}
          {isSuccess && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-success/10 border border-success/20 text-success text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {tab === "wrap" ? "Wrapped" : "Unwrapped"} successfully!
                </span>
              </div>
              {txState.txHash && (
                <a
                  href={`https://explorer.hyperevm.io/tx/${txState.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>Tx: {formatAddress(txState.txHash, 8)}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  resetTx();
                  setAmount("");
                  setOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          )}

          {/* Error state */}
          {isError && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="line-clamp-3">{txState.error}</span>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={resetTx}
              >
                Try Again
              </Button>
            </div>
          )}

          {/* Explanation */}
          <p className="text-xs text-muted-foreground text-center">
            {tab === "wrap"
              ? "Wrapping converts native HYPE to wHYPE (ERC-20), required for on-chain settlement."
              : "Unwrapping converts wHYPE (ERC-20) back to native HYPE."}
          </p>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
