"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { SwapInterface } from "@/components/SwapInterface";
import { getTokenByAddress } from "@/config/tokens";
import { toast } from "@/components/ui/use-toast";

function SwapContent() {
  const searchParams = useSearchParams();
  const toastedRef = useRef(false);

  const tokenInParam = searchParams.get("tokenIn") ?? undefined;
  const tokenOutParam = searchParams.get("tokenOut") ?? undefined;
  const amountInParam = searchParams.get("amountIn") ?? undefined;
  const amountOutParam = searchParams.get("amountOut") ?? undefined;
  const modeParam = (searchParams.get("mode") as "EXACT_IN" | "EXACT_OUT") ?? undefined;

  // Validate token addresses — show toast if invalid
  useEffect(() => {
    if (toastedRef.current) return;
    const invalid: string[] = [];

    if (tokenInParam && tokenInParam.startsWith("0x") && !getTokenByAddress(tokenInParam)) {
      invalid.push(`tokenIn (${tokenInParam.slice(0, 10)}…)`);
    }
    if (tokenOutParam && tokenOutParam.startsWith("0x") && !getTokenByAddress(tokenOutParam)) {
      invalid.push(`tokenOut (${tokenOutParam.slice(0, 10)}…)`);
    }

    if (invalid.length > 0) {
      toastedRef.current = true;
      toast({
        title: "Invalid token in URL",
        description: `Unknown token address: ${invalid.join(", ")}. Loading clean form.`,
        variant: "destructive",
      });
    }
  }, [tokenInParam, tokenOutParam]);

  // Build valid params — only pass tokens that actually resolve
  const validTokenIn = tokenInParam && tokenInParam.startsWith("0x") && getTokenByAddress(tokenInParam)
    ? tokenInParam
    : tokenInParam && !tokenInParam.startsWith("0x")
      ? tokenInParam // symbol-based params pass through
      : undefined;

  const validTokenOut = tokenOutParam && tokenOutParam.startsWith("0x") && getTokenByAddress(tokenOutParam)
    ? tokenOutParam
    : tokenOutParam && !tokenOutParam.startsWith("0x")
      ? tokenOutParam
      : undefined;

  const initialParams = {
    tokenIn: validTokenIn,
    tokenOut: validTokenOut,
    amountIn: amountInParam,
    amountOut: amountOutParam,
    mode: modeParam,
  };

  const hasParams = Object.values(initialParams).some(Boolean);

  return <SwapInterface initialParams={hasParams ? initialParams : undefined} />;
}

export default function SwapPage() {
  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">RFQ Swap</h1>
        <p className="text-muted-foreground">
          Request quotes from liquidity providers and execute atomic swaps on HyperEVM.
        </p>
      </div>
      <Suspense fallback={null}>
        <SwapContent />
      </Suspense>
    </div>
  );
}
