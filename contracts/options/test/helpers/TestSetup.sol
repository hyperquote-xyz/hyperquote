// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OptionsEngine} from "../../contracts/OptionsEngine.sol";
import {SettlementPublisher} from "../../contracts/SettlementPublisher.sol";
import {QuoteLib} from "../../contracts/libraries/QuoteLib.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Shared test setup for HyperQuote Options tests.
/// @dev V1 role convention: maker = buyer (signs quotes), taker = seller (executes, locks collateral).
///      Strike and settlement prices use 18 decimals (1e18 = $1.00).
abstract contract TestSetup is Test {
    OptionsEngine public engine;
    SettlementPublisher public oracle;
    MockERC20 public whype; // underlying (18 decimals)
    MockERC20 public usdc; // collateral (6 decimals)
    MockERC20 public usdh; // collateral (6 decimals)
    MockERC20 public usdh18; // collateral (18 decimals) — for cross-decimal tests

    address public owner = address(0xAA);
    address public publisher = address(0xBB);

    // Maker: signs quotes — is the BUYER in V1
    uint256 public makerPk = 0xA11CE;
    address public maker = vm.addr(0xA11CE);

    // Taker: executes quotes — is the SELLER in V1
    address public taker = address(0xCAFE);

    // Random third party (keeper / alice)
    address public alice = address(0xD00D);

    // Standard expiry: next 08:00 UTC at least 24h away
    uint256 public standardExpiry;

    function setUp() public virtual {
        // Deploy tokens
        whype = new MockERC20("Wrapped HYPE", "WHYPE", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdh = new MockERC20("Hyperliquid USD", "USDH", 6);
        usdh18 = new MockERC20("Hyperliquid USD 18", "USDH18", 18);

        // Deploy oracle
        vm.prank(owner);
        oracle = new SettlementPublisher(owner);

        // Deploy engine
        vm.prank(owner);
        engine = new OptionsEngine(owner, address(oracle));

        // Configure allowed tokens
        vm.startPrank(owner);
        engine.setAllowedCollateral(address(usdc), true);
        engine.setAllowedCollateral(address(usdh), true);
        engine.setAllowedCollateral(address(usdh18), true);
        engine.setAllowedUnderlying(address(whype), true);
        oracle.addPublisher(publisher);
        // Keeper fee defaults: 10 bps (set in constructor), maxKeeperFee = 5 units per collateral
        engine.setMaxKeeperFee(address(usdc), 5e6); // 5 USDC
        engine.setMaxKeeperFee(address(usdh), 5e6); // 5 USDH
        engine.setMaxKeeperFee(address(usdh18), 5e18); // 5 USDH18
        vm.stopPrank();

        // Compute standard expiry: next 08:00 UTC that is at least 25h away
        vm.warp(1_700_000_000); // Nov 14, 2023 ~22:13 UTC
        standardExpiry = _nextExpiry(block.timestamp + 25 hours);

        // Mint tokens to maker (buyer) and taker (seller)
        whype.mint(maker, 1000 ether);
        whype.mint(taker, 1000 ether);
        whype.mint(alice, 1000 ether);
        usdc.mint(maker, 1_000_000e6);
        usdc.mint(taker, 1_000_000e6);
        usdc.mint(alice, 1_000_000e6);
        usdh.mint(maker, 1_000_000e6);
        usdh.mint(taker, 1_000_000e6);
        usdh18.mint(maker, 1_000_000e18);
        usdh18.mint(taker, 1_000_000e18);

        // Approve engine for all parties
        vm.startPrank(maker);
        whype.approve(address(engine), type(uint256).max);
        usdc.approve(address(engine), type(uint256).max);
        usdh.approve(address(engine), type(uint256).max);
        usdh18.approve(address(engine), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(taker);
        whype.approve(address(engine), type(uint256).max);
        usdc.approve(address(engine), type(uint256).max);
        usdh.approve(address(engine), type(uint256).max);
        usdh18.approve(address(engine), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(alice);
        whype.approve(address(engine), type(uint256).max);
        usdc.approve(address(engine), type(uint256).max);
        usdh.approve(address(engine), type(uint256).max);
        usdh18.approve(address(engine), type(uint256).max);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    /// @dev Compute the next 08:00 UTC timestamp on or after `after`.
    function _nextExpiry(uint256 after_) internal pure returns (uint256) {
        uint256 dayStart = (after_ / 86400) * 86400;
        uint256 candidate = dayStart + 28800; // 08:00 UTC that day
        if (candidate <= after_) {
            candidate += 86400; // next day
        }
        return candidate;
    }

    /// @dev Build a standard Cash-Secured Put quote.
    ///      V1: isMakerSeller=false → maker=buyer, taker=seller.
    ///      Strike is 18 decimals (1e18 = $1). Premium is in collateral decimals.
    function _buildCSPQuote(uint256 strike, uint256 quantity, uint256 premium)
        internal
        view
        returns (QuoteLib.Quote memory)
    {
        return QuoteLib.Quote({
            maker: maker,
            taker: address(0), // open
            underlying: address(whype),
            collateral: address(usdc),
            isCall: false,
            isMakerSeller: false,
            strike: strike,
            quantity: quantity,
            premium: premium,
            expiry: standardExpiry,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });
    }

    /// @dev Build a standard Covered Call quote.
    ///      V1: isMakerSeller=false → maker=buyer, taker=seller.
    function _buildCCQuote(uint256 strike, uint256 quantity, uint256 premium)
        internal
        view
        returns (QuoteLib.Quote memory)
    {
        return QuoteLib.Quote({
            maker: maker,
            taker: address(0),
            underlying: address(whype),
            collateral: address(usdc),
            isCall: true,
            isMakerSeller: false,
            strike: strike,
            quantity: quantity,
            premium: premium,
            expiry: standardExpiry,
            deadline: block.timestamp + 1 hours,
            nonce: 0
        });
    }

    /// @dev Sign a quote with the maker's private key via EIP-712.
    function _signQuote(QuoteLib.Quote memory quote) internal view returns (bytes memory) {
        bytes32 structHash = _hashQuoteMemory(quote);
        bytes32 digest = _toTypedDataHash(engine.domainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Hash a Quote from memory (not calldata).
    function _hashQuoteMemory(QuoteLib.Quote memory q) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QuoteLib.QUOTE_TYPEHASH,
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

    /// @dev Construct EIP-712 typed data hash.
    function _toTypedDataHash(bytes32 domainSep, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    /// @dev Execute a quote as taker and return the positionId.
    function _executeQuote(QuoteLib.Quote memory quote) internal returns (uint256) {
        bytes memory sig = _signQuote(quote);
        vm.prank(taker);
        return engine.execute(
            QuoteLib.Quote({
                maker: quote.maker,
                taker: quote.taker,
                underlying: quote.underlying,
                collateral: quote.collateral,
                isCall: quote.isCall,
                isMakerSeller: quote.isMakerSeller,
                strike: quote.strike,
                quantity: quote.quantity,
                premium: quote.premium,
                expiry: quote.expiry,
                deadline: quote.deadline,
                nonce: quote.nonce
            }),
            sig
        );
    }

    /// @dev Publish a settlement price via commit-reveal.
    ///      Price is 18 decimals (1e18 = $1.00).
    ///      Handles time warping automatically: warps to just before expiry for commit,
    ///      then to expiry + 6min for reveal.
    function _publishPrice(address asset, uint256 expiry_, uint256 price) internal {
        bytes32 salt = bytes32(uint256(42));
        bytes32 commitHash = keccak256(abi.encodePacked(asset, expiry_, price, salt));

        // Ensure we're before expiry for commit (committedAt < expiry)
        // Also ensure commit is within 24h of when reveal will happen (reveal window)
        // Warp to 1h before expiry if we're too far out
        if (block.timestamp < expiry_ - 1 hours) {
            vm.warp(expiry_ - 1 hours);
        }

        vm.prank(publisher);
        oracle.commitPrice(commitHash);

        // Warp past expiry + reveal delay
        vm.warp(expiry_ + 6 minutes);

        vm.prank(publisher);
        oracle.revealPrice(asset, expiry_, price, salt);
    }

    /// @dev Publish a settlement price with a specific salt (for multiple publishes in one test).
    function _publishPriceWithSalt(address asset, uint256 expiry_, uint256 price, bytes32 salt) internal {
        bytes32 commitHash = keccak256(abi.encodePacked(asset, expiry_, price, salt));

        if (block.timestamp < expiry_ - 1 hours) {
            vm.warp(expiry_ - 1 hours);
        }

        vm.prank(publisher);
        oracle.commitPrice(commitHash);

        vm.warp(expiry_ + 6 minutes);

        vm.prank(publisher);
        oracle.revealPrice(asset, expiry_, price, salt);
    }
}
