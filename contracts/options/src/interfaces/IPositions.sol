// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPositions
/// @notice Interface for managing options positions — settlement and expiry.
/// @dev Implemented by OptionsEngine. Positions are ERC-721 NFTs minted to the buyer.
interface IPositions {
    enum PositionState {
        Active,
        Settled,
        Expired
    }

    struct Position {
        address seller;
        address buyer;
        address underlying;
        address collateral;
        bool isCall;
        uint256 strike;
        uint256 quantity;
        uint256 premium;
        uint256 expiry;
        uint256 collateralLocked;
        PositionState state;
    }

    /// @notice Settles an ITM position after expiry via physical delivery.
    function settle(uint256 positionId) external;

    /// @notice Releases collateral for an OTM or unexercised position after the settlement window.
    function expirePosition(uint256 positionId) external;

    /// @notice Returns the full position data for a given position ID.
    function getPosition(uint256 positionId) external view returns (Position memory);
}
