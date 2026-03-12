// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISettlementOracle
/// @notice Interface for the settlement price oracle used at option expiry.
/// @dev Designed as a swappable interface. V1 uses SettlementPublisher (commit-reveal).
///      Future versions can swap in a HyperCore precompile reader without changing downstream contracts.
///      Settlement price is denominated in USD with 18 decimal places (1e18 = $1.00).
interface ISettlementOracle {
    /// @notice Returns the settlement price for an asset at a given expiry timestamp.
    /// @param asset The address of the underlying asset (e.g., WHYPE).
    /// @param expiry The expiry timestamp for which to retrieve the settlement price.
    /// @return price The settlement price in USD with 18 decimals (1e18 = $1.00).
    /// @return settled Whether the price has been finalized for this expiry.
    function getSettlementPrice(address asset, uint256 expiry)
        external
        view
        returns (uint256 price, bool settled);

    /// @notice Checks whether a settlement price is available for a given asset/expiry.
    /// @param asset The address of the underlying asset.
    /// @param expiry The expiry timestamp.
    /// @return True if a settlement price has been finalized.
    function hasPriceFor(address asset, uint256 expiry) external view returns (bool);

    /// @notice Emitted when a settlement price is finalized.
    event SettlementPricePublished(address indexed asset, uint256 indexed expiry, uint256 price, address publisher);
}
