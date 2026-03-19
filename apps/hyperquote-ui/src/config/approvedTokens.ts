/**
 * Approved Token Registry — HyperQuote Launch
 *
 * Single source of truth for tokens supported in the RFQ flow.
 * Only tokens in this list can be selected for RFQ creation.
 *
 * Post-launch: add tokens here to expand the supported set.
 * The broader token universe (config/tokens.ts) remains for routing,
 * SOR discovery, and internal lookups — but RFQ selection is gated here.
 */

import { Token } from "@/types";

// ---------------------------------------------------------------------------
// Explorer base URL
// ---------------------------------------------------------------------------

const EXPLORER_URL =
  process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL ?? "https://explorer.hyperevm.io";

// ---------------------------------------------------------------------------
// Approved token definitions
// ---------------------------------------------------------------------------

export interface ApprovedToken extends Token {
  /** Whether this is a USD-pegged stablecoin. */
  isStable: boolean;
  /** Local logo file in /public/tokens/ (preferred over remote logoUrl). */
  localLogo: string;
}

/**
 * Launch assets — non-stable tokens approved for RFQ.
 */
const LAUNCH_ASSETS: ApprovedToken[] = [
  {
    address: "0x0000000000000000000000000000000000000000",
    symbol: "HYPE",
    name: "HYPE",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg",
    localLogo: "HYPE.png",
    isStable: false,
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isNative: true,
    wrappedAddress: "0x5555555555555555555555555555555555555555",
    hyperliquidCoin: "@107",
    hlIndex: 150,
    venue: "hyperevm",
  },
  {
    address: "0xfd739d4e423301ce9385c1fb8850539d657c296d",
    symbol: "kHYPE",
    name: "Kinetiq kHYPE",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/67388/small/khype.png",
    localLogo: "KHYPE.png",
    isStable: false,
    tier: "core",
    verified: true,
    verificationSource: "manual",
    venue: "both",
  },
  {
    address: "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e",
    symbol: "PURR",
    name: "Purr",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/53706/small/purr.jpg",
    localLogo: "PURR.png",
    isStable: false,
    tier: "core",
    verified: true,
    verificationSource: "manual",
    venue: "both",
    hyperliquidCoin: "PURR",
    hypercoreAddress: "0xc1fb593aeffbeb02f85e0308e9956a90",
    hlIndex: 1,
    hlWeiDecimals: 5,
  },
  {
    address: "0x000000000000780555bd0bca3791f89f9542c2d6",
    symbol: "KNTQ",
    name: "Kinetiq",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/70252/small/kntq.png",
    localLogo: "KNTQ.png",
    isStable: false,
    tier: "verified",
    verified: true,
    verificationSource: "manual",
    venue: "both",
    hyperliquidCoin: undefined,
    hypercoreAddress: "0xbd31bd605c0a1b82c72aae3587f9061f",
    hlIndex: 124,
    hlWeiDecimals: 8,
  },
  {
    // HPL — HyperCore-only (no EVM address), listed for display/selection
    // Settlement will route through HyperCore spot
    address: "0x0000000000000000000000000000000000000000" as `0x${string}`, // placeholder — HyperCore-only
    symbol: "HPL",
    name: "HyperLend",
    decimals: 18,
    logoUrl: undefined,
    localLogo: "HPL.png",
    isStable: false,
    tier: "verified",
    verified: true,
    verificationSource: "manual",
    venue: "hypercore",
    hypercoreAddress: "0x5e887f0c6c3deec190c36186bf23369f",
    hlIndex: 120,
  },
];

/**
 * Stable assets — USD-pegged tokens approved for RFQ.
 */
const STABLE_ASSETS: ApprovedToken[] = [
  {
    address: "0xb88339cb7199b77e23db6e890353e22632ba630f",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl: "https://coin-images.coingecko.com/coins/images/6319/small/USDC.png",
    localLogo: "USDC.png",
    isStable: true,
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    address: "0xB8ce59Fc3717aDA4C02eadF9682A9e934f625ebb",
    symbol: "USD₮0",
    name: "USD₮0",
    decimals: 6,
    logoUrl: "https://coin-images.coingecko.com/coins/images/53705/small/usdt0.jpg",
    localLogo: "USDT0.png",
    isStable: true,
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    address: "0x111111a1a0667d36bd57c0a9f569b98057111111",
    symbol: "USDH",
    name: "USDH",
    decimals: 6,
    logoUrl: undefined,
    localLogo: "USDH.png",
    isStable: true,
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
    hyperliquidCoin: "@230",
    hlWeiDecimals: 8,
  },
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** All approved tokens (launch + stable). */
export const APPROVED_TOKENS: ApprovedToken[] = [
  ...LAUNCH_ASSETS,
  ...STABLE_ASSETS,
];

/** Launch assets only (non-stable). */
export const APPROVED_LAUNCH_ASSETS = LAUNCH_ASSETS;

/** Stable assets only. */
export const APPROVED_STABLE_ASSETS = STABLE_ASSETS;

/** Symbol → ApprovedToken lookup. */
export const APPROVED_TOKEN_MAP = new Map<string, ApprovedToken>(
  APPROVED_TOKENS.map((t) => [t.symbol.toUpperCase(), t])
);

/** Address → ApprovedToken lookup (lowercase keys). */
const addressMap = new Map<string, ApprovedToken>(
  APPROVED_TOKENS.map((t) => [t.address.toLowerCase(), t])
);

/**
 * Check if a token is in the approved launch set.
 * Accepts either an address or a symbol.
 */
export function isApprovedToken(addressOrSymbol: string): boolean {
  if (addressOrSymbol.startsWith("0x")) {
    return addressMap.has(addressOrSymbol.toLowerCase());
  }
  return APPROVED_TOKEN_MAP.has(addressOrSymbol.toUpperCase());
}

/**
 * Look up an approved token by address.
 */
export function getApprovedToken(address: string): ApprovedToken | undefined {
  return addressMap.get(address.toLowerCase());
}

/**
 * Get the local logo path for an approved token.
 */
export function approvedLogoUrl(token: ApprovedToken): string {
  return `/tokens/${token.localLogo}`;
}

/**
 * Approved token symbols as a Set (uppercase) — for quick membership checks.
 */
export const APPROVED_SYMBOLS = new Set<string>(
  APPROVED_TOKENS.map((t) => t.symbol.toUpperCase())
);

/**
 * Approved stable symbols as a Set (uppercase).
 */
export const APPROVED_STABLE_SYMBOLS = new Set<string>(
  STABLE_ASSETS.map((t) => t.symbol.toUpperCase())
);
