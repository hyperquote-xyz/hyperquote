import { Contract, JsonRpcProvider } from "ethers";

const ENGINE_ABI_NONCE = [
  "function nonces(address) view returns (uint256)",
  "function incrementNonce() external",
];

/**
 * NonceManager tracks the maker's on-chain nonce and provides
 * monotonically increasing nonces for quote signing.
 *
 * Strategy:
 * - On init, read on-chain nonce via engine.nonces(maker)
 * - Each quote gets the current local nonce
 * - Local nonce increments after each quote
 * - If a quote is cancelled or expires, the nonce is NOT decremented
 *   (nonces are monotonic; cancellation is done via usedQuotes or incrementNonce)
 *
 * Cancel strategy:
 * - Offchain: relay can mark a quote as withdrawn
 * - Onchain: call engine.incrementNonce() to bulk-invalidate all quotes
 *   with nonce < newNonce, or engine.cancelQuote(quote) for a single quote.
 */
export class NonceManager {
  private localNonce: bigint = 0n;
  private initialized = false;

  constructor(
    private readonly makerAddress: string,
    private readonly engineAddress: string,
    private readonly provider: JsonRpcProvider,
  ) {}

  /**
   * Initialize by reading the current on-chain nonce.
   */
  async init(): Promise<void> {
    const engine = new Contract(this.engineAddress, ENGINE_ABI_NONCE, this.provider);
    const onChainNonce: bigint = await engine.nonces(this.makerAddress);
    this.localNonce = onChainNonce;
    this.initialized = true;
  }

  /**
   * Get the next nonce for a new quote and advance the counter.
   */
  nextNonce(): bigint {
    if (!this.initialized) {
      throw new Error("NonceManager not initialized. Call init() first.");
    }
    const n = this.localNonce;
    this.localNonce += 1n;
    return n;
  }

  /**
   * Peek at the current nonce without advancing.
   */
  currentNonce(): bigint {
    return this.localNonce;
  }

  /**
   * Resync with on-chain state (e.g., after an incrementNonce tx).
   */
  async resync(): Promise<void> {
    await this.init();
  }
}
