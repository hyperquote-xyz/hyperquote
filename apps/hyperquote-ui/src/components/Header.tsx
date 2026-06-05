"use client";

import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { formatAddress } from "@/lib/utils";
import { hyperEVM } from "@/config/chains";
import { Wallet, LogOut, AlertTriangle, ArrowDownUp, Bell, Download } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { WrapModal } from "@/components/WrapModal";
import { HyperQuoteLogo } from "@/components/HyperQuoteLogo";

// ---------------------------------------------------------------------------
// No-wallet fallback — shown when no injected wallet is detected
// ---------------------------------------------------------------------------

const WALLET_LINKS = [
  {
    name: "MetaMask",
    url: "https://metamask.io/download/",
    description: "Most popular EVM wallet",
  },
  {
    name: "Rabby",
    url: "https://rabby.io/",
    description: "Multi-chain DeFi wallet",
  },
];

function NoWalletDropdown() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => setOpen((v) => !v)}
      >
        <Download className="h-4 w-4" />
        Install Wallet
      </Button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-lg border border-border/50 bg-background shadow-lg p-3 space-y-2">
            <p className="text-xs text-muted-foreground px-1">
              No wallet detected. Install one to get started:
            </p>
            {WALLET_LINKS.map((w) => (
              <a
                key={w.name}
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
                onClick={() => setOpen(false)}
              >
                <div>
                  <div className="text-sm font-medium">{w.name}</div>
                  <div className="text-xs text-muted-foreground">{w.description}</div>
                </div>
                <span className="text-xs text-primary shrink-0">Install →</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function Header() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  // Pick best connector: prefer MetaMask (EIP-6963), then generic injected
  const bestConnector = useMemo(() => {
    return (
      connectors.find((c) => c.id === "io.metamask") ??
      connectors.find((c) => c.id === "injected") ??
      connectors[0]
    );
  }, [connectors]);

  const isWrongNetwork = isConnected && chainId !== hyperEVM.id;
  const enableOptions = process.env.NEXT_PUBLIC_ENABLE_OPTIONS === "true";
  const enableTerminal = process.env.NEXT_PUBLIC_ENABLE_TERMINAL === "true";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full group-hover:bg-primary/30 transition-colors" />
            <HyperQuoteLogo size={36} className="relative shadow-lg shadow-primary/25" />
          </div>
          <span className="font-semibold text-xl tracking-tight">
            Hyper<span className="text-primary">Quote</span>
          </span>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="/swap"
            className="text-sm font-medium text-foreground/90 hover:text-foreground transition-colors"
          >
            Swap
          </Link>
          <Link
            href="/feed"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Feed
          </Link>
          <Link
            href="/maker"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Maker
          </Link>
          <Link
            href="/league"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            League
          </Link>
          <Link
            href="/points"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Points
          </Link>
          {enableOptions && (
            <Link
              href="/options"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Options
            </Link>
          )}
          {enableOptions && (
            <Link
              href="/positions"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Positions
            </Link>
          )}
          {enableTerminal && (
            <Link
              href="/terminal"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Terminal
            </Link>
          )}
        </nav>

        {/* Right side: socials + wallet */}
        <div className="flex items-center gap-3">
          {/* Social links */}
          <div className="hidden sm:flex items-center gap-2">
            <a
              href="https://t.me/hyperquote"
              target="_blank"
              rel="noopener noreferrer"
              title="Subscribe to RFQ alerts on Telegram"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Bell className="h-3.5 w-3.5" />
              Alerts
            </a>
            <a
              href="https://x.com/hyperquote_xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm leading-none">&#120143;</span>
              @hyperquote_xyz
            </a>
          </div>

          <div className="hidden sm:block w-px h-6 bg-border/50" />

          {isWrongNetwork && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => switchChain({ chainId: hyperEVM.id })}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              Switch Network
            </Button>
          )}

          {isConnected ? (
            <div className="flex items-center gap-2">
              <a
                href="https://docs.hyperquote.xyz/agents"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Agents
              </a>
              <WrapModal
                trigger={
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <ArrowDownUp className="h-3.5 w-3.5" />
                    Wrap
                  </Button>
                }
              />
              <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-sm font-mono">{formatAddress(address!)}</span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => disconnect()}
                className="shrink-0"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : bestConnector ? (
            <Button
              onClick={() => {
                reset();
                connect({ connector: bestConnector });
              }}
              loading={isPending}
              className="gap-2"
            >
              <Wallet className="h-4 w-4" />
              Connect Wallet
            </Button>
          ) : (
            <NoWalletDropdown />
          )}
        </div>
      </div>
    </header>
  );
}
