"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RFQQuote, QuoteKind, quoteToJSON } from "@/types";
import { formatAmount, formatAddress, cn, safeSymbol } from "@/lib/utils";
import { useQuoteExpiry } from "@/hooks/useCountdown";
import { getTokenByAddress } from "@/config/tokens";
import { toast } from "@/components/ui/use-toast";
import {
  Clock,
  ArrowRight,
  Copy,
  CheckCircle2,
  XCircle,
  ClipboardList,
} from "lucide-react";

interface QuoteRowProps {
  quote: RFQQuote;
  status: "signed" | "sent" | "filled";
}

function QuoteRow({ quote, status }: QuoteRowProps) {
  const { formattedTime, isExpired } = useQuoteExpiry(quote.expiry);
  const tokenIn = getTokenByAddress(quote.tokenIn);
  const tokenOut = getTokenByAddress(quote.tokenOut);

  const handleCopy = async () => {
    const json = JSON.stringify(quoteToJSON(quote), null, 2);
    await navigator.clipboard.writeText(json);
    toast({ title: "Copied!", description: "Quote JSON copied" });
  };

  const statusConfig = {
    signed: { label: "Signed", variant: "secondary" as const, icon: CheckCircle2 },
    sent: { label: "Sent", variant: "default" as const, icon: CheckCircle2 },
    filled: { label: "Filled", variant: "default" as const, icon: CheckCircle2 },
  }[status];

  return (
    <div className={cn("rounded-xl border p-3 space-y-2", isExpired && "opacity-50")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {safeSymbol(tokenIn) !== "UNKNOWN" ? safeSymbol(tokenIn) : quote.tokenIn.slice(0, 6)}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm font-semibold">
            {safeSymbol(tokenOut) !== "UNKNOWN" ? safeSymbol(tokenOut) : quote.tokenOut.slice(0, 6)}
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {quote.kind === QuoteKind.EXACT_IN ? "Exact In" : "Exact Out"}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusConfig.variant} className="text-[10px] gap-1 px-1.5 py-0">
            <statusConfig.icon className="h-2.5 w-2.5" />
            {statusConfig.label}
          </Badge>
          <div className={cn(
            "flex items-center gap-1 text-xs font-mono",
            isExpired ? "text-destructive" : "text-muted-foreground"
          )}>
            <Clock className="h-3 w-3" />
            {formattedTime}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          In: <span className="font-mono">{formatAmount(quote.amountIn, tokenIn?.decimals ?? 18, 4)}</span>
          {" → "}
          Out: <span className="font-mono">{formatAmount(quote.amountOut, tokenOut?.decimals ?? 18, 4)}</span>
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2 gap-1 text-xs" onClick={handleCopy}>
          <Copy className="h-3 w-3" />
          Copy
        </Button>
      </div>
    </div>
  );
}

interface MyQuotesProps {
  quotes: Array<{ quote: RFQQuote; status: "signed" | "sent" | "filled" }>;
}

export function MyQuotes({ quotes }: MyQuotesProps) {
  if (quotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ClipboardList className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground font-medium">No quotes yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Quotes you sign will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {quotes.map((q, i) => (
        <QuoteRow key={q.quote.signature + i} quote={q.quote} status={q.status} />
      ))}
    </div>
  );
}
