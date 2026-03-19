"use client";

import { useState, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import { APPROVED_LAUNCH_ASSETS } from "@/config/approvedTokens";

// ---------------------------------------------------------------------------
// Token filter definitions — derived from approved token registry
// ---------------------------------------------------------------------------

export interface FilterToken {
  /** Display symbol */
  symbol: string;
  /** Filename in /public/tokens/ */
  file: string;
  /** Symbols that should match this filter (case-insensitive) */
  matchSymbols: string[];
}

/** Build match symbols for a given approved token symbol. */
function matchSymbolsFor(symbol: string): string[] {
  const upper = symbol.toUpperCase();
  if (upper === "HYPE") return ["HYPE", "WHYPE"];
  if (upper === "KHYPE" || symbol === "kHYPE") return ["KHYPE", "kHYPE"];
  return [symbol];
}

export const FILTER_TOKENS: FilterToken[] = APPROVED_LAUNCH_ASSETS.map((t) => ({
  symbol: t.symbol,
  file: t.localLogo,
  matchSymbols: matchSymbolsFor(t.symbol),
}));

/** All symbols for the default "all selected" state */
export const ALL_FILTER_SYMBOLS = new Set(FILTER_TOKENS.map((t) => t.symbol));

// ---------------------------------------------------------------------------
// TokenFilterBar
// ---------------------------------------------------------------------------

interface TokenFilterBarProps {
  selected: Set<string>;
  onToggle: (symbol: string) => void;
}

export const TokenFilterBar = memo(function TokenFilterBar({
  selected,
  onToggle,
}: TokenFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {FILTER_TOKENS.map((token) => (
        <FilterPill
          key={token.symbol}
          token={token}
          isSelected={selected.has(token.symbol)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// FilterPill — individual token pill with selected/unselected states
// ---------------------------------------------------------------------------

const FilterPill = memo(function FilterPill({
  token,
  isSelected,
  onToggle,
}: {
  token: FilterToken;
  isSelected: boolean;
  onToggle: (symbol: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const handleError = useCallback(() => setImgFailed(true), []);

  return (
    <button
      type="button"
      onClick={() => onToggle(token.symbol)}
      className={cn(
        "flex items-center gap-2 h-9 px-3 rounded-lg border transition-all duration-150 cursor-pointer select-none",
        isSelected
          ? "border-border bg-card/80 opacity-100"
          : "border-border/30 bg-card/30 opacity-50 hover:opacity-70"
      )}
    >
      {!imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/tokens/${token.file}`}
          alt={token.symbol}
          className="w-5 h-5 rounded-full object-cover"
          onError={handleError}
        />
      ) : (
        <span className="w-5 h-5 rounded-full bg-muted border border-border/50 flex items-center justify-center text-[9px] font-bold text-muted-foreground">
          {token.symbol.charAt(0)}
        </span>
      )}
      <span className="text-xs font-medium whitespace-nowrap">
        {token.symbol}
      </span>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Matching helper — checks if a feed item's tokenIn or tokenOut matches
// any of the selected filter tokens.
// ---------------------------------------------------------------------------

/** Build a Set of lowercase symbols that should pass the filter */
export function buildMatchSet(selected: Set<string>): Set<string> {
  const match = new Set<string>();
  for (const token of FILTER_TOKENS) {
    if (selected.has(token.symbol)) {
      for (const s of token.matchSymbols) {
        match.add(s.toLowerCase());
      }
    }
  }
  return match;
}
