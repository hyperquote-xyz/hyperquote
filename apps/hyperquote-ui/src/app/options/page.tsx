import { Suspense } from "react";
import { OptionsInterface } from "@/components/options/OptionsInterface";

interface OptionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OptionsPage({ searchParams }: OptionsPageProps) {
  const params = await searchParams;

  // Extract RFQ prefill params (all optional)
  const prefill = {
    type: typeof params.type === "string" ? params.type : undefined,
    strike: typeof params.strike === "string" ? params.strike : undefined,
    expiry: typeof params.expiry === "string" ? params.expiry : undefined,
    qty: typeof params.qty === "string" ? params.qty : undefined,
    minPremium: typeof params.minPremium === "string" ? params.minPremium : undefined,
    collateral: typeof params.collateral === "string" ? params.collateral : undefined,
    deriveMid: typeof params.deriveMid === "string" ? params.deriveMid : undefined,
    deriveIv: typeof params.deriveIv === "string" ? params.deriveIv : undefined,
  };

  // Only pass prefill if at least one param is present
  const hasPrefill = Object.values(prefill).some(Boolean);

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Options</h1>
        <p className="text-muted-foreground">
          Request option quotes from makers and execute on-chain
        </p>
      </div>
      <Suspense>
        <OptionsInterface prefill={hasPrefill ? prefill : undefined} />
      </Suspense>
    </div>
  );
}
