import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import Link from "next/link";
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

            {/* Top banner */}
            <div className="bg-primary/10 border-b border-primary/20">
              <div className="container mx-auto px-4 py-2 text-center">
                <Link
                  href="/swap"
                  className="text-xs sm:text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  HyperQuote is live on HyperEVM — request liquidity before you
                  swap &rarr;
                </Link>
              </div>
            </div>

            {/* Header */}
            <Header />

            {/* Main content */}
            <main className="flex-1">{children}</main>

            {/* Footer */}
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
