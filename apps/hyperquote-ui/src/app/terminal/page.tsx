import { TerminalInterface } from "@/components/terminal/TerminalInterface";

export default function TerminalPage() {
  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Terminal</h1>
        <p className="text-muted-foreground">
          Live options market data — Derive trades, strike ladders &amp; venues
        </p>
      </div>
      <TerminalInterface />
    </div>
  );
}
