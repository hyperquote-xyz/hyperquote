import { describe, it, expect } from "vitest";
import { TypedDataEncoder, keccak256, AbiCoder, solidityPacked, Wallet } from "ethers";
import { Quote } from "../src/types.js";
import { buildDomain, QUOTE_TYPES, quoteToTypedDataValue } from "../src/eip712.js";
import { signQuote } from "../src/signQuote.js";
import { verifyQuoteSignature } from "../src/verifyQuote.js";

/**
 * Canonical test vector — must match the Solidity EIP712CrossCheck test exactly.
 *
 * Solidity test vectors (from `forge test --match-contract EIP712CrossCheck -vv`):
 *   QUOTE_TYPEHASH:   0xa658686ca3f902cf1315142c0a4df619d29c35f788c2a46c2c1dbcc66319d88a
 *   Struct hash:      0xf586aeaa8533a62ea9b68dfba2d8e28330a14e4e2e5a395f4d82f35332dda319
 *   Domain separator: 0x64f51da9639c393a7b73866db9f4e32fb43540402f8114e15b5416230171896e
 *   Full digest:      0x5393cf8faedae66ca0225391e477819c8a913b6af6a121d2b5ba5bf4308a71ba
 *   Engine address:   0xCCec344d9D8246C8d06d99CCEFc856bFa17e0526
 */

// The exact same values as in the Solidity test
const TEST_QUOTE: Quote = {
  maker: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  taker: "0x0000000000000000000000000000000000000000",
  underlying: "0x0000000000000000000000000000000000000001",
  collateral: "0x0000000000000000000000000000000000000002",
  isCall: false,
  isMakerSeller: false,
  strike: 25000000000000000000n, // 25e18
  quantity: 1000000000000000000n, // 1e18
  premium: 1000000n, // 1e6
  expiry: 1700121600n,
  deadline: 1700035200n,
  nonce: 0n,
};

// Foundry's deterministic engine address for this test setup
const ENGINE_ADDRESS = "0xCCec344d9D8246C8d06d99CCEFc856bFa17e0526";
const CHAIN_ID = 31337;

// Expected values from Solidity
const EXPECTED_TYPEHASH = "0xa658686ca3f902cf1315142c0a4df619d29c35f788c2a46c2c1dbcc66319d88a";
const EXPECTED_STRUCT_HASH = "0xf586aeaa8533a62ea9b68dfba2d8e28330a14e4e2e5a395f4d82f35332dda319";
const EXPECTED_DOMAIN_SEP = "0x64f51da9639c393a7b73866db9f4e32fb43540402f8114e15b5416230171896e";
const EXPECTED_DIGEST = "0x5393cf8faedae66ca0225391e477819c8a913b6af6a121d2b5ba5bf4308a71ba";

describe("EIP-712 Cross-Verification with Solidity", () => {
  it("computes the correct QUOTE_TYPEHASH", () => {
    const typeString =
      "Quote(address maker,address taker,address underlying,address collateral,bool isCall,bool isMakerSeller,uint256 strike,uint256 quantity,uint256 premium,uint256 expiry,uint256 deadline,uint256 nonce)";
    const typehash = keccak256(Buffer.from(typeString));
    expect(typehash).toBe(EXPECTED_TYPEHASH);
  });

  it("computes the correct struct hash", () => {
    const value = quoteToTypedDataValue(TEST_QUOTE);
    const structHash = TypedDataEncoder.hashStruct("Quote", QUOTE_TYPES, value);
    expect(structHash).toBe(EXPECTED_STRUCT_HASH);
  });

  it("computes the correct domain separator", () => {
    const domain = buildDomain(CHAIN_ID, ENGINE_ADDRESS);
    const domainSep = TypedDataEncoder.hashDomain(domain);
    expect(domainSep).toBe(EXPECTED_DOMAIN_SEP);
  });

  it("computes the correct full EIP-712 digest", () => {
    const domain = buildDomain(CHAIN_ID, ENGINE_ADDRESS);
    const value = quoteToTypedDataValue(TEST_QUOTE);
    const digest = TypedDataEncoder.hash(domain, QUOTE_TYPES, value);
    expect(digest).toBe(EXPECTED_DIGEST);
  });

  it("sign + verify round-trip succeeds", async () => {
    // Use anvil account 1 private key (matches TEST_QUOTE.maker)
    const privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const wallet = new Wallet(privateKey);

    // Verify the wallet address matches the maker
    expect(wallet.address.toLowerCase()).toBe(TEST_QUOTE.maker.toLowerCase());

    // Sign the quote
    const signature = await signQuote(wallet, TEST_QUOTE, CHAIN_ID, ENGINE_ADDRESS);
    expect(signature).toBeTruthy();
    expect(signature.length).toBe(132); // 0x + 65 bytes hex

    // Verify the signature
    const valid = verifyQuoteSignature(TEST_QUOTE, signature, CHAIN_ID, ENGINE_ADDRESS);
    expect(valid).toBe(true);

    // Verify with wrong maker fails
    const wrongQuote = { ...TEST_QUOTE, maker: "0x0000000000000000000000000000000000000099" };
    const invalidCheck = verifyQuoteSignature(wrongQuote, signature, CHAIN_ID, ENGINE_ADDRESS);
    expect(invalidCheck).toBe(false);
  });
});

describe("QUOTE_TYPES field order matches Solidity", () => {
  it("has exactly 12 fields in the correct order", () => {
    const fields = QUOTE_TYPES.Quote;
    expect(fields.length).toBe(12);

    const expectedOrder = [
      "maker",
      "taker",
      "underlying",
      "collateral",
      "isCall",
      "isMakerSeller",
      "strike",
      "quantity",
      "premium",
      "expiry",
      "deadline",
      "nonce",
    ];

    fields.forEach((f, i) => {
      expect(f.name).toBe(expectedOrder[i]);
    });
  });

  it("field types match Solidity struct", () => {
    const fields = QUOTE_TYPES.Quote;
    const expectedTypes = [
      "address",
      "address",
      "address",
      "address",
      "bool",
      "bool",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
    ];

    fields.forEach((f, i) => {
      expect(f.type).toBe(expectedTypes[i]);
    });
  });
});
