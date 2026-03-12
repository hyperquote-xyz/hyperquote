// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QuoteLib} from "../libraries/QuoteLib.sol";

/// @title IQuoteVerifier
/// @notice Interface for EIP-712 quote verification and execution in the RFQ engine.
/// @dev Implemented by OptionsEngine. Handles quote signature verification,
///      execution (collateral locking + premium transfer), and lifecycle management.
interface IQuoteVerifier {
    /// @notice Executes a signed quote, locking collateral and transferring premium.
    function execute(QuoteLib.Quote calldata quote, bytes calldata signature) external returns (uint256 positionId);

    /// @notice Cancels a specific quote by its hash. Only callable by the quote's maker.
    function cancelQuote(QuoteLib.Quote calldata quote) external;

    /// @notice Increments the caller's nonce, invalidating all prior quotes.
    function incrementNonce() external;

    /// @notice Returns the current nonce for a maker.
    function nonces(address maker) external view returns (uint256);

    /// @notice Checks whether a quote hash has been used (executed or cancelled).
    function isQuoteUsed(bytes32 quoteHash) external view returns (bool);

    /// @notice Computes the EIP-712 typed data hash for a quote.
    function hashQuote(QuoteLib.Quote calldata quote) external view returns (bytes32);
}
