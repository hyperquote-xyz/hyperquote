/**
 * Token address <-> symbol resolution for HyperEVM launch tokens.
 *
 * Provides static mapping for known tokens so the /subscribe command
 * can accept human-readable symbols (e.g. "HYPE") and resolve to addresses.
 * Alert payloads already include TokenInfo with symbol/decimals, so this
 * is primarily used for parsing user input.
 */

export interface KnownToken {
  symbol: string;
  address: string; // lowercase 0x
  decimals: number;
}

const KNOWN_TOKENS: KnownToken[] = [
  // Native HYPE — users select "HYPE" in the UI (0x000...000)
  { symbol: "HYPE",  address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  // WHYPE — Wrapped HYPE ERC-20, used for settlement
  { symbol: "WHYPE", address: "0x5555555555555555555555555555555555555555", decimals: 18 },
  { symbol: "kHYPE", address: "0xfd739d4e423301ce9385c1fb8850539d657c296d", decimals: 18 },
  { symbol: "PURR",  address: "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e", decimals: 18 },
  { symbol: "KNTQ",  address: "0x000000000000780555bd0bca3791f89f9542c2d6", decimals: 18 },
  { symbol: "HPL",   address: "0xbd6dab50f03a305a80037294fa8d1a9dc0cac91b", decimals: 18 },
  // Circle native USDC on HyperEVM (matches apps/hyperquote-ui/src/config/tokens.ts)
  { symbol: "USDC",  address: "0xb88339cb7199b77e23db6e890353e22632ba630f", decimals: 6 },
  { symbol: "USDH",  address: "0x111111a1a0667d36bd57c0a9f569b98057111111", decimals: 6 },
];

// Lookup maps
const bySymbol = new Map<string, KnownToken>();
const byAddress = new Map<string, KnownToken>();

for (const token of KNOWN_TOKENS) {
  bySymbol.set(token.symbol.toLowerCase(), token);
  byAddress.set(token.address.toLowerCase(), token);
}

/**
 * Resolve a symbol (case-insensitive) to a token address.
 * Returns lowercase 0x address or null if unknown.
 */
export function symbolToAddress(symbol: string): string | null {
  return bySymbol.get(symbol.toLowerCase())?.address ?? null;
}

/**
 * Resolve an address to a human-readable symbol.
 * Returns symbol or null if unknown.
 */
export function addressToSymbol(address: string): string | null {
  return byAddress.get(address.toLowerCase())?.symbol ?? null;
}

/**
 * Get all known token symbols (unique display symbols, no duplicates like WHYPE).
 */
export function allTokenSymbols(): string[] {
  return ["HYPE", "kHYPE", "PURR", "KNTQ", "HPL", "USDC", "USDH"];
}

/**
 * Format a raw amount (BigInt string) with token decimals.
 * Returns human-readable string like "1,000.5".
 */
export function formatTokenAmount(
  raw: string | null | undefined,
  decimals: number
): string {
  if (!raw) return "?";
  try {
    const value = Number(BigInt(raw)) / 10 ** decimals;
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  } catch {
    return raw;
  }
}
