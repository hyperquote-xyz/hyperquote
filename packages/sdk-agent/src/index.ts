/**
 * @hyperquote/sdk-agent — HyperQuote Agent SDK
 *
 * TypeScript SDK for programmatic interaction with HyperQuote.
 * Supports taker, maker, and monitor roles for spot RFQ.
 *
 * Quick start:
 *
 * ```typescript
 * import { TakerAgent, MakerAgent, Monitor } from "@hyperquote/sdk-agent";
 *
 * // Taker: create RFQ, wait for quotes, fill
 * const taker = new TakerAgent({ baseUrl, apiKey, rpcUrl, privateKey });
 * const result = await taker.executeSwap({ tokenIn: "USDC", tokenOut: "HYPE", amountIn: "10000000000" });
 *
 * // Maker: listen for RFQs, auto-quote
 * const maker = new MakerAgent({ baseUrl, apiKey, rpcUrl, privateKey });
 * await maker.connect();
 * maker.onRfq(async (rfq) => ({ amountIn: ..., amountOut: ... }));
 *
 * // Monitor: watch feed, query venues
 * const monitor = new Monitor({ baseUrl, apiKey });
 * await monitor.connect();
 * monitor.on("rfq.created", (event) => console.log(event));
 * ```
 */

// Core classes
export { HyperQuoteClient } from "./client.js";
export { TakerAgent } from "./taker.js";
export { MakerAgent } from "./maker.js";
export { Monitor } from "./monitor.js";

// Supporting classes
export { EventStream } from "./stream.js";
export { TokenResolver } from "./tokens.js";

// Signing & contract helpers
export {
  signSpotQuote,
  getMakerNonce,
  buildQuoteTuple,
  buildSpotQuoteJSON,
} from "./signing.js";
export {
  approveIfNeeded,
  getTokenBalance,
  fillExactIn,
  fillExactOut,
} from "./contract.js";

// Types
export type {
  HyperQuoteConfig,
  AgentConfig,
  MakerConfig,
  TokenInfo,
  SpotRFQRequest,
  SpotQuote,
  CreateRFQParams,
  CreateRFQResult,
  VenueComparisonResult,
  VenueEstimate,
  FillResult,
  LeaderboardEntry,
  LeaderboardResult,
  FeedEvent,
  FeedEventType,
  ContractInfo,
  AgentInfo,
  RegisterParams,
  RegisterResult,
  RFQVisibility,
  RFQStatus,
  QuoteResponse,
  RfqHandler,
  QuoteHandler,
  FillHandler,
  EventHandler,
} from "./types.js";

export { QuoteKind } from "./types.js";

// Errors
export {
  HyperQuoteError,
  AuthError,
  RateLimitError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  NetworkError,
  TransactionError,
  TimeoutError,
} from "./errors.js";

// Utilities
export { sleep, retry, serializeBigInts, parseBigIntField } from "./utils.js";
