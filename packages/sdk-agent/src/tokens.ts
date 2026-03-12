/**
 * HyperQuote Agent SDK — Token Resolution
 *
 * Fetches and caches token list from the agent API.
 * Provides symbol → address resolution.
 */

import type { HyperQuoteClient } from "./client.js";
import type { TokenInfo } from "./types.js";

export class TokenResolver {
  private client: HyperQuoteClient;
  private tokensBySymbol = new Map<string, TokenInfo>();
  private tokensByAddress = new Map<string, TokenInfo>();
  private loaded = false;

  constructor(client: HyperQuoteClient) {
    this.client = client;
  }

  /**
   * Load tokens from the API. Caches result.
   */
  async load(): Promise<void> {
    const result = await this.client.getTokens({ tier: "all" });

    this.tokensBySymbol.clear();
    this.tokensByAddress.clear();

    for (const token of result.tokens) {
      const symbol = token.symbol.toLowerCase();
      const address = token.address.toLowerCase();

      // First match wins for symbol collisions
      if (!this.tokensBySymbol.has(symbol)) {
        this.tokensBySymbol.set(symbol, token);
      }
      this.tokensByAddress.set(address, token);
    }

    this.loaded = true;
  }

  /**
   * Resolve a token by symbol or address.
   * Loads token list if not yet cached.
   */
  async resolve(symbolOrAddress: string): Promise<TokenInfo | undefined> {
    if (!this.loaded) {
      await this.load();
    }

    if (symbolOrAddress.startsWith("0x")) {
      return this.tokensByAddress.get(symbolOrAddress.toLowerCase());
    }

    return this.tokensBySymbol.get(symbolOrAddress.toLowerCase());
  }

  /**
   * Get token by symbol (sync — requires prior load()).
   */
  getBySymbol(symbol: string): TokenInfo | undefined {
    return this.tokensBySymbol.get(symbol.toLowerCase());
  }

  /**
   * Get token by address (sync — requires prior load()).
   */
  getByAddress(address: string): TokenInfo | undefined {
    return this.tokensByAddress.get(address.toLowerCase());
  }

  /**
   * Get all cached tokens.
   */
  getAll(): TokenInfo[] {
    return Array.from(this.tokensByAddress.values());
  }
}
