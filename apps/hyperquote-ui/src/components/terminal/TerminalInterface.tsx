"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTape, useLadder, useVenues } from "@/hooks/useTerminalApi";
import { TradeTape } from "./TradeTape";
import { StrikeLadder, expiryToYYYYMMDD } from "./StrikeLadder";
import { VenuePanel } from "./VenuePanel";
import { HQRfqWidget } from "./HQRfqWidget";
import { RfqSuggestionPanel } from "./RfqSuggestionPanel";
import type { LiquidityFilter, StrikeSelection } from "@/types/terminal";

// ---------------------------------------------------------------------------
// Supported underlyings
// ---------------------------------------------------------------------------

const UNDERLYINGS = ["ETH", "BTC"] as const;

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TerminalInterface() {
  // ── Global state ──
  const [underlying, setUnderlying] = useState<string>("ETH");
  const [activeTab, setActiveTab] = useState<string>("tape");

  // ── Tape state ──
  const [liquidityFilter, setLiquidityFilter] = useState<LiquidityFilter>("all");

  // ── Ladder state ──
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");

  // ── Strike selection (RFQ overlay) ──
  const [selectedStrike, setSelectedStrike] = useState<StrikeSelection | null>(null);

  // ── Data hooks ──
  const tape = useTape({
    underlying,
    limit: 50,
    liquidityGuess: liquidityFilter,
    pollMs: 5000,
  });

  const venues = useVenues({
    underlying,
    pollMs: 10000,
  });

  const ladder = useLadder({
    underlying,
    expiry: selectedExpiry || undefined,
    pollMs: 5000,
  });

  // Auto-select first expiry when venues load
  useEffect(() => {
    if (venues.data?.expiries && venues.data.expiries.length > 0 && !selectedExpiry) {
      const first = venues.data.expiries[0];
      setSelectedExpiry(expiryToYYYYMMDD(first.expiry));
    }
  }, [venues.data, selectedExpiry]);

  // Reset expiry + strike selection when underlying changes
  useEffect(() => {
    setSelectedExpiry("");
    setSelectedStrike(null);
  }, [underlying]);

  // Clear strike selection when expiry changes
  useEffect(() => {
    setSelectedStrike(null);
  }, [selectedExpiry]);

  // Derive spot from venues or ladder
  const spot =
    ladder.data?.strikes?.find((s) => s.index != null)?.index ??
    venues.data?.expiries?.[0]?.spot ??
    null;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* ── Controls Row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Underlying selector */}
        <Select value={underlying} onValueChange={setUnderlying}>
          <SelectTrigger className="w-[120px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNDERLYINGS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* View tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="tape">Trade Tape</TabsTrigger>
            <TabsTrigger value="ladder">Strike Ladder</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ── Main Content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Primary panel — 3 cols */}
        <div className="lg:col-span-3">
          {activeTab === "tape" && (
            <TradeTape
              trades={tape.data?.trades}
              loading={tape.loading}
              error={tape.error}
              liquidityFilter={liquidityFilter}
              onLiquidityFilterChange={setLiquidityFilter}
            />
          )}

          {activeTab === "ladder" && (
            <StrikeLadder
              strikes={ladder.data?.strikes}
              loading={ladder.loading}
              error={ladder.error}
              expiries={venues.data?.expiries ?? []}
              selectedExpiry={selectedExpiry}
              onExpiryChange={setSelectedExpiry}
              underlying={underlying}
              expiryTs={ladder.data?.expiryTs}
              onStrikeSelect={setSelectedStrike}
              selectedStrike={selectedStrike}
            />
          )}
        </div>

        {/* Sidebar — 1 col */}
        <div className="space-y-6">
          {/* RFQ Suggestion panel — shows when strike is selected */}
          {selectedStrike && (
            <RfqSuggestionPanel
              selection={selectedStrike}
              underlying={underlying}
              selectedExpiry={selectedExpiry}
              onClear={() => setSelectedStrike(null)}
            />
          )}

          {/* Venue overview */}
          <VenuePanel
            expiries={venues.data?.expiries}
            loading={venues.loading}
            error={venues.error}
            underlying={underlying}
            selectedExpiry={selectedExpiry}
            onExpirySelect={(code) => {
              setSelectedExpiry(code);
              setActiveTab("ladder");
            }}
          />

          {/* HyperQuote RFQ beta widget */}
          <HQRfqWidget spot={spot} underlying={underlying} />
        </div>
      </div>
    </div>
  );
}
