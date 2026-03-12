/**
 * HyperQuote Agent SDK — TakerAgent
 *
 * Full taker lifecycle: create RFQ → wait for quotes → select best → fill on-chain.
 *
 * Usage:
 * ```typescript
 * const taker = new TakerAgent({
 *   baseUrl: "https://app.hyperquote.io",
 *   apiKey: "hq_live_...",
 *   rpcUrl: "https://rpc.hyperliquid.xyz/evm",
 *   privateKey: "0x...",
 * });
 *
 * const result = await taker.executeSwap({
 *   tokenIn: "USDC",
 *   tokenOut: "HYPE",
 *   amountIn: "10000000000", // 10k USDC
 *   ttlSeconds: 30,
 * });
 * ```
 */

import { ethers } from "ethers";
import { HyperQuoteClient } from "./client.js";
import { EventStream } from "./stream.js";
import { TokenResolver } from "./tokens.js";
import { approveIfNeeded, fillExactIn, fillExactOut } from "./contract.js";
import type {
  AgentConfig,
  SpotQuote,
  CreateRFQParams,
  CreateRFQResult,
  QuoteKind,
  FillResult,
  ContractInfo,
} from "./types.js";
import { TimeoutError, ValidationError, TransactionError } from "./errors.js";
import { sleep } from "./utils.js";

export interface ExecuteSwapParams {
  /** Input token (address or symbol) */
  tokenIn: string;
  /** Output token (address or symbol) */
  tokenOut: string;
  /** Amount in (BigInt string or bigint, for EXACT_IN) */
  amountIn?: string | bigint;
  /** Amount out (BigInt string or bigint, for EXACT_OUT) */
  amountOut?: string | bigint;
  /** Quote kind (default: EXACT_IN) */
  kind?: QuoteKind;
  /** TTL in seconds (default: 30) */
  ttlSeconds?: number;
  /** Minimum number of quotes to wait for (default: 1) */
  minQuotes?: number;
  /** Timeout in ms to wait for quotes (default: 25000) */
  timeoutMs?: number;
  /** Slippage tolerance in bps for minOut (default: 50 = 0.5%) */
  slippageBps?: number;
  /** Visibility (default: "public") */
  visibility?: "public" | "private";
}

export class TakerAgent {
  readonly client: HyperQuoteClient;
  readonly tokens: TokenResolver;
  private wallet: ethers.Wallet;
  private provider: ethers.JsonRpcProvider;
  private stream: EventStream | null = null;
  private contractInfo: ContractInfo | null = null;

  constructor(config: AgentConfig) {
    this.client = new HyperQuoteClient(config);
    this.tokens = new TokenResolver(this.client);

    const rpcUrl = config.rpcUrl ?? "https://rpc.hyperliquid.xyz/evm";
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
  }

  /**
   * Connect to the SSE feed for live quote monitoring.
   */
  async connect(): Promise<void> {
    this.stream = new EventStream({
      url: `${this.client.getBaseUrl()}/api/v1/agent/feed/stream`,
      apiKey: this.client.getApiKey(),
    });
    await this.stream.connect();
  }

  /**
   * Disconnect from the SSE feed.
   */
  disconnect(): void {
    this.stream?.disconnect();
    this.stream = null;
  }

  /**
   * Create an RFQ via the Agent API.
   */
  async createRfq(params: CreateRFQParams): Promise<CreateRFQResult> {
    return this.client.createRfq(params);
  }

  /**
   * Wait for quotes on an RFQ by polling.
   */
  async waitForQuotes(
    rfqId: string,
    opts: {
      minQuotes?: number;
      timeoutMs?: number;
      pollIntervalMs?: number;
      shareToken?: string;
    } = {}
  ): Promise<SpotQuote[]> {
    const {
      minQuotes = 1,
      timeoutMs = 25_000,
      pollIntervalMs = 1_000,
      shareToken,
    } = opts;

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await this.client.getQuotes(rfqId, shareToken);

      if (result.quotes.length >= minQuotes) {
        return result.quotes;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      await sleep(Math.min(pollIntervalMs, remaining));
    }

    // Return whatever we have (may be empty)
    const final = await this.client.getQuotes(rfqId);
    if (final.quotes.length === 0) {
      throw new TimeoutError(
        `No quotes received for RFQ ${rfqId} within ${timeoutMs}ms`
      );
    }
    return final.quotes;
  }

  /**
   * Select the best quote from a list (highest amountOut for EXACT_IN).
   */
  selectBestQuote(
    quotes: SpotQuote[],
    kind: QuoteKind | number = 0
  ): SpotQuote {
    if (quotes.length === 0) {
      throw new ValidationError("No quotes to select from");
    }

    if (kind === 0) {
      // EXACT_IN: highest amountOut wins
      return quotes.reduce((best, q) =>
        BigInt(q.amountOut) > BigInt(best.amountOut) ? q : best
      );
    } else {
      // EXACT_OUT: lowest amountIn wins
      return quotes.reduce((best, q) =>
        BigInt(q.amountIn) < BigInt(best.amountIn) ? q : best
      );
    }
  }

  /**
   * Approve token if needed and fill a quote on-chain.
   */
  async fillQuote(
    quote: SpotQuote,
    opts: { slippageBps?: number } = {}
  ): Promise<FillResult> {
    const { slippageBps = 50 } = opts;

    // Load contract info if needed
    if (!this.contractInfo) {
      this.contractInfo = await this.client.getContractInfo();
    }

    const contractAddress = this.contractInfo.rfq.address;

    // Approve tokenIn for the RFQ contract
    const tokenInAddr = quote.tokenIn;
    const amountIn = BigInt(quote.amountIn);

    await approveIfNeeded(
      this.wallet,
      tokenInAddr,
      contractAddress,
      amountIn
    );

    // Build fill params
    const quoteTuple = {
      kind: Number(quote.kind),
      maker: quote.maker,
      taker: quote.taker,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: BigInt(quote.amountIn),
      amountOut: BigInt(quote.amountOut),
      expiry: BigInt(quote.expiry),
      nonce: BigInt(quote.nonce),
    };

    let receipt: ethers.TransactionReceipt;

    if (quote.kind === 0) {
      // EXACT_IN: minOut = amountOut * (1 - slippage)
      const minOut =
        (BigInt(quote.amountOut) * BigInt(10000 - slippageBps)) / 10000n;

      receipt = await fillExactIn(
        this.wallet,
        contractAddress,
        quoteTuple,
        quote.signature,
        minOut
      );
    } else {
      // EXACT_OUT: maxIn = amountIn * (1 + slippage)
      const maxIn =
        (BigInt(quote.amountIn) * BigInt(10000 + slippageBps)) / 10000n;

      receipt = await fillExactOut(
        this.wallet,
        contractAddress,
        quoteTuple,
        quote.signature,
        maxIn
      );
    }

    // Notify server of fill (with full details for points computation)
    try {
      await this.client.markFilled(quote.requestId, receipt.hash, {
        maker: quote.maker,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        amountInUsd: 0, // Caller can enrich with USD price if available
      });
    } catch {
      // Non-critical — fill is already on-chain
    }

    return {
      txHash: receipt.hash,
      rfqId: quote.requestId,
      blockNumber: receipt.blockNumber,
    };
  }

  /**
   * Execute a full swap in one call:
   * Create RFQ → Wait for quotes → Select best → Approve → Fill
   */
  async executeSwap(params: ExecuteSwapParams): Promise<FillResult> {
    const {
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      kind = 0,
      ttlSeconds = 30,
      minQuotes = 1,
      timeoutMs = 25_000,
      slippageBps = 50,
      visibility = "public",
    } = params;

    // 1. Create RFQ
    const rfq = await this.createRfq({
      tokenIn,
      tokenOut,
      amountIn: amountIn?.toString(),
      amountOut: amountOut?.toString(),
      kind,
      ttlSeconds,
      visibility,
    });

    // 2. Wait for quotes
    const quotes = await this.waitForQuotes(rfq.rfqId, {
      minQuotes,
      timeoutMs,
    });

    // 3. Select best quote
    const best = this.selectBestQuote(quotes, kind);

    // 4. Fill
    const result = await this.fillQuote(best, { slippageBps });

    return result;
  }

  /**
   * Get the taker's wallet address.
   */
  getAddress(): string {
    return this.wallet.address;
  }
}
