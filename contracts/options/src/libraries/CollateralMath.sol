// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CollateralMath
/// @notice Arithmetic helpers for collateral calculations with cross-decimal precision.
/// @dev Strike and settlement prices are standardized at 1e18 precision.
///      Underlying (WHYPE) has 18 decimals. Collateral tokens may have 6 or 18 decimals.
///
///      General formula for "strike × quantity in collateral units":
///        result = ceilDiv(strike * quantity, 10^(18 + uDec - cDec))
///
///      Where:
///        strike   is in 1e18  (e.g. $25 = 25e18)
///        quantity is in uDec  (e.g. 1 WHYPE = 1e18)
///        result   is in cDec  (e.g. 25 USDC = 25e6)
///
///      Derivation: strike/1e18 * quantity/10^uDec = value in USD
///                  value_in_collateral = value * 10^cDec
///                  = strike * quantity * 10^cDec / (1e18 * 10^uDec)
///                  = strike * quantity / 10^(18 + uDec - cDec)
library CollateralMath {
    /// @notice Computes collateral required for a Cash-Secured Put.
    /// @param strike Strike price with 18 decimals (1e18 = $1.00).
    /// @param quantity Amount of underlying in underlying decimals.
    /// @param uDec Decimals of the underlying token.
    /// @param cDec Decimals of the collateral token.
    /// @return Collateral required in collateral token units (rounds up).
    function putCollateralRequired(uint256 strike, uint256 quantity, uint8 uDec, uint8 cDec)
        internal
        pure
        returns (uint256)
    {
        return _strikeTimesQuantity(strike, quantity, uDec, cDec);
    }

    /// @notice Computes the collateral (stablecoin) the call buyer must deliver for settlement.
    /// @param strike Strike price with 18 decimals (1e18 = $1.00).
    /// @param quantity Amount of underlying in underlying decimals.
    /// @param uDec Decimals of the underlying token.
    /// @param cDec Decimals of the collateral token.
    /// @return Stablecoin amount the call buyer must deliver (rounds up).
    function callSettlementCost(uint256 strike, uint256 quantity, uint8 uDec, uint8 cDec)
        internal
        pure
        returns (uint256)
    {
        return _strikeTimesQuantity(strike, quantity, uDec, cDec);
    }

    /// @notice Computes the notional value (strike × quantity) in collateral token units.
    /// @dev Used for keeper fee calculation. Same formula as putCollateralRequired / callSettlementCost.
    function notional(uint256 strike, uint256 quantity, uint8 uDec, uint8 cDec)
        internal
        pure
        returns (uint256)
    {
        return _strikeTimesQuantity(strike, quantity, uDec, cDec);
    }

    /// @dev Core formula: ceilDiv(strike * quantity, 10^(18 + uDec - cDec))
    function _strikeTimesQuantity(uint256 strike, uint256 quantity, uint8 uDec, uint8 cDec)
        private
        pure
        returns (uint256)
    {
        uint256 product = strike * quantity; // checked — reverts on overflow
        // exponent = 18 + uDec - cDec.  For WHYPE(18)/USDC(6): 18+18-6 = 30
        // For WHYPE(18)/USDH(18): 18+18-18 = 18
        uint256 exponent = 18 + uint256(uDec) - uint256(cDec);
        uint256 divisor = 10 ** exponent;
        return ceilDiv(product, divisor);
    }

    /// @notice Ceiling division. Returns ceil(a / b).
    /// @dev Reverts if b == 0.
    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        return ((a - 1) / b) + 1;
    }
}
