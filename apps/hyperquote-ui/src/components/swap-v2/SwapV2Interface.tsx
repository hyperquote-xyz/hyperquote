"use client";

import { useState, useEffect, useCallback } from "react";
import { Token } from "@/types";
import { NATIVE_HYPE } from "@/config/tokens";
import { SwapForm } from "./SwapForm";
import { LiveQuotesPanel } from "./LiveQuotesPanel";
import { useMockQuotes } from "./useMockQuotes";

const USDC: Token = {
  address: "0xbB5f6798A14c74AA65D76E7bDCbD3E7367c4a359" as `0x${string}`,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  tier: "core",
  verified: true,
};

export function SwapV2Interface() {
  const [tokenIn, setTokenIn] = useState<Token | null>(NATIVE_HYPE);
  const [tokenOut, setTokenOut] = useState<Token | null>(USDC);
  const [amountIn, setAmountIn] = useState("10");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMakers, setSelectedMakers] = useState<string[]>([]);

  const hasValidInput = !!(tokenIn && tokenOut && parseFloat(amountIn) > 0);

  const quoteData = useMockQuotes({
    tokenIn,
    tokenOut,
    amountIn,
    enabled: hasValidInput && isSearching,
  });

  const handleFindPrice = useCallback(() => {
    if (!hasValidInput) return;
    setIsSearching(true);
  }, [hasValidInput]);

  const handleCancel = useCallback(() => {
    setIsSearching(false);
  }, []);

  useEffect(() => {
    setIsSearching(false);
  }, [tokenIn, tokenOut, amountIn]);

  const handleExecute = useCallback(() => {
    // Mock execution — would trigger wallet tx in production
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Swap</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Get competing live quotes from HyperEVM liquidity providers
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Swap Form */}
        <SwapForm
          tokenIn={tokenIn}
          tokenOut={tokenOut}
          amountIn={amountIn}
          visibility={visibility}
          selectedMakers={selectedMakers}
          onTokenInChange={setTokenIn}
          onTokenOutChange={setTokenOut}
          onAmountInChange={setAmountIn}
          onVisibilityChange={setVisibility}
          onSelectedMakersChange={setSelectedMakers}
          onFindPrice={handleFindPrice}
          onCancel={handleCancel}
          isSearching={isSearching}
          bestPrice={quoteData.bestMaker?.price ?? null}
          mockUsdPerToken={quoteData.mockUsdPerToken}
        />

        {/* RIGHT — Live Quotes */}
        <LiveQuotesPanel
          makers={quoteData.makers}
          expired={quoteData.expired}
          references={quoteData.references}
          bestMaker={quoteData.bestMaker}
          countdown={quoteData.countdown}
          isLive={quoteData.isLive}
          isSearching={isSearching}
          tokenOut={tokenOut}
          bpsVsDex={quoteData.bpsVsDex}
          bpsVsCore={quoteData.bpsVsCore}
          refCountdown={quoteData.refCountdown}
          newBestFlash={quoteData.newBestFlash}
          bestAmountOut={null}
          onExecute={handleExecute}
        />
      </div>

      {/* Subtle footer note */}
      <p className="text-center text-xs text-muted-foreground/50 mt-8">
        Makers compete to beat AMM pricing
      </p>
    </div>
  );
}
