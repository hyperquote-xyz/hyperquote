"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { SwapProduction } from "@/components/swap-v2/SwapProduction";
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

  const validTokenIn = tokenInParam && tokenInParam.startsWith("0x") && getTokenByAddress(tokenInParam)
    ? tokenInParam
    : tokenInParam && !tokenInParam.startsWith("0x")
      ? tokenInParam
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

  return <SwapProduction initialParams={hasParams ? initialParams : undefined} />;
}

export default function SwapPage() {
  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <Suspense fallback={null}>
        <SwapContent />
      </Suspense>
    </div>
  );
}
