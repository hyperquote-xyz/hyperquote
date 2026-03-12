import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "HyperQuote | RFQ Trading on HyperEVM",
  description:
    "Trade size with less slippage via RFQ. Permissionless, on-chain settlement on HyperEVM.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem("wagmi.store");if(s&&s.indexOf("metaMask")!==-1){localStorage.removeItem("wagmi.store");localStorage.removeItem("wagmi.recentConnectorId");localStorage.removeItem("wagmi.connected")}}catch(e){}`,
          }}
        />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased min-h-screen`}
      >
        <Providers>
          <div className="relative min-h-screen flex flex-col">
            {/* Background effects */}
            <div className="fixed inset-0 animated-gradient -z-10" />
            <div className="fixed inset-0 grid-pattern -z-10 opacity-30" />

            {/* Header */}
            <Header />

            {/* Main content */}
            <main className="flex-1">{children}</main>

            {/* Footer */}
            <footer className="border-t border-border/40 py-6 mt-auto">
              <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
                <p>
                  HyperQuote — Permissionless RFQ on HyperEVM •{" "}
                  <a
                    href={process.env.NEXT_PUBLIC_DOCS_URL || "http://localhost:3001"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Docs
                  </a>
                  {" "}•{" "}
                  <a
                    href="https://hyperliquid.xyz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Powered by Hyperliquid
                  </a>
                </p>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
