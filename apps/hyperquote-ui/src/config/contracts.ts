/**
 * HyperQuote Contract Configuration
 * Contains ABI and contract address for the RFQ settlement contract
 */

// Spot RFQ contract address from environment
export const RFQ_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_SPOT_RFQ_CONTRACT_ADDRESS || "0x0") as `0x${string}`;

// EIP-712 domain for the HyperEvmRfq contract.
// Must match the contract's EIP712("HyperQuote", "1") constructor args.
export const RFQ_EIP712_DOMAIN = {
  name: "HyperQuote" as const,
  version: "1" as const,
};

// EIP-712 typed data types for the Quote struct.
// Field names and types must exactly match the contract's QUOTE_TYPEHASH.
export const RFQ_QUOTE_TYPES = {
  Quote: [
    { name: "kind", type: "uint8" },
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOut", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// Contract ABI (only the functions we need)
export const RFQ_ABI = [
  // View functions
  {
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feePips",
    outputs: [{ internalType: "uint32", name: "", type: "uint32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feeRecipient",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "makerNonce",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "quoteUsed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "tokenDenied",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "enum HyperEvmRfq.QuoteKind", name: "kind", type: "uint8" },
          { internalType: "address", name: "maker", type: "address" },
          { internalType: "address", name: "taker", type: "address" },
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          { internalType: "uint256", name: "amountOut", type: "uint256" },
          { internalType: "uint256", name: "expiry", type: "uint256" },
          { internalType: "uint256", name: "nonce", type: "uint256" },
        ],
        internalType: "struct HyperEvmRfq.Quote",
        name: "quote",
        type: "tuple",
      },
    ],
    name: "getQuoteHash",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  // Write functions
  {
    inputs: [
      {
        components: [
          { internalType: "enum HyperEvmRfq.QuoteKind", name: "kind", type: "uint8" },
          { internalType: "address", name: "maker", type: "address" },
          { internalType: "address", name: "taker", type: "address" },
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          { internalType: "uint256", name: "amountOut", type: "uint256" },
          { internalType: "uint256", name: "expiry", type: "uint256" },
          { internalType: "uint256", name: "nonce", type: "uint256" },
        ],
        internalType: "struct HyperEvmRfq.Quote",
        name: "quote",
        type: "tuple",
      },
      { internalType: "bytes", name: "makerSig", type: "bytes" },
      { internalType: "uint256", name: "minOut", type: "uint256" },
    ],
    name: "fillExactIn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "enum HyperEvmRfq.QuoteKind", name: "kind", type: "uint8" },
          { internalType: "address", name: "maker", type: "address" },
          { internalType: "address", name: "taker", type: "address" },
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          { internalType: "uint256", name: "amountOut", type: "uint256" },
          { internalType: "uint256", name: "expiry", type: "uint256" },
          { internalType: "uint256", name: "nonce", type: "uint256" },
        ],
        internalType: "struct HyperEvmRfq.Quote",
        name: "quote",
        type: "tuple",
      },
      { internalType: "bytes", name: "makerSig", type: "bytes" },
      { internalType: "uint256", name: "maxIn", type: "uint256" },
    ],
    name: "fillExactOut",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "cancelAllQuotes",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "quoteHash", type: "bytes32" },
      { indexed: true, internalType: "address", name: "maker", type: "address" },
      { indexed: true, internalType: "address", name: "taker", type: "address" },
      { indexed: false, internalType: "address", name: "tokenIn", type: "address" },
      { indexed: false, internalType: "address", name: "tokenOut", type: "address" },
      { indexed: false, internalType: "uint256", name: "amountIn", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "amountOut", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "feeAmountIn", type: "uint256" },
    ],
    name: "QuoteFilled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "maker", type: "address" },
      { indexed: false, internalType: "uint256", name: "newNonce", type: "uint256" },
    ],
    name: "MakerNonceIncremented",
    type: "event",
  },
  // Custom errors — required so viem can decode reverts during fill simulation
  // and surface a friendly message (see getErrorMessage).
  { type: "error", name: "InvalidMaker", inputs: [] },
  { type: "error", name: "InvalidTokenIn", inputs: [] },
  { type: "error", name: "InvalidTokenOut", inputs: [] },
  { type: "error", name: "InvalidAmountIn", inputs: [] },
  { type: "error", name: "InvalidAmountOut", inputs: [] },
  { type: "error", name: "QuoteExpired", inputs: [] },
  { type: "error", name: "InvalidNonce", inputs: [] },
  { type: "error", name: "QuoteAlreadyUsed", inputs: [] },
  { type: "error", name: "InvalidSignature", inputs: [] },
  { type: "error", name: "TakerNotAllowed", inputs: [] },
  { type: "error", name: "SameTokenPair", inputs: [] },
  { type: "error", name: "TokenDeniedError", inputs: [] },
  { type: "error", name: "MinOutNotMet", inputs: [] },
  { type: "error", name: "MaxInExceeded", inputs: [] },
  { type: "error", name: "WrongQuoteKind", inputs: [] },
  // OpenZeppelin ECDSA / ERC20 errors that can surface via the fill path
  { type: "error", name: "ECDSAInvalidSignature", inputs: [] },
  { type: "error", name: "ERC20InsufficientBalance", inputs: [
    { name: "sender", type: "address" }, { name: "balance", type: "uint256" }, { name: "needed", type: "uint256" } ] },
  { type: "error", name: "ERC20InsufficientAllowance", inputs: [
    { name: "spender", type: "address" }, { name: "allowance", type: "uint256" }, { name: "needed", type: "uint256" } ] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [ { name: "token", type: "address" } ] },
] as const;

// ERC20 ABI (for approvals)
export const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
