import { PositionsInterface } from "@/components/positions/PositionsInterface";

export default function PositionsPage() {
  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Positions</h1>
        <p className="text-muted-foreground">
          Monitor your HyperQuote Options positions — active, expired &amp; settled
        </p>
      </div>
      <PositionsInterface />
    </div>
  );
}
