import Link from "next/link";
import { HyperQuoteLogo } from "@/components/HyperQuoteLogo";

const FOOTER_LINKS = [
  { label: "App", href: "https://app.hyperquote.xyz" },
  { label: "Docs", href: "https://docs.hyperquote.xyz" },
  { label: "GitHub", href: "https://github.com/hyperquote-xyz/hyperquote" },
  { label: "Telegram", href: "https://t.me/hyperquote" },
  { label: "X", href: "https://x.com/hyperquote_xyz" },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-border/40 py-8 mt-auto">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
          {/* Left — brand */}
          <div className="text-center md:text-left">
            <Link href="/" className="inline-flex items-center gap-3">
              <HyperQuoteLogo size={48} />
              <div>
                <span className="font-semibold text-lg tracking-tight block">
                  Hyper<span className="text-primary">Quote</span>
                </span>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">
                  Request-for-Quote liquidity protocol for size-aware spot
                  execution.
                </p>
              </div>
            </Link>
          </div>

          {/* Right — links */}
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        {/* Copyright */}
        <div className="mt-6 pt-4 border-t border-border/30 text-center">
          <p className="text-[11px] text-muted-foreground/60">
            &copy; 2026 HyperQuote
          </p>
        </div>
      </div>
    </footer>
  );
}
