/**
 * HyperQuote Agent SDK — Contract Helpers
 *
 * Convenience functions for ERC-20 approvals and RFQ fill transactions.
 */

import { ethers } from "ethers";

// Minimal ERC-20 ABI
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Minimal RFQ fill ABI
const FILL_ABI = [
  {
    inputs: [
      {
        components: [
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
        name: "quote",
        type: "tuple",
      },
      { name: "makerSig", type: "bytes" },
      { name: "minOut", type: "uint256" },
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
        name: "quote",
        type: "tuple",
      },
      { name: "makerSig", type: "bytes" },
      { name: "maxIn", type: "uint256" },
    ],
    name: "fillExactOut",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/**
 * Check and approve ERC-20 token allowance for the RFQ contract.
 * Returns the approval tx hash if approval was needed, null otherwise.
 */
export async function approveIfNeeded(
  wallet: ethers.Wallet,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint
): Promise<string | null> {
  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  const currentAllowance: bigint = await erc20.allowance(
    wallet.address,
    spenderAddress
  );

  if (currentAllowance >= amount) {
    return null; // Already approved
  }

  // Approve max uint256 for convenience
  const tx = await erc20.approve(
    spenderAddress,
    ethers.MaxUint256
  );
  const receipt = await tx.wait();

  return receipt.hash;
}

/**
 * Get token balance.
 */
export async function getTokenBalance(
  provider: ethers.Provider,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return erc20.balanceOf(walletAddress);
}

/**
 * Fill a quote on-chain (EXACT_IN).
 *
 * @param wallet - ethers Wallet connected to provider
 * @param contractAddress - RFQ contract address
 * @param quote - Quote tuple parameters
 * @param makerSig - Maker's signature
 * @param minOut - Minimum output amount (slippage protection)
 * @returns Transaction receipt
 */
export async function fillExactIn(
  wallet: ethers.Wallet,
  contractAddress: string,
  quote: {
    kind: number;
    maker: string;
    taker: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOut: bigint;
    expiry: bigint;
    nonce: bigint;
  },
  makerSig: string,
  minOut: bigint
): Promise<ethers.TransactionReceipt> {
  const contract = new ethers.Contract(contractAddress, FILL_ABI, wallet);

  const quoteTuple = [
    quote.kind,
    quote.maker,
    quote.taker,
    quote.tokenIn,
    quote.tokenOut,
    quote.amountIn,
    quote.amountOut,
    quote.expiry,
    quote.nonce,
  ];

  const tx = await contract.fillExactIn(quoteTuple, makerSig, minOut);
  const receipt = await tx.wait();

  if (!receipt || receipt.status === 0) {
    throw new Error(`Fill transaction reverted: ${tx.hash}`);
  }

  return receipt;
}

/**
 * Fill a quote on-chain (EXACT_OUT).
 */
export async function fillExactOut(
  wallet: ethers.Wallet,
  contractAddress: string,
  quote: {
    kind: number;
    maker: string;
    taker: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    amountOut: bigint;
    expiry: bigint;
    nonce: bigint;
  },
  makerSig: string,
  maxIn: bigint
): Promise<ethers.TransactionReceipt> {
  const contract = new ethers.Contract(contractAddress, FILL_ABI, wallet);

  const quoteTuple = [
    quote.kind,
    quote.maker,
    quote.taker,
    quote.tokenIn,
    quote.tokenOut,
    quote.amountIn,
    quote.amountOut,
    quote.expiry,
    quote.nonce,
  ];

  const tx = await contract.fillExactOut(quoteTuple, makerSig, maxIn);
  const receipt = await tx.wait();

  if (!receipt || receipt.status === 0) {
    throw new Error(`Fill transaction reverted: ${tx.hash}`);
  }

  return receipt;
}
