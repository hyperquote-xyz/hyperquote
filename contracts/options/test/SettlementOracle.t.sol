// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementPublisher} from "../contracts/SettlementPublisher.sol";
import {ISettlementOracle} from "../contracts/interfaces/ISettlementOracle.sol";

contract SettlementOracleTest is Test {
    SettlementPublisher public oracle;
    address public owner = address(0xAA);
    address public pub1 = address(0xBB);
    address public pub2 = address(0xCC);
    address public nobody = address(0xDD);

    address public asset = address(0x1111);
    uint256 public expiry = 1_700_092_800; // some 08:00 UTC

    function setUp() public {
        vm.prank(owner);
        oracle = new SettlementPublisher(owner);

        vm.prank(owner);
        oracle.addPublisher(pub1);

        vm.warp(expiry - 1 hours); // warp to 1h before expiry so commits are valid (committedAt < expiry)
    }

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------

    function test_addPublisher() public {
        vm.prank(owner);
        oracle.addPublisher(pub2);
        assertTrue(oracle.isPublisher(pub2));
    }

    function test_removePublisher() public {
        vm.prank(owner);
        oracle.removePublisher(pub1);
        assertFalse(oracle.isPublisher(pub1));
    }

    function test_addPublisher_nonOwner_reverts() public {
        vm.prank(nobody);
        vm.expectRevert();
        oracle.addPublisher(pub2);
    }

    // ---------------------------------------------------------------
    // Commit Phase
    // ---------------------------------------------------------------

    function test_commitPrice_success() public {
        bytes32 commitHash = _computeCommitHash(asset, expiry, 25e18, bytes32(uint256(1)));
        vm.prank(pub1);
        oracle.commitPrice(commitHash);
        assertGt(oracle.commitTimestamps(commitHash), 0);
    }

    function test_commitPrice_nonPublisher_reverts() public {
        bytes32 commitHash = _computeCommitHash(asset, expiry, 25e18, bytes32(uint256(1)));
        vm.prank(nobody);
        vm.expectRevert(SettlementPublisher.NotPublisher.selector);
        oracle.commitPrice(commitHash);
    }

    function test_commitPrice_duplicate_reverts() public {
        bytes32 commitHash = _computeCommitHash(asset, expiry, 25e18, bytes32(uint256(1)));
        vm.prank(pub1);
        oracle.commitPrice(commitHash);

        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.AlreadyCommitted.selector);
        oracle.commitPrice(commitHash);
    }

    // ---------------------------------------------------------------
    // Reveal Phase
    // ---------------------------------------------------------------

    function test_revealPrice_success() public {
        uint256 price = 25e18; // $25.00
        bytes32 salt = bytes32(uint256(42));

        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);

        // Warp past expiry + reveal delay
        vm.warp(expiry + 6 minutes);

        vm.prank(pub1);
        oracle.revealPrice(asset, expiry, price, salt);

        (uint256 p, bool settled) = oracle.getSettlementPrice(asset, expiry);
        assertEq(p, price);
        assertTrue(settled);
        assertTrue(oracle.hasPriceFor(asset, expiry));
    }

    function test_revealPrice_tooEarly_reverts() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        // Commit 1 second before expiry so reveal delay matters
        vm.warp(expiry - 1);

        vm.prank(pub1);
        oracle.commitPrice(commitHash); // committedAt = expiry - 1

        // Warp to expiry (only 1 second after commit, well within 5 min reveal delay)
        vm.warp(expiry);

        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.RevealTooEarly.selector);
        oracle.revealPrice(asset, expiry, price, salt);
    }

    function test_revealPrice_tooLate_reverts() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);

        // Advance past the 24h reveal window
        vm.warp(block.timestamp + 25 hours);

        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.RevealTooLate.selector);
        oracle.revealPrice(asset, expiry, price, salt);
    }

    function test_revealPrice_wrongCommitHash_reverts() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);

        vm.warp(expiry + 6 minutes);

        // Try to reveal with wrong price
        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.NotCommitted.selector);
        oracle.revealPrice(asset, expiry, price + 1, salt);
    }

    function test_revealPrice_wrongSalt_reverts() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);

        vm.warp(expiry + 6 minutes);

        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.NotCommitted.selector);
        oracle.revealPrice(asset, expiry, price, bytes32(uint256(999)));
    }

    function test_revealPrice_notPublisher_reverts() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);

        vm.warp(expiry + 6 minutes);

        vm.prank(nobody);
        vm.expectRevert(SettlementPublisher.NotPublisher.selector);
        oracle.revealPrice(asset, expiry, price, salt);
    }

    function test_revealPrice_alreadySettled_reverts() public {
        uint256 price = 25e18;
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        // Commit both hashes before expiry
        bytes32 commitHash1 = _computeCommitHash(asset, expiry, price, salt1);
        bytes32 commitHash2 = _computeCommitHash(asset, expiry, price + 1, salt2);
        vm.prank(pub1);
        oracle.commitPrice(commitHash1);
        vm.prank(pub1);
        oracle.commitPrice(commitHash2);

        // Warp past expiry + reveal delay
        vm.warp(expiry + 6 minutes);

        // First reveal succeeds
        vm.prank(pub1);
        oracle.revealPrice(asset, expiry, price, salt1);

        // Second reveal fails
        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.AlreadySettled.selector);
        oracle.revealPrice(asset, expiry, price + 1, salt2);
    }

    function test_revealPrice_beforeExpiry_reverts() public {
        uint256 futureExpiry = block.timestamp + 1 days;
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, futureExpiry, price, salt);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);

        vm.warp(block.timestamp + 6 minutes); // past reveal delay but before expiry

        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.ExpiryNotPassed.selector);
        oracle.revealPrice(asset, futureExpiry, price, salt);
    }

    // ---------------------------------------------------------------
    // Commit-After-Expiry (Patch 2)
    // ---------------------------------------------------------------

    function test_revealPrice_commitAfterExpiry_reverts() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        // Warp to after expiry BEFORE committing
        vm.warp(expiry + 1);

        vm.prank(pub1);
        oracle.commitPrice(commitHash); // commit happens at expiry+1, which is >= expiry

        vm.warp(block.timestamp + 6 minutes); // past reveal delay

        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.CommitAfterExpiry.selector);
        oracle.revealPrice(asset, expiry, price, salt);
    }

    function test_revealPrice_commitAtExactExpiry_reverts() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(2));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        // Warp to exactly the expiry timestamp
        vm.warp(expiry);

        vm.prank(pub1);
        oracle.commitPrice(commitHash); // committedAt == expiry

        vm.warp(block.timestamp + 6 minutes);

        vm.prank(pub1);
        vm.expectRevert(SettlementPublisher.CommitAfterExpiry.selector);
        oracle.revealPrice(asset, expiry, price, salt);
    }

    function test_revealPrice_commitJustBeforeExpiry_succeeds() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(3));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        // Commit 1 second before expiry
        vm.warp(expiry - 1);

        vm.prank(pub1);
        oracle.commitPrice(commitHash); // committedAt = expiry - 1 < expiry ✓

        vm.warp(expiry + 6 minutes);

        vm.prank(pub1);
        oracle.revealPrice(asset, expiry, price, salt);

        (uint256 p, bool settled) = oracle.getSettlementPrice(asset, expiry);
        assertEq(p, price);
        assertTrue(settled);
    }

    // ---------------------------------------------------------------
    // Price Retrieval
    // ---------------------------------------------------------------

    function test_getSettlementPrice_notPublished_returnsZeroFalse() public view {
        (uint256 p, bool settled) = oracle.getSettlementPrice(asset, expiry);
        assertEq(p, 0);
        assertFalse(settled);
    }

    function test_hasPriceFor_notPublished_returnsFalse() public view {
        assertFalse(oracle.hasPriceFor(asset, expiry));
    }

    // ---------------------------------------------------------------
    // Multiple Assets / Expiries
    // ---------------------------------------------------------------

    function test_independentPricesPerAsset() public {
        address asset2 = address(0x2222);
        uint256 price1 = 25e18;
        uint256 price2 = 50e18;
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        // Commit both BEFORE expiry
        bytes32 hash1 = _computeCommitHash(asset, expiry, price1, salt1);
        bytes32 hash2 = _computeCommitHash(asset2, expiry, price2, salt2);
        vm.prank(pub1);
        oracle.commitPrice(hash1);
        vm.prank(pub1);
        oracle.commitPrice(hash2);

        // Warp past expiry + reveal delay
        vm.warp(expiry + 6 minutes);

        // Reveal both
        vm.prank(pub1);
        oracle.revealPrice(asset, expiry, price1, salt1);
        vm.prank(pub1);
        oracle.revealPrice(asset2, expiry, price2, salt2);

        (uint256 p1,) = oracle.getSettlementPrice(asset, expiry);
        (uint256 p2,) = oracle.getSettlementPrice(asset2, expiry);
        assertEq(p1, price1);
        assertEq(p2, price2);
    }

    function test_independentPricesPerExpiry() public {
        uint256 expiry2 = expiry + 86400;
        // For expiry2, we need to commit before expiry2
        // Current time is expiry - 1h, so both commits happen before both expiries

        _publishFull(asset, expiry, 25e18, bytes32(uint256(1)));

        // We need to warp back before expiry2 for commit
        // After _publishFull, time has advanced by 6 min past expiry
        // expiry2 = expiry + 86400, so we're well before expiry2
        _publishFull(asset, expiry2, 30e18, bytes32(uint256(2)));

        (uint256 p1,) = oracle.getSettlementPrice(asset, expiry);
        (uint256 p2,) = oracle.getSettlementPrice(asset, expiry2);
        assertEq(p1, 25e18);
        assertEq(p2, 30e18);
    }

    // ---------------------------------------------------------------
    // Edge Cases
    // ---------------------------------------------------------------

    function test_revealPrice_priceZero_succeeds() public {
        _publishFull(asset, expiry, 0, bytes32(uint256(1)));
        (uint256 p, bool settled) = oracle.getSettlementPrice(asset, expiry);
        assertEq(p, 0);
        assertTrue(settled);
    }

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    function test_revealPrice_emitsEvent() public {
        uint256 price = 25e18;
        bytes32 salt = bytes32(uint256(1));
        bytes32 commitHash = _computeCommitHash(asset, expiry, price, salt);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);
        vm.warp(expiry + 6 minutes);

        vm.expectEmit(true, true, false, true);
        emit ISettlementOracle.SettlementPricePublished(asset, expiry, price, pub1);

        vm.prank(pub1);
        oracle.revealPrice(asset, expiry, price, salt);
    }

    function test_commitPrice_emitsEvent() public {
        bytes32 commitHash = _computeCommitHash(asset, expiry, 25e18, bytes32(uint256(1)));

        vm.expectEmit(true, true, false, true);
        emit SettlementPublisher.PriceCommitted(commitHash, pub1);

        vm.prank(pub1);
        oracle.commitPrice(commitHash);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function _computeCommitHash(address a, uint256 e, uint256 p, bytes32 s) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, e, p, s));
    }

    /// @dev Full commit-reveal flow for convenience.
    ///      Assumes block.timestamp < expiry for the commit.
    function _publishFull(address a, uint256 e, uint256 p, bytes32 s) internal {
        bytes32 commitHash = _computeCommitHash(a, e, p, s);
        vm.prank(pub1);
        oracle.commitPrice(commitHash);
        // Warp past expiry + reveal delay
        uint256 target = e + 6 minutes;
        if (block.timestamp < target) vm.warp(target);
        else vm.warp(block.timestamp + 6 minutes);
        vm.prank(pub1);
        oracle.revealPrice(a, e, p, s);
    }
}
