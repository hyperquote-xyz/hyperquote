"use client";

import Image from "next/image";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Token } from "@/types";
import { safeSymbol, cn } from "@/lib/utils";
import { isApprovedToken } from "@/config/approvedTokens";

const EXPLORER_URL =
  process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL ?? "https://explorer.hyperevm.io";

interface TokenBadgeProps {
  token: Token;
  /** Show the token symbol text next to the icon. Default true. */
  showSymbol?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Token display with logo, verified badge, and explorer link.
 * - Click opens block explorer contract page.
 * - Hover on verified badge shows tooltip.
 */
export function TokenBadge({
  token,
  showSymbol = true,
  size = "md",
  className,
}: TokenBadgeProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const symbol = safeSymbol(token);
  // Verification: prefer address-based check (deterministic), fall back to symbol only
  // if address is the zero address (native HYPE placeholder).
  const hasRealAddress = token.address !== "0x0000000000000000000000000000000000000000";
  const isVerified = hasRealAddress
    ? isApprovedToken(token.address)
    : isApprovedToken(symbol);
  const iconSize = size === "sm" ? 16 : 20;

  const contractUrl = `${EXPLORER_URL}/address/${token.address}`;

  return (
    <a
      href={contractUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${symbol} — View contract on explorer`}
      className={cn(
        "inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity",
        className
      )}
    >
      {/* Logo */}
      {token.logoUrl && !logoFailed ? (
        <Image
          src={token.logoUrl}
          alt={symbol}
          width={iconSize}
          height={iconSize}
          className="rounded-full"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span
          className={cn(
            "rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground",
            size === "sm" ? "w-4 h-4" : "w-5 h-5"
          )}
        >
          {symbol.slice(0, 2)}
        </span>
      )}

      {/* Symbol + verified */}
      {showSymbol && (
        <span className={cn("font-mono font-medium", size === "sm" ? "text-xs" : "text-sm")}>
          {symbol}
        </span>
      )}

      {isVerified && (
        <span title="Verified token">
          <CheckCircle2
            className={cn(
              "text-primary shrink-0",
              size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"
            )}
          />
        </span>
      )}
    </a>
  );
}
