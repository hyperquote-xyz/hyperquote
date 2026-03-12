import { FeedTable } from "@/components/feed/FeedTable";

export default function FeedPage() {
  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">RFQ Feed</h1>
        <p className="text-muted-foreground">
          Real-time public RFQ activity across HyperQuote.
        </p>
        <p className="text-xs text-muted-foreground/70 mt-2">
          {"🔔 Want instant RFQ alerts? "}
          <a
            href="https://t.me/hyperquote"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Subscribe on Telegram
          </a>
        </p>
      </div>
      <FeedTable />
    </div>
  );
}
