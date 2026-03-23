/**
 * NFT Badge configuration — shared between server (API route) and client (UI).
 *
 * Two collections:
 *   1) Lucky Hypio Winners → 1.25x boost
 *   2) Hypurr              → 1.5x  boost
 *   Both held              → 2.0x  boost
 */

export const NFT_BADGES = {
  hypio: {
    contract: "0x63eb9d77d083ca10c304e28d5191321977fd0bfb" as const,
    name: "Lucky Hypio Winners",
    slug: "hypio" as const,
    boost: 1.25,
    icon: "/badges/hypurr.png",
    tooltip: "Hypio Holder \u2014 1.25x Points Boost",
  },
  hypurr: {
    contract: "0x9125e2d6827a00b0f8330d6ef7bef07730bac685" as const,
    name: "Hypurr",
    slug: "hypurr" as const,
    boost: 1.5,
    icon: "/badges/hypio.png",
    tooltip: "Hypurr Holder \u2014 1.5x Points Boost",
  },
} as const;

export const BOTH_BOOST = 2.0;
export const BOTH_TOOLTIP = "2x Points Boost Active";

export interface BadgeResult {
  hasHypio: boolean;
  hasHypurr: boolean;
  boostMultiplier: number;
}

/** Derive multiplier from badge ownership. */
export function computeBoost(hasHypio: boolean, hasHypurr: boolean): number {
  if (hasHypio && hasHypurr) return BOTH_BOOST;
  if (hasHypurr) return NFT_BADGES.hypurr.boost;
  if (hasHypio) return NFT_BADGES.hypio.boost;
  return 1.0;
}
