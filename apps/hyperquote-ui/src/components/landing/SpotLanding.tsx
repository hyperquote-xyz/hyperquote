"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import {
  Zap,
  Shield,
  BarChart3,
  Lock,
  Globe,
  Check,
} from "lucide-react";
import { HomeComparisonCard } from "@/components/HomeComparisonCard";
import LandingCTA from "@/components/landing/LandingCTA";
import { ReadOnlyFeed } from "@/components/maker/ReadOnlyFeed";
import { useMakerRelay } from "@/lib/makerRelay";

// ---------------------------------------------------------------------------
// Supported tokens — curated launch set (local logos in /public/tokens/)
// ---------------------------------------------------------------------------

interface LaunchToken {
  symbol: string;
  /** Filename in /public/tokens/ (e.g. "HYPE.png") */
  file: string;
}

const CORE_LAUNCH_TOKENS: LaunchToken[] = [
  { symbol: "HYPE", file: "HYPE.png" },
  { symbol: "kHYPE", file: "KHYPE.png" },
  { symbol: "PURR", file: "PURR.png" },
  { symbol: "KNTQ", file: "KNTQ.png" },
  { symbol: "HPL", file: "HPL.png" },
];

const STABLE_LAUNCH_TOKENS: LaunchToken[] = [
  { symbol: "USDC", file: "USDC.png" },
  { symbol: "USD₮0", file: "USDT0.png" },
  { symbol: "USDH", file: "USDH.png" },
];

function TokenPill({ token }: { token: LaunchToken }) {
  const [failed, setFailed] = useState(false);
  const handleError = useCallback(() => setFailed(true), []);

  return (
    <div className="flex items-center gap-2.5 h-12 px-4 rounded-lg border border-border/50 bg-card/80">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/tokens/${token.file}`}
          alt={token.symbol}
          className="w-6 h-6 rounded-full object-cover"
          onError={handleError}
        />
      ) : (
        <span className="w-6 h-6 rounded-full bg-muted border border-border/50 flex items-center justify-center text-[10px] font-bold text-muted-foreground select-none">
          {token.symbol.charAt(0)}
        </span>
      )}
      <span className="text-sm font-medium whitespace-nowrap">{token.symbol}</span>
    </div>
  );
}

const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "999");
const RFQ_CONTRACT = process.env.NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS ?? "";
const RELAY_ENABLED = process.env.NEXT_PUBLIC_USE_RELAY === "true";

export default function SpotLanding() {
  const { status: relayStatus, liveRequests } = useMakerRelay({
    enabled: RELAY_ENABLED,
    chainId: CHAIN_ID,
    rfqContract: RFQ_CONTRACT,
  });

  return (
    <div className="relative">
      {/* Launch token strip */}
      <section className="pt-6 pb-10">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 md:p-12 space-y-5 text-center shadow-[0_0_40px_-12px_rgba(255,255,255,0.04)]">
              {/* Core assets */}
              <div className="space-y-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Core Assets
                </span>
                <div className="flex flex-wrap justify-center gap-2.5">
                  {CORE_LAUNCH_TOKENS.map((t) => (
                    <TokenPill key={t.symbol} token={t} />
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground/60 py-1">
                More listings coming soon.
              </p>

              {/* Stable assets */}
              <div className="space-y-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Stable Assets
                </span>
                <div className="flex flex-wrap justify-center gap-2.5">
                  {STABLE_LAUNCH_TOKENS.map((t) => (
                    <TokenPill key={t.symbol} token={t} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NFT Boosts callout — Liquidity Incentive Program */}
      <section className="pb-10">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-4 p-6 rounded-xl bg-muted/30 border border-border/50">
              <div className="flex items-center gap-2 shrink-0">
                <Image
                  src="/badges/hypurr.png"
                  alt="Hypurr"
                  width={44}
                  height={44}
                  className="rounded-full ring-1 ring-border/30"
                />
                <Image
                  src="/badges/hypio.png"
                  alt="Lucky Hypio Winners"
                  width={44}
                  height={44}
                  className="rounded-full ring-1 ring-border/30"
                />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold">
                  Liquidity Incentive Program
                </h4>
                <p className="text-sm text-muted-foreground mt-0.5">
                  HyperQuote rewards meaningful liquidity participation. Eligible NFT holders receive multipliers on RFQ activity.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── separator ── */}
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      {/* Benchmark your execution — LIVE comparison */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-[3fr_2fr] gap-12 items-center max-w-6xl mx-auto">
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                Benchmark Before You Trade
              </h2>
              <div className="space-y-4 text-lg text-muted-foreground leading-relaxed">
                <p>
                  Large trades move order books and drain AMM pools.
                </p>
                <p>
                  HyperQuote benchmarks your execution across HyperCore and
                  HyperEVM liquidity — then connects you directly to makers
                  competing for your size.
                </p>
                <p>
                  Quoted prices are fixed. No slippage. No surprises.
                </p>
              </div>
            </div>

            {/* Live 3-venue comparison card */}
            <HomeComparisonCard />
          </div>
        </div>
      </section>

      {/* ── separator ── */}
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      {/* Built for Size — text left, cards right */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
            {/* Left column — value proposition copy */}
            <div className="space-y-6">
              <div className="space-y-4">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Built for Size.
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  HyperQuote is designed for large, price-sensitive execution.
                </p>
              </div>

              <ul className="space-y-3">
                {[
                  "Private block trades",
                  "Selective maker routing",
                  "No visible slippage impact",
                  "Capital-efficient liquidity",
                  "No passive LP risk",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="text-lg text-muted-foreground/80 italic leading-relaxed">
                <p>AMMs are the fallback.</p>
                <p>HyperQuote is the execution layer for size.</p>
              </div>
            </div>

            {/* Right column — audience cards (2×2) */}
            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  icon: Shield,
                  title: "Whales & Early Token Holders",
                  description: "Exit size without nuking the market.",
                  color: "text-success",
                  bg: "bg-success/10",
                },
                {
                  icon: Lock,
                  title: "DAOs & Treasuries",
                  description: "Execute strategic swaps privately.",
                  color: "text-warning",
                  bg: "bg-warning/10",
                },
                {
                  icon: BarChart3,
                  title: "Funds & Allocators",
                  description: "Benchmark execution before committing capital.",
                  color: "text-primary",
                  bg: "bg-primary/10",
                },
                {
                  icon: Globe,
                  title: "Token Holders",
                  description: "Provide selective liquidity without impermanent loss.",
                  color: "text-primary",
                  bg: "bg-primary/10",
                },
              ].map(({ icon: Icon, title, description, color, bg }) => (
                <div
                  key={title}
                  className="rounded-xl border border-border/50 bg-card/50 p-6 space-y-3"
                >
                  <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── separator ── */}
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      {/* How It Works */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              How HyperQuote Works
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Simple, transparent, and fully on-chain
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 md:p-10 max-w-5xl mx-auto shadow-[0_0_40px_-12px_rgba(255,255,255,0.04)]">
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="overflow-hidden group hover:border-primary/50 transition-colors">
              <CardContent className="pt-8 pb-6 px-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Request Liquidity</h3>
                <p className="text-sm text-muted-foreground">
                  Specify pair, size, and direction (Exact In or Exact Out).
                  Choose public or private routing.
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden group hover:border-primary/50 transition-colors">
              <CardContent className="pt-8 pb-6 px-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Makers Compete</h3>
                <p className="text-sm text-muted-foreground">
                  Makers respond with signed quotes. Compare against AMMs
                  before executing.
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden group hover:border-primary/50 transition-colors">
              <CardContent className="pt-8 pb-6 px-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Lock className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Execute On-Chain</h3>
                <p className="text-sm text-muted-foreground">
                  Accept the best quote. Settlement occurs atomically on
                  HyperEVM.
                </p>
              </CardContent>
            </Card>
          </div>
          </div>
        </div>
      </section>

      {/* Live RFQ Feed — visible when relay is enabled */}
      {RELAY_ENABLED && (
        <section className="py-16 border-t border-border/20">
          <div className="container mx-auto px-4">
            <div className="text-center mb-8">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                Live RFQ Feed
              </h2>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                Real-time public requests from takers looking for quotes
              </p>
            </div>
            <div className="max-w-4xl mx-auto">
              <ReadOnlyFeed
                requests={liveRequests}
                relayStatus={relayStatus}
              />
            </div>
          </div>
        </section>
      )}

      <LandingCTA
        headline="Execute Size with Confidence"
        subcopy="Request competitive quotes from liquidity providers. Settle atomically on HyperEVM."
        buttonLabel="Request a Quote"
        href="/swap"
      />
    </div>
  );
}
