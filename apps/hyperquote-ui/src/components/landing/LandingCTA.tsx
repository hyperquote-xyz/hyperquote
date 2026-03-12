import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

interface LandingCTAProps {
  headline: string;
  subcopy: string;
  buttonLabel: string;
  href: string;
}

export default function LandingCTA({
  headline,
  subcopy,
  buttonLabel,
  href,
}: LandingCTAProps) {
  return (
    <section className="py-12 border-t border-border/20">
      <div className="container mx-auto px-4">
        <div className="relative max-w-3xl mx-auto">
          {/* Outer radial glow */}
          <div className="absolute -inset-6 bg-primary/[0.04] rounded-3xl blur-2xl pointer-events-none" />

          <Card className="relative overflow-hidden">
            <div className="relative p-8 md:p-12 text-center">
              {/* Inner gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent" />

              <div className="relative">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                  {headline}
                </h2>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto mt-6">
                  {subcopy}
                </p>
                <Link href={href} className="inline-block mt-8">
                  <Button size="xl" className="gap-2 glow">
                    {buttonLabel}
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
