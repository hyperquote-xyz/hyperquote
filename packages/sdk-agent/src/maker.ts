/**
 * HyperQuote Agent SDK — MakerAgent
 *
 * Auto-quoting agent that listens for RFQs and submits signed quotes.
 *
 * Usage:
 * ```typescript
 * const maker = new MakerAgent({
 *   baseUrl: "https://app.hyperquote.io",
 *   apiKey: "hq_live_...",
 *   rpcUrl: "https://rpc.hyperliquid.xyz/evm",
 *   privateKey: "0x...",
 * });
 *
 * await maker.connect();
 * maker.onRfq(async (rfq) => {
 *   const price = await myPricingEngine.getPrice(rfq.tokenIn, rfq.tokenOut);
 *   if (!price) return null; // Skip this RFQ
 *   return {
 *     amountIn: BigInt(rfq.amountIn!),
 *     amountOut: BigInt(Math.floor(Number(rfq.amountIn!) * price)),
 *   };
 * });
 * ```
 */

import { ethers } from "ethers";
import { HyperQuoteClient } from "./client.js";
import { EventStream } from "./stream.js";
import { TokenResolver } from "./tokens.js";
import { signSpotQuote, getMakerNonce, buildSpotQuoteJSON } from "./signing.js";
import type {
  MakerConfig,
  SpotRFQRequest,
  QuoteResponse,
  ContractInfo,
} from "./types.js";
import { HyperQuoteError } from "./errors.js";

type PricingCallback = (
  rfq: SpotRFQRequest
) => Promise<QuoteResponse | null>;

export class MakerAgent {
  readonly client: HyperQuoteClient;
  readonly tokens: TokenResolver;
  private wallet: ethers.Wallet;
  private provider: ethers.JsonRpcProvider;
  private stream: EventStream | null = null;
  private contractInfo: ContractInfo | null = null;
  private pricingCallback: PricingCallback | null = null;
  private readonly config: MakerConfig;

  constructor(config: MakerConfig) {
    this.config = config;
    this.client = new HyperQuoteClient(config);
    this.tokens = new TokenResolver(this.client);

    const rpcUrl = config.rpcUrl ?? "https://rpc.hyperliquid.xyz/evm";
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
  }

  /**
   * Connect to the feed and start listening for RFQs.
   */
  async connect(): Promise<void> {
    // Load contract info
    this.contractInfo = await this.client.getContractInfo();

    // Start SSE stream
    this.stream = new EventStream({
      url: `${this.client.getBaseUrl()}/api/v1/agent/feed/stream`,
      apiKey: this.client.getApiKey(),
    });

    // Listen for new RFQs
    this.stream.on("rfq.created", async (event) => {
      if (!this.pricingCallback) return;

      const rfq = event.data as SpotRFQRequest;
      if (!rfq || !rfq.id) return;

      try {
        await this.handleRfq(rfq);
      } catch (err) {
        console.error(
          `[MakerAgent] Error handling RFQ ${rfq.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    });

    await this.stream.connect();
  }

  /**
   * Disconnect from the feed.
   */
  disconnect(): void {
    this.stream?.disconnect();
    this.stream = null;
  }

  /**
   * Register a pricing callback. Called for each new RFQ.
   * Return null to skip the RFQ, or { amountIn, amountOut } to quote.
   */
  onRfq(callback: PricingCallback): void {
    this.pricingCallback = callback;
  }

  /**
   * Get the maker's current nonce from the contract.
   */
  async getNonce(): Promise<bigint> {
    if (!this.contractInfo) {
      this.contractInfo = await this.client.getContractInfo();
    }
    return getMakerNonce(
      this.provider,
      this.contractInfo.rfq.address,
      this.wallet.address
    );
  }

  /**
   * Manually submit a signed quote.
   */
  async submitQuote(params: {
    rfqId: string;
    kind: number;
    taker: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOut: bigint;
    expiry: number;
    nonce?: bigint;
    shareToken?: string;
  }): Promise<{ accepted: boolean; rfqId: string }> {
    if (!this.contractInfo) {
      this.contractInfo = await this.client.getContractInfo();
    }

    // Get nonce if not provided
    const nonce = params.nonce ?? (await this.getNonce());

    // Sign the quote
    const signature = await signSpotQuote(
      this.wallet,
      {
        kind: params.kind,
        maker: this.wallet.address,
        taker: params.taker,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: params.amountOut,
        expiry: params.expiry,
        nonce,
      },
      this.contractInfo.rfq.address
    );

    // Build quote JSON
    const quoteJSON = buildSpotQuoteJSON({
      kind: params.kind,
      maker: this.wallet.address,
      taker: params.taker,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOut: params.amountOut,
      expiry: params.expiry,
      nonce,
      requestId: params.rfqId,
      signature,
    });

    // Submit via API
    return this.client.submitQuote({
      rfqId: params.rfqId,
      kind: quoteJSON.kind,
      maker: quoteJSON.maker,
      taker: quoteJSON.taker,
      tokenIn: quoteJSON.tokenIn,
      tokenOut: quoteJSON.tokenOut,
      amountIn: quoteJSON.amountIn,
      amountOut: quoteJSON.amountOut,
      expiry: quoteJSON.expiry,
      nonce: quoteJSON.nonce,
      signature: quoteJSON.signature,
      shareToken: params.shareToken,
    });
  }

  /**
   * Get the maker's wallet address.
   */
  getAddress(): string {
    return this.wallet.address;
  }

  // ── Internal ──

  private async handleRfq(rfq: SpotRFQRequest): Promise<void> {
    if (!this.pricingCallback || !this.contractInfo) return;

    // Call the user's pricing callback
    const response = await this.pricingCallback(rfq);
    if (!response) return; // Skip this RFQ

    // Compute quote expiry (use RFQ expiry or 60s from now, whichever is sooner)
    const now = Math.floor(Date.now() / 1000);
    const quoteExpiry = Math.min(rfq.expiry, now + 60);

    // Get token addresses from the RFQ
    const tokenIn = rfq.tokenIn.address;
    const tokenOut = rfq.tokenOut.address;

    try {
      await this.submitQuote({
        rfqId: rfq.id,
        kind: rfq.kind,
        taker: rfq.taker,
        tokenIn,
        tokenOut,
        amountIn: response.amountIn,
        amountOut: response.amountOut,
        expiry: quoteExpiry,
      });
    } catch (err) {
      if (err instanceof HyperQuoteError) {
        console.warn(
          `[MakerAgent] Quote rejected for ${rfq.id}: ${err.message}`
        );
      } else {
        throw err;
      }
    }
  }
}
