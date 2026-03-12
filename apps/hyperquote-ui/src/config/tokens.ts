import rawHlSpot from "@/data/hl-spot-tokens.json";
import rawPrjx from "@/data/prjx-tokens.json";
import { Token } from "@/types";
import { stripControls } from "@/lib/utils";

/**
 * Token tiers:
 * - core: always visible, routing + bridge tokens
 * - verified: shown by default (spotMeta-sourced or manually allowlisted)
 * - unverified: hidden unless user enables
 */
export type TokenTier = "core" | "verified" | "unverified";

// ---------------------------------------------------------------------------
// spotMeta token shape (from hl-spot-tokens.json)
// ---------------------------------------------------------------------------

interface HLSpotToken {
  symbol: string;
  name: string;
  index: number;
  hypercoreAddress: string;
  evmAddress: string;
  evmDecimals: number;
  hlWeiDecimals: number;
  szDecimals: number;
  isCanonical: boolean;
  hyperliquidCoin: string | null;
}

const hlSpotTokens: HLSpotToken[] = rawHlSpot as HLSpotToken[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function norm(addr: string) {
  return addr.toLowerCase();
}

function isValidEvmAddress(addr: unknown): addr is `0x${string}` {
  return (
    typeof addr === "string" &&
    addr.startsWith("0x") &&
    addr.length === 42 &&
    /^[0-9a-fA-Fx]+$/.test(addr)
  );
}

function uniqByAddress<T extends { address: string }>(tokens: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tokens) {
    const k = norm(t.address);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tier 0 — Manual Core Tokens (AUTHORITATIVE)
// ---------------------------------------------------------------------------
// These MUST NOT depend on PRJX or spotMeta data.
// They are always visible and always allowed for routing.
// Manual overrides take precedence over spotMeta for address, decimals, logos.

/**
 * Native HYPE — users select this in the UI.
 * Settlement automatically resolves to WHYPE via resolveSettlementToken().
 */
export const NATIVE_HYPE: Token = {
  address: "0x0000000000000000000000000000000000000000",
  symbol: "HYPE",
  name: "HYPE",
  decimals: 18,
  logoUrl: "https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg",
  tier: "core",
  verified: true,
  verificationSource: "manual",
  isBridgePreferred: true,
  isNative: true,
  venue: "hyperevm",
  hyperliquidCoin: "@107",
  hlIndex: 150,
  wrappedAddress: "0x5555555555555555555555555555555555555555",
};

/**
 * WHYPE — Wrapped HYPE ERC-20.
 * NOT in CORE_TOKENS / DEFAULT_TOKENS (users see "HYPE" instead).
 * Exported for internal resolution logic and ALL_TOKENS lookup.
 */
export const WHYPE_TOKEN: Token = {
  address: "0x5555555555555555555555555555555555555555",
  symbol: "WHYPE",
  name: "Wrapped HYPE",
  decimals: 18,
  logoUrl: "https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg",
  tier: "core",
  verified: true,
  verificationSource: "manual",
  isBridgePreferred: true,
  venue: "both",
  hyperliquidCoin: "@107",
};

/**
 * Core tokens — manually curated with logos.
 * HYPE (native) is first — users select it, settlement resolves to WHYPE.
 * WHYPE is NOT listed here (hidden from TokenSelector).
 */
export const CORE_TOKENS: Token[] = [
  NATIVE_HYPE,
  {
    // Circle native USDC on HyperEVM
    // Note: HL spotMeta USDC is 0x6b9e77... (different contract), but DEXes use Circle native
    address: "0xb88339cb7199b77e23db6e890353e22632ba630f",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl: "https://coin-images.coingecko.com/coins/images/6319/small/USDC.png",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
    // USDC is a quote currency on HL — no l2Book coin identifier needed
  },
  {
    // kHYPE — Kinetiq Staked HYPE
    address: "0xfd739d4e423301ce9385c1fb8850539d657c296d",
    symbol: "kHYPE",
    name: "Kinetiq kHYPE",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/67388/small/khype.png",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
    // spotMeta has KHYPE at index 121, but symbol is "KHYPE" not "kHYPE"
    // We override symbol/name but pick up the coin identifier
  },
  {
    // USD₮0 (USDT0)
    address: "0xB8ce59Fc3717aDA4C02eadF9682A9e934f625ebb",
    symbol: "USD₮0",
    name: "USD₮0",
    decimals: 6,
    logoUrl: "https://coin-images.coingecko.com/coins/images/53705/small/usdt0.jpg",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    // PURR — promoted to core
    address: "0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e",
    symbol: "PURR",
    name: "Purr",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/53706/small/purr.jpg",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
    hyperliquidCoin: "PURR",
    hypercoreAddress: "0xc1fb593aeffbeb02f85e0308e9956a90",
    hlIndex: 1,
    hlWeiDecimals: 5,
  },
  {
    // USDH — promoted to core
    address: "0x111111a1a0667d36bd57c0a9f569b98057111111",
    symbol: "USDH",
    name: "USDH",
    decimals: 6,
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
    hyperliquidCoin: "@230",
    hlWeiDecimals: 8,
  },
  {
    // Unit Bitcoin
    address: "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463",
    symbol: "UBTC",
    name: "Unit Bitcoin",
    decimals: 8,
    logoUrl: "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    // Unit Ethereum
    address: "0xBe6727B535545C67d5cAa73dEa54865B92CF7907",
    symbol: "UETH",
    name: "Unit Ethereum",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    // Unit Solana
    address: "0x068f321fa8fb9f0d135f290ef6a3e2813e1c8a29",
    symbol: "USOL",
    name: "Unit Solana",
    decimals: 9,
    logoUrl: "https://coin-images.coingecko.com/coins/images/4128/small/solana.png",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    // Unit Plasma
    address: "0x33af3c2540ba72054e044efe504867b39ae421f5",
    symbol: "UXPL",
    name: "Unit Plasma",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/66489/small/Plasma-symbol-green-1.png",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    // Unit Ethena
    address: "0x58538e6a46e07434d7e7375bc268d3cb839c0133",
    symbol: "UENA",
    name: "Unit Ethena",
    decimals: 18,
    logoUrl: "https://coin-images.coingecko.com/coins/images/36530/small/ethena.png",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    // Unit Pump Fun
    address: "0x27ec642013bcb3d80ca3706599d3cda04f6f4452",
    symbol: "UPUMP",
    name: "Unit Pump Fun",
    decimals: 6,
    logoUrl: "https://coin-images.coingecko.com/coins/images/67164/small/pump.jpg",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
  {
    // Unit Fartcoin
    address: "0x3b4575e689ded21caad31d64c4df1f10f3b2cedf",
    symbol: "UFART",
    name: "Unit Fartcoin",
    decimals: 6,
    logoUrl: "https://coin-images.coingecko.com/coins/images/50891/small/fart.jpg",
    tier: "core",
    verified: true,
    verificationSource: "manual",
    isBridgePreferred: true,
    venue: "both",
  },
];

/**
 * Canonical bridge / routing symbols — derived from CORE_TOKENS order.
 * Used by amm.ts for multi-hop route discovery.
 */
export const BRIDGE_SYMBOLS: string[] = CORE_TOKENS.map((t) => t.symbol);

// ---------------------------------------------------------------------------
// Build lookup of manual core token addresses (for dedup)
// ---------------------------------------------------------------------------

const coreAddressSet = new Set<string>([
  ...CORE_TOKENS.map((t) => norm(t.address)),
  norm(WHYPE_TOKEN.address), // WHYPE is not in CORE_TOKENS but must be excluded from spotMeta dedup
]);

// ---------------------------------------------------------------------------
// spotMeta-derived verified tokens
// ---------------------------------------------------------------------------

/**
 * Merge spotMeta data into Token objects.
 * Tokens already in CORE_TOKENS (by address) are skipped — core overrides win.
 */
function buildSpotMetaTokens(): Token[] {
  const tokens: Token[] = [];

  for (const hl of hlSpotTokens) {
    const addr = norm(hl.evmAddress);

    // Skip if already a manual core token
    if (coreAddressSet.has(addr)) continue;

    // Skip HL's own USDC contract (we use Circle native USDC)
    if (addr === "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24") continue;

    tokens.push({
      address: hl.evmAddress as `0x${string}`,
      symbol: hl.symbol,
      name: hl.name || hl.symbol,
      decimals: hl.evmDecimals,
      tier: "verified",
      verified: true,
      verificationSource: "spotMeta",
      venue: "both",
      hyperliquidCoin: hl.hyperliquidCoin ?? undefined,
      hypercoreAddress: hl.hypercoreAddress,
      hlIndex: hl.index,
      hlWeiDecimals: hl.hlWeiDecimals,
    });
  }

  return tokens;
}

const SPOTMETA_TOKENS = buildSpotMetaTokens();

// ---------------------------------------------------------------------------
// Enrich CORE_TOKENS with spotMeta data (hyperliquidCoin, etc.)
// ---------------------------------------------------------------------------

/**
 * For core tokens that don't have hyperliquidCoin set manually,
 * look up from spotMeta by address match and add the coin identifier.
 */
function enrichCoreWithSpotMeta(): void {
  const hlByAddress = new Map<string, HLSpotToken>();
  for (const hl of hlSpotTokens) {
    hlByAddress.set(norm(hl.evmAddress), hl);
  }

  for (const core of CORE_TOKENS) {
    const hl = hlByAddress.get(norm(core.address));
    if (!hl) continue;

    // Only fill in fields that aren't already manually set
    if (!core.hyperliquidCoin && hl.hyperliquidCoin) {
      core.hyperliquidCoin = hl.hyperliquidCoin;
    }
    if (!core.hypercoreAddress) {
      core.hypercoreAddress = hl.hypercoreAddress;
    }
    if (core.hlIndex === undefined) {
      core.hlIndex = hl.index;
    }
    if (core.hlWeiDecimals === undefined) {
      core.hlWeiDecimals = hl.hlWeiDecimals;
    }
  }
}

enrichCoreWithSpotMeta();

// ---------------------------------------------------------------------------
// Manual verified allowlist (for PRJX tokens not in spotMeta)
// ---------------------------------------------------------------------------

const VERIFIED_ALLOWLIST = new Set<string>([
  // ── Top HyperEVMScan tokens ──
  "0x1fbccdc677c10671ee50b46c61f0f7d135112450", // ETH (bridged Ether)
  "0x43b5406549c866ccbc8802de347ab65650dbde51", // BTC (bridged Bitcoin)
  "0x000000000000780555bd0bca3791f89f9542c2d6", // KNTQ (Kinetiq Governance)
  "0x205be226464ab29339695c1dbf02e7fff207c4d2", // KNTQ (alt deployment)
  "0x1359b05241ca5076c9f59605214f4f84114c0de8", // WHLP (Wrapped HLP)
  "0x1ecd15865d7f8019d546f76d095d9c93cc34edfa", // LIQD (LiquidLaunch)
  "0xc65b7ed65ef904222f9cb8938a66e2d8d4cf4cc1", // FRAC
  "0xed912f61368be50835ad7696f67d106b0cd08fe2", // SENT (Sentient AI)
  "0x2bb9911a1f6b9a2c791c1d49806924b65762df5b", // KEIKO
  "0x5a9f7d128d367f8ecb483b269b23457e15359174", // MASCOT (HFUN Mascot)
  "0x713f4c66221c3920578675dfc45cfa71b5f1f307", // PURRO
  "0x5c2c41bf9f0465d95f67e0ecc979037f19045f48", // HBOOST (HypeBoost)
  "0x2bd923b4496c779b67b957131e1f8fb4e56f1220", // HYSP (HyperSpartan)
  "0x3792af7796a258d45d3b782f5d9057684f023cd9", // SWIM (DegenSwim)
  "0x9612639b31822071f23abd7729a2475ab06c0ab6", // CATAPULT
  "0x00786596b4a805380e60b64d4dc845c691ac11de", // HYPURR
  "0x42a1a6d32c819cbcbfad7483b574776e42964682", // CULT
  "0x00fdbc53719604d924226215bc871d55e40a1009", // LOOP
  "0x1ee330d6d81d88915d1be72b719e0d35c9c14c80", // NAPKIN
  "0x13818b79a4ecc9cd35c769e92e988564d64d9c2b", // MOON (HyperMoon)
  "0xd40412c9f00575c5e4cc04cc61ab2b43253295e5", // HOPE
  "0x88e7606172f587366fc6ee662fab89543c8b33ec", // FISH
  "0x374d280e3676ff974dc4423cd8f1b63157defb74", // EXTRACT
  "0x137b3de689360562401549559e2d0fc05ebece86", // LONG

  // ── DeFi primitives (stables, wrappers, lending) ──
  "0x8a862fd6c12f9ad34c9c2ff45ab2b6712e8cea27", // feUSDC (Felix)
  "0x207ccae51ad2e1c240c4ab4c94b670d438d2201c", // feUSDH (Felix)
  "0xa20d05e1467d0d5ef0020a5ed1c5100470621efc", // RAM (Ramses)
  "0x437cc33344a0b27a429f795ff6b469c72698b291", // wM (WrappedM)
  "0x5bff88ca1442c2496f7e475e9e7786383bc070c0", // sfrxUSD (Frax)
  "0x729655088da8624c1004bf2705e3a3eeebdf0d6d", // USDT0
  "0x4f96b683714377c38123631f2d17cdf18b3f46a7", // SEDA
  "0xf9775085d726e782e83585033b58606f7731ab18", // uniBTC
  "0x89a0cb789851ca0a3f00231511a39186a554d468", // vHYPE
  "0x1368ee9d1212ae5b26ff166049220051a9eebc42", // hakHYPE (Harmonix)
  "0xd31db306e5d79f0018ac92e08492284201493ea1", // syrupUSDC (Syrup)
  "0x8a82cf92e0e290e843e4ebcff92df788a34add3f", // thBILL
  "0x0725a349f733cc13c84232a706d9ca99d2a1ef23", // BOROS
  "0xae60eafb73eb0516951ab20089cff32ac9dc63b7", // US (UltraSolid)
  "0x37d6382b6889ccef8d6871a8b60e667115eddbcf", // pufETH
]);

/**
 * Logo URL lookup for verified (non-core) tokens.
 */
const VERIFIED_LOGO_MAP = new Map<string, string>([
  ["0x000000000000780555bd0bca3791f89f9542c2d6", "https://coin-images.coingecko.com/coins/images/70252/small/kntq.png"],
  ["0x205be226464ab29339695c1dbf02e7fff207c4d2", "https://coin-images.coingecko.com/coins/images/70252/small/kntq.png"],
  ["0x1359b05241ca5076c9f59605214f4f84114c0de8", "https://coin-images.coingecko.com/coins/images/66783/small/image_%282%29.png"],
  ["0x1ecd15865d7f8019d546f76d095d9c93cc34edfa", "https://coin-images.coingecko.com/coins/images/53730/small/Logo.png"],
  ["0x00fdbc53719604d924226215bc871d55e40a1009", "https://coin-images.coingecko.com/coins/images/55979/small/LOOP.png"],
  ["0x4f96b683714377c38123631f2d17cdf18b3f46a7", "https://coin-images.coingecko.com/coins/images/36689/small/SEDA_Logo.png"],
  ["0xf9775085d726e782e83585033b58606f7731ab18", "https://coin-images.coingecko.com/coins/images/39599/small/uniBTC_200px.png"],
  ["0x1368ee9d1212ae5b26ff166049220051a9eebc42", "https://coin-images.coingecko.com/coins/images/69299/small/_hakHYPE.png"],
  ["0x0725a349f733cc13c84232a706d9ca99d2a1ef23", "https://coin-images.coingecko.com/coins/images/68413/small/2025-08-18_20.53.37.jpg"],
  ["0xae60eafb73eb0516951ab20089cff32ac9dc63b7", "https://coin-images.coingecko.com/coins/images/70502/small/ultrasolid_400x400.jpg"],
  ["0x1fbccdc677c10671ee50b46c61f0f7d135112450", "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png"],
  ["0x43b5406549c866ccbc8802de347ab65650dbde51", "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png"],
]);

const BLOCKLIST = new Set<string>([]);

// ---------------------------------------------------------------------------
// PRJX-derived unverified tokens
// ---------------------------------------------------------------------------

type RawToken = {
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
};

// Build set of all addresses we already have (core + WHYPE + spotMeta)
const knownAddressSet = new Set<string>([
  ...CORE_TOKENS.map((t) => norm(t.address)),
  norm(WHYPE_TOKEN.address),
  ...SPOTMETA_TOKENS.map((t) => norm(t.address)),
  norm("0x6b9e773128f453f5c2c60935ee2de2cbc5390a24"), // HL USDC (excluded)
]);

const prjxTokens: RawToken[] = (rawPrjx as RawToken[]) ?? [];

const derived = prjxTokens
  .filter((t) => {
    if (!t || !isValidEvmAddress(t.address)) return false;
    const addr = norm(t.address);
    if (BLOCKLIST.has(addr)) return false;
    if (knownAddressSet.has(addr)) return false; // Skip if already in core or spotMeta
    return true;
  })
  .map((t) => {
    const address = t.address as `0x${string}`;
    const rawSymbol = stripControls(t.symbol ?? "");
    const rawName = stripControls(t.name ?? "");
    const symbol = rawSymbol || "UNKNOWN";
    const name = rawName || rawSymbol || "Unknown";
    const decimals = typeof t.decimals === "number" ? t.decimals : 18;
    const allow = VERIFIED_ALLOWLIST.has(norm(address));

    return {
      address,
      symbol,
      name,
      decimals,
      tier: allow ? ("verified" as const) : ("unverified" as const),
      verified: allow,
      verificationSource: allow ? ("manual" as const) : ("prjx" as const),
      logoUrl: VERIFIED_LOGO_MAP.get(norm(address)) ?? undefined,
      venue: "hyperevm" as const,
    } satisfies Token;
  });

export const PRJX_VERIFIED_TOKENS = derived.filter((t) => t.tier === "verified");
export const PRJX_UNVERIFIED_TOKENS = derived.filter((t) => t.tier === "unverified");

// ---------------------------------------------------------------------------
// Exported token lists
// ---------------------------------------------------------------------------

/**
 * DEFAULT list = what users see in TokenSelector
 * Core + spotMeta verified + PRJX verified.
 * Only includes EVM-settleable tokens (no native HYPE, no hypercore-only).
 */
export const DEFAULT_TOKENS: Token[] = uniqByAddress([
  ...CORE_TOKENS,
  ...SPOTMETA_TOKENS,
  ...PRJX_VERIFIED_TOKENS,
]);

/**
 * ALL tokens = behind a "Show unverified" toggle.
 * Includes WHYPE_TOKEN for internal resolution lookups (getTokenByAddress etc).
 */
export const ALL_TOKENS: Token[] = uniqByAddress([
  ...CORE_TOKENS,
  WHYPE_TOKEN,
  ...SPOTMETA_TOKENS,
  ...PRJX_VERIFIED_TOKENS,
  ...PRJX_UNVERIFIED_TOKENS,
]);

// Keep old names for backward compat
export const VERIFIED_TOKENS = [...SPOTMETA_TOKENS, ...PRJX_VERIFIED_TOKENS];
export const UNVERIFIED_TOKENS = PRJX_UNVERIFIED_TOKENS;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getTokenByAddress(address: string): Token | undefined {
  return ALL_TOKENS.find((t) => norm(t.address) === norm(address));
}

export function getTokenBySymbol(symbol: string): Token | undefined {
  const s = symbol.trim().toLowerCase();
  return ALL_TOKENS.find((t) => (t.symbol ?? "").toLowerCase() === s);
}
