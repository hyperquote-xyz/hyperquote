"use client";

import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NFT_BADGES } from "@/lib/badges";
import { cn } from "@/lib/utils";

/**
 * BadgePills — renders NFT boost avatars for a wallet.
 *
 * Shows 0–2 small circular avatar images based on badge ownership.
 * Each avatar has a hover tooltip with the exact boost description.
 * Renders nothing if no badges held.
 */
export function BadgePills({
  hasHypio,
  hasHypurr,
  size = "sm",
  className,
}: {
  hasHypio: boolean;
  hasHypurr: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!hasHypio && !hasHypurr) return null;

  const avatarSize = size === "sm" ? 20 : 24;

  return (
    <TooltipProvider>
      <span className={cn("inline-flex items-center gap-1 shrink-0", className)}>
        {hasHypurr && (
          <BadgeAvatar
            icon={NFT_BADGES.hypurr.icon}
            label="Hypurr"
            tooltip={NFT_BADGES.hypurr.tooltip}
            avatarSize={avatarSize}
          />
        )}
        {hasHypio && (
          <BadgeAvatar
            icon={NFT_BADGES.hypio.icon}
            label="Hypio"
            tooltip={NFT_BADGES.hypio.tooltip}
            avatarSize={avatarSize}
          />
        )}
      </span>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Single circular avatar with tooltip
// ---------------------------------------------------------------------------

function BadgeAvatar({
  icon,
  label,
  tooltip,
  avatarSize,
}: {
  icon: string;
  label: string;
  tooltip: string;
  avatarSize: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="rounded-full overflow-hidden border-2 border-border/60 shrink-0 cursor-default transition-all hover:ring-2 hover:ring-primary/30 hover:border-primary/40"
          style={{ width: avatarSize, height: avatarSize }}
        >
          <Image
            src={icon}
            alt={label}
            width={avatarSize}
            height={avatarSize}
            className="block object-cover w-full h-full"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
