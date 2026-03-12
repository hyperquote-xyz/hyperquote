/**
 * HyperQuote Agent SDK — Error Types
 */

/** Base error for all SDK errors */
export class HyperQuoteError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "HyperQuoteError";
  }
}

/** Authentication failed (invalid API key, expired, revoked) */
export class AuthError extends HyperQuoteError {
  constructor(message: string) {
    super(message, "AUTH_ERROR");
    this.name = "AuthError";
  }
}

/** Rate limit exceeded */
export class RateLimitError extends HyperQuoteError {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message, "RATE_LIMIT");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Permission denied (missing role) */
export class ForbiddenError extends HyperQuoteError {
  constructor(message: string) {
    super(message, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

/** Resource not found */
export class NotFoundError extends HyperQuoteError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

/** Invalid input parameters */
export class ValidationError extends HyperQuoteError {
  constructor(message: string) {
    super(message, "VALIDATION");
    this.name = "ValidationError";
  }
}

/** Network/connection error */
export class NetworkError extends HyperQuoteError {
  constructor(message: string) {
    super(message, "NETWORK");
    this.name = "NetworkError";
  }
}

/** Transaction failed */
export class TransactionError extends HyperQuoteError {
  public readonly txHash?: string;

  constructor(message: string, txHash?: string) {
    super(message, "TRANSACTION");
    this.name = "TransactionError";
    this.txHash = txHash;
  }
}

/** Timeout waiting for quotes or other async operation */
export class TimeoutError extends HyperQuoteError {
  constructor(message: string) {
    super(message, "TIMEOUT");
    this.name = "TimeoutError";
  }
}
