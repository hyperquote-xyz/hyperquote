"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  Zap,
  BarChart3,
  Lock,
  Shield,
  TrendingUp,
  Check,
  X,
} from "lucide-react";
import { useHypeSpot } from "@/hooks/useHypeSpot";
import LandingCTA from "@/components/landing/LandingCTA";

/** Format a number with 2 decimal places */
const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Format a number with commas, no decimals (for collateral-size values) */
const fmtInt = (n: number) =>
  Math.round(n).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

// ---------------------------------------------------------------------------
// Premium model — calibrated to Derive live marks + ~15% competitive markup
//
// Derive live data (Feb 19, 2026, HYPE IV ~104-109%):
//   HYPE-20260227-27-P  (8d, -5% OTM put):  mark $1.14, 4.01% of notional
//   HYPE-20260306-30-C  (15d, +5% OTM call): mark $1.74, 6.12% of notional
//
// Base premiums (at minimum size, 1k HYPE):
//   CSP: 4.5% of notional — beats Derive 4.01% by ~12%
//   CC:  7.0% of notional — beats Derive 6.12% by ~14%
//
// Size decay — larger positions get slightly lower premium % (maker risk):
//   Linear from 1.0× at 1k HYPE to 0.85× at 100k HYPE.
//   At 10k: CSP ~4.31%, CC ~6.70%
//   At 100k: CSP ~3.83%, CC ~5.95%
// ---------------------------------------------------------------------------
const CSP_BASE_PCT = 0.045; // 4.5% at min size
const CC_BASE_PCT = 0.07; // 7.0% at min size
const SIZE_DECAY = 0.15; // 15% haircut at max size

const SIZE_MIN = 1_000;
const SIZE_MAX = 100_000;
const SIZE_DEFAULT = 10_000;

/** Size factor: 1.0 at SIZE_MIN, (1 - SIZE_DECAY) at SIZE_MAX */
const sizeFactor = (s: number) =>
  1 - SIZE_DECAY * ((s - SIZE_MIN) / (SIZE_MAX - SIZE_MIN));

export default function OptionsLanding() {
  const { spot, updatedAt } = useHypeSpot();
  const [size, setSize] = useState(SIZE_DEFAULT);

  // Derived strike prices (-5% / +5% OTM)
  const cspStrike = spot ? Math.round(spot * 0.95 * 100) / 100 : null;
  const ccStrike = spot ? Math.round(spot * 1.05 * 100) / 100 : null;

  // Size-adjusted premium percentages
  const sf = sizeFactor(size);
  const cspPremiumPct = CSP_BASE_PCT * sf;
  const ccPremiumPct = CC_BASE_PCT * sf;

  // Dollar premiums (% of notional)
  const cspCollateral = cspStrike ? size * cspStrike : null;
  const cspPremium = cspCollateral ? cspCollateral * cspPremiumPct : null;
  const ccNotional = spot ? size * spot : null;
  const ccPremium = ccNotional ? ccNotional * ccPremiumPct : null;

  // Net entry / effective exit
  const cspNetEntry =
    cspStrike && cspPremium ? cspStrike - cspPremium / size : null;
  const ccEffExit =
    ccStrike && ccPremium ? ccStrike + ccPremium / size : null;

  // Timestamp
  const timeStr = updatedAt
    ? updatedAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div className="relative">
      {/* Example Strategies */}
      <section className="py-20 border-t border-border/40">
        <div className="container mx-auto px-4">
          {/* Live Spot Reference */}
          {spot !== null && (
            <div className="text-center mb-8">
              <p className="text-lg font-semibold">
                Spot Reference:{" "}
                <span className="text-primary">${fmt(spot)}</span>
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Source: Hyperliquid{timeStr ? ` \u00b7 Updated ${timeStr}` : ""}
              </p>
            </div>
          )}

          {/* Size slider */}
          <div className="max-w-md mx-auto mb-12 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Position Size</span>
              <span className="font-semibold text-lg">
                {fmtInt(size)} HYPE
              </span>
            </div>
            <input
              type="range"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={1_000}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-border accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground/60">
              <span>{fmtInt(SIZE_MIN)}</span>
              <span>{fmtInt(SIZE_MAX)}</span>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Cash Secured Put */}
            <Card className="overflow-hidden">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                    <Shield className="h-5 w-5 text-success" />
                  </div>
                  <h3 className="text-lg font-semibold">Cash Secured Put</h3>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Underlying</span>
                    <span className="font-medium">HYPE</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Spot Price</span>
                    <span className="font-medium">
                      {spot !== null ? `$${fmt(spot)}` : "\u2014"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Strategy</span>
                    <span className="font-medium">
                      {cspStrike !== null
                        ? `Sell 7-day $${fmt(cspStrike)} Put (-5%)`
                        : "\u2014"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Size</span>
                    <span className="font-medium">
                      {fmtInt(size)} HYPE equivalent
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Collateral</span>
                    <span className="font-medium">
                      {cspCollateral !== null
                        ? `$${fmtInt(cspCollateral)} USDC`
                        : "\u2014"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Quoted Premium
                    </span>
                    <span className="font-medium text-success">
                      {cspPremium !== null ? `$${fmtInt(cspPremium)} (${(cspPremiumPct * 100).toFixed(1)}%)` : "\u2014"}*
                    </span>
                  </div>
                </div>

                <div className="border-t border-border/50 pt-4 space-y-3 text-sm">
                  <div>
                    <p className="text-success font-medium mb-1">
                      If HYPE &ge;{" "}
                      {cspStrike !== null ? `$${fmt(cspStrike)}` : "\u2014"} at
                      expiry:
                    </p>
                    <p className="text-muted-foreground">
                      Option expires worthless. You keep{" "}
                      {cspPremium !== null ? `$${fmtInt(cspPremium)}` : "\u2014"}{" "}
                      premium.
                    </p>
                  </div>
                  <div>
                    <p className="text-warning font-medium mb-1">
                      If HYPE &lt;{" "}
                      {cspStrike !== null ? `$${fmt(cspStrike)}` : "\u2014"} at
                      expiry:
                    </p>
                    <p className="text-muted-foreground">
                      You buy {fmtInt(size)} HYPE at{" "}
                      {cspStrike !== null ? `$${fmt(cspStrike)}` : "\u2014"}.
                      Net effective entry:{" "}
                      {cspNetEntry !== null
                        ? `$${fmt(cspNetEntry)}`
                        : "\u2014"}{" "}
                      (strike &ndash; premium).
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Covered Call */}
            <Card className="overflow-hidden">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">Covered Call</h3>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Underlying</span>
                    <span className="font-medium">HYPE</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Spot Price</span>
                    <span className="font-medium">
                      {spot !== null ? `$${fmt(spot)}` : "\u2014"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Strategy</span>
                    <span className="font-medium">
                      {ccStrike !== null
                        ? `Sell 14-day $${fmt(ccStrike)} Call (+5%)`
                        : "\u2014"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Size</span>
                    <span className="font-medium">
                      {fmtInt(size)} HYPE
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Collateral</span>
                    <span className="font-medium">
                      {fmtInt(size)} HYPE
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Quoted Premium
                    </span>
                    <span className="font-medium text-success">
                      {ccPremium !== null ? `$${fmtInt(ccPremium)} (${(ccPremiumPct * 100).toFixed(1)}%)` : "\u2014"}*
                    </span>
                  </div>
                </div>

                <div className="border-t border-border/50 pt-4 space-y-3 text-sm">
                  <div>
                    <p className="text-success font-medium mb-1">
                      If HYPE &le;{" "}
                      {ccStrike !== null ? `$${fmt(ccStrike)}` : "\u2014"} at
                      expiry:
                    </p>
                    <p className="text-muted-foreground">
                      Option expires worthless. You keep the premium.
                    </p>
                  </div>
                  <div>
                    <p className="text-warning font-medium mb-1">
                      If HYPE &gt;{" "}
                      {ccStrike !== null ? `$${fmt(ccStrike)}` : "\u2014"} at
                      expiry:
                    </p>
                    <p className="text-muted-foreground">
                      You sell {fmtInt(size)} HYPE at{" "}
                      {ccStrike !== null ? `$${fmt(ccStrike)}` : "\u2014"}.
                      Effective exit:{" "}
                      {ccEffExit !== null ? `$${fmt(ccEffExit)}` : "\u2014"}{" "}
                      (strike + premium).
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground/60 text-center mt-8">
            *Premium shown is illustrative. Actual premiums will vary based on
            strike, expiry, and market maker implied volatility (a fixed IV has
            been used in this example).
          </p>
          <p className="text-xs text-muted-foreground/60 text-center mt-2">
            Early close via RFQ will be supported in a future release. Positions
            currently settle at expiry via automated permissionless keepers.
          </p>
        </div>
      </section>

      {/* Hero Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] -z-10" />

        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            {/* Headline */}
            <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight">
              Trade Volatility with{" "}
              <span className="text-gradient">Precision</span>
            </h2>

            {/* Subheadline */}
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
              RFQ-based options execution for HYPE &amp; HyperEVM tokens.
              <br />
              Request competitive quotes directly from liquidity providers
              across strikes and expiries — fully on-chain settlement.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link href="/options">
                <Button size="xl" className="gap-2 glow">
                  Open Options RFQ
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Link href="/positions">
                <Button size="xl" variant="outline" className="gap-2">
                  View Positions
                </Button>
              </Link>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-6 pt-12 max-w-xl mx-auto">
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">7.5</div>
                <div className="text-sm text-muted-foreground">bps fee</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">notional</div>
                <div className="text-sm text-muted-foreground">fee basis</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">100%</div>
                <div className="text-sm text-muted-foreground">on-chain execution</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 border-t border-border/40">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              How Options RFQ Works
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Request, compare, and settle — fully on-chain
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Step 1 */}
            <Card className="relative overflow-hidden group hover:border-primary/50 transition-colors">
              <div className="absolute top-4 left-4 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                1
              </div>
              <CardContent className="pt-16 pb-6 px-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Request a Quote</h3>
                <p className="text-sm text-muted-foreground">
                  Choose strike, expiry and size. Submit an RFQ to connected
                  market makers.
                </p>
              </CardContent>
            </Card>

            {/* Step 2 */}
            <Card className="relative overflow-hidden group hover:border-primary/50 transition-colors">
              <div className="absolute top-4 left-4 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                2
              </div>
              <CardContent className="pt-16 pb-6 px-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Makers Compete</h3>
                <p className="text-sm text-muted-foreground">
                  Market makers return firm quotes for your exact trade — no
                  orderbook depth limitations.
                </p>
              </CardContent>
            </Card>

            {/* Step 3 */}
            <Card className="relative overflow-hidden group hover:border-primary/50 transition-colors">
              <div className="absolute top-4 left-4 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                3
              </div>
              <CardContent className="pt-16 pb-6 px-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Lock className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  Settle On-Chain
                </h3>
                <p className="text-sm text-muted-foreground">
                  Accept the best quote. Collateral is locked and settlement
                  occurs fully on-chain at expiry.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-20 border-t border-border/40">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              RFQ Execution vs Vaults vs Orderbooks
            </h2>
          </div>

          <Card className="max-w-4xl mx-auto overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left p-4 font-medium text-muted-foreground" />
                    <th className="p-4 font-semibold text-primary text-center">
                      HyperOptions (RFQ)
                    </th>
                    <th className="p-4 font-semibold text-muted-foreground text-center">
                      Vault Products
                    </th>
                    <th className="p-4 font-semibold text-muted-foreground text-center">
                      Orderbook Options
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="p-4 font-medium">
                      Custom strike selection
                    </td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-success inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-muted-foreground inline-block" />
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-4 font-medium">Custom expiry</td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-success inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-muted-foreground inline-block" />
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-4 font-medium">Trade size flexibility</td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-success inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-4 font-medium">
                      Direct market maker pricing
                    </td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-success inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-4 font-medium">
                      Competitive price discovery
                    </td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-success inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <span className="text-muted-foreground">Partial</span>
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-4 font-medium">Slippage on size</td>
                    <td className="p-4 text-center">
                      <span className="text-success font-medium">None</span>
                    </td>
                    <td className="p-4 text-center">
                      <span className="text-muted-foreground">N/A</span>
                    </td>
                    <td className="p-4 text-center">
                      <span className="text-muted-foreground">Variable</span>
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="p-4 font-medium">On-chain settlement</td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-success inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-muted-foreground inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <span className="text-muted-foreground">Varies</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="p-4 font-medium">
                      Structured strategies flexibility
                    </td>
                    <td className="p-4 text-center">
                      <Check className="h-4 w-4 text-success inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                    <td className="p-4 text-center">
                      <X className="h-4 w-4 text-muted-foreground/40 inline-block" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </section>

      <LandingCTA
        headline="Trade Volatility with Precision"
        subcopy="Request structured options quotes across strikes and expiries with fully on-chain settlement."
        buttonLabel="Open HyperOptions →"
        href="/options"
      />
    </div>
  );
}
