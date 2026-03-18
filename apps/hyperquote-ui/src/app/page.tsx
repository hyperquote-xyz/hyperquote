"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowRight, Users, Zap } from "lucide-react";
import SpotLanding from "@/components/landing/SpotLanding";
import OptionsLanding from "@/components/landing/OptionsLanding";

const enableOptions = process.env.NEXT_PUBLIC_ENABLE_OPTIONS === "true";

type Product = "spot" | "options";

export default function HomePage() {
  const [active, setActive] = useState<Product>("spot");

  return (
    <div className="relative">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative pt-16 pb-6 md:pt-24 md:pb-10 overflow-hidden">
        {/* Hero spotlight — radial glow centered above headline */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(0,255,200,0.08)_0%,rgba(0,255,200,0.04)_30%,transparent_65%)] -z-10 pointer-events-none" />

        {/* Hypurr NFT — right side, deeper overlap (hidden on mobile) */}
        <div className="absolute right-[-20px] top-1/2 -translate-y-1/2 z-[1] pointer-events-none hidden lg:block">
          <Image
            src="/badges/hypurr123.png"
            alt=""
            width={500}
            height={500}
            className="rounded-[32px] opacity-70 drop-shadow-[0_0_60px_rgba(43,184,164,0.15)]"
            style={{
              maskImage: "linear-gradient(to left, black 35%, transparent 88%)",
              WebkitMaskImage: "linear-gradient(to left, black 35%, transparent 88%)",
            }}
            priority
          />
        </div>

        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            {/* Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08]">
              The Liquidity Coordination Layer for{" "}
              <span className="relative inline-block">
                <span className="absolute -inset-x-10 -inset-y-5 bg-[radial-gradient(circle,rgba(0,255,200,0.18)_0%,rgba(0,255,200,0.08)_40%,transparent_70%)] blur-[30px] -z-10 pointer-events-none" />
                <span className="text-primary [text-shadow:0_0_8px_rgba(0,255,200,0.35),0_0_18px_rgba(0,255,200,0.18)]">HyperEVM</span>
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Request size-aware quotes directly from liquidity providers.
              <br />
              No LP exposure. No impermanent loss. Atomic on-chain settlement.
            </p>

            {/* Supporting line */}
            <p className="text-base text-muted-foreground/70 max-w-2xl mx-auto leading-relaxed">
              Anyone can request liquidity. Anyone can quote.
              <br />
              No permissions. No intermediaries.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link href="/swap">
                <Button size="xl" className="gap-2 glow">
                  Request Quote
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Link href="/maker">
                <Button size="xl" variant="outline" className="gap-2">
                  <Users className="h-5 w-5" />
                  Become a Maker
                </Button>
              </Link>
            </div>

            {/* Agent integration callout */}
            <a
              href="https://docs.hyperquote.xyz/agents"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex flex-col sm:flex-row items-center gap-2 sm:gap-3 px-5 py-3 rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm hover:border-primary/30 hover:bg-card/50 transition-all duration-200"
            >
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Zap className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium text-foreground/90">Build trading agents on HyperQuote</span>
              </span>
              <span className="text-xs text-muted-foreground/70 sm:border-l sm:border-border/40 sm:pl-3">
                Listen for RFQs, quote trades, and settle onchain.
              </span>
              <span className="text-xs font-medium text-primary group-hover:underline">
                Agent Integration&nbsp;&rarr;
              </span>
            </a>

            {/* Live pill (non-clickable) */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              Live on HyperEVM
            </div>

            {/* Product toggle — only when options enabled */}
            {enableOptions && (
              <div className="flex items-center justify-center gap-3 pt-4">
                <button
                  onClick={() => setActive("spot")}
                  className={`h-14 px-10 rounded-lg text-lg font-semibold border-2 text-foreground transition-all duration-200 ${
                    active === "spot"
                      ? "border-primary shadow-[0_0_20px_hsl(172_66%_50%/0.15)]"
                      : "border-border/80 hover:border-primary hover:shadow-[0_0_20px_hsl(172_66%_50%/0.15)]"
                  }`}
                >
                  Hyper<span className="text-primary">Spot</span>
                </button>
                <button
                  onClick={() => setActive("options")}
                  className={`h-14 px-10 rounded-lg text-lg font-semibold border-2 text-foreground transition-all duration-200 ${
                    active === "options"
                      ? "border-primary shadow-[0_0_20px_hsl(172_66%_50%/0.15)]"
                      : "border-border/80 hover:border-primary hover:shadow-[0_0_20px_hsl(172_66%_50%/0.15)]"
                  }`}
                >
                  Hyper<span className="text-primary">Options</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Conditional product content ──────────────────────── */}
      {enableOptions && active === "options" ? <OptionsLanding /> : <SpotLanding />}
    </div>
  );
}
