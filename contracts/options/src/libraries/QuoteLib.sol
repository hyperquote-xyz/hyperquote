// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuoteLib
/// @notice EIP-712 typed data hashing for RFQ quotes.
library QuoteLib {
    struct Quote {
        address maker;
        address taker; // address(0) = open to anyone
        address underlying;
        address collateral;
        bool isCall; // true = Covered Call, false = Cash-Secured Put
        bool isMakerSeller; // V1: must be false (taker=seller, maker=buyer)
        uint256 strike; // USD price with 18 decimals (1e18 = $1)
        uint256 quantity; // underlying token amount (underlying decimals)
        uint256 premium; // collateral token amount
        uint256 expiry; // option expiry timestamp (must be 08:00 UTC)
        uint256 deadline; // quote validity deadline
        uint256 nonce; // maker nonce for replay protection
    }

    bytes32 internal constant QUOTE_TYPEHASH = keccak256(
        "Quote(address maker,address taker,address underlying,address collateral,bool isCall,bool isMakerSeller,uint256 strike,uint256 quantity,uint256 premium,uint256 expiry,uint256 deadline,uint256 nonce)"
    );

    /// @notice Computes the EIP-712 struct hash for a Quote.
    function hash(Quote calldata q) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                q.maker,
                q.taker,
                q.underlying,
                q.collateral,
                q.isCall,
                q.isMakerSeller,
                q.strike,
                q.quantity,
                q.premium,
                q.expiry,
                q.deadline,
                q.nonce
            )
        );
    }
}
