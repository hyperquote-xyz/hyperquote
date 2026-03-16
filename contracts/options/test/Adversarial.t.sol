// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "./helpers/TestSetup.sol";
import {QuoteLib} from "../src/libraries/QuoteLib.sol";
import {OptionsEngine} from "../src/OptionsEngine.sol";
import {SettlementPublisher} from "../src/SettlementPublisher.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// @notice Adversarial tests for security findings identified in the HyperQuote Options V1 audit.
/// @dev Tests cover: emergency mechanisms (C-1, C-2, C-3), soulbound NFTs (H-1),
///      oracle timelock (H-2), and other findings (M-3, M-4, L-2).
contract AdversarialTest is TestSetup {
    // ---------------------------------------------------------------
    // C-1: Buyer Non-Cooperation — Grace Period Emergency Expiry
    // ---------------------------------------------------------------

    /// @dev After SETTLEMENT_GRACE_PERIOD, an ITM position can be force-expired
    ///      even though the buyer has revoked approval (making settle impossible).
    function test_graceExpiry_itm_csp_buyerRevokedApproval() public {
        // Create a CSP position: maker=buyer, taker=seller
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Publish ITM price (S=$20 < K=$25)
        _publishPrice(address(whype), standardExpiry, 20e18);

        // Buyer revokes approval — settle() will fail
        vm.prank(maker);
        whype.approve(address(engine), 0);

        // Normal settle should fail (buyer can't deliver underlying)
        vm.expectRevert();
        vm.prank(alice);
        engine.settle(posId);

        // Normal expiry should fail (position is ITM)
        vm.warp(standardExpiry + engine.SETTLEMENT_WINDOW() + 1);
        vm.expectRevert(OptionsEngine.PositionNotOTM.selector);
        vm.prank(alice);
        engine.expirePosition(posId);

        // Warp past grace period — force-expiry now succeeds
        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        uint256 sellerUsdcBefore = usdc.balanceOf(taker);
        vm.prank(alice);
        engine.expirePosition(posId);

        // Seller recovers collateral
        uint256 sellerUsdcAfter = usdc.balanceOf(taker);
        assertEq(sellerUsdcAfter - sellerUsdcBefore, 25e6); // 25 USDC returned

        // Position is expired
        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Expired));
    }

    /// @dev Grace period works for CC ITM as well.
    function test_graceExpiry_itm_cc_buyerNoBalance() public {
        QuoteLib.Quote memory q = _buildCCQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Publish ITM price (S=$30 > K=$25)
        _publishPrice(address(whype), standardExpiry, 30e18);

        // Drain buyer's USDC — settle() requires buyer to pay collateral
        uint256 makerBal = usdc.balanceOf(maker);
        vm.prank(maker);
        usdc.transfer(address(1), makerBal);

        // Normal settle fails (buyer has no USDC)
        vm.expectRevert();
        vm.prank(alice);
        engine.settle(posId);

        // Warp past grace period
        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        // Force-expiry returns underlying to seller
        uint256 sellerWhypeBefore = whype.balanceOf(taker);
        vm.prank(alice);
        engine.expirePosition(posId);

        assertEq(whype.balanceOf(taker) - sellerWhypeBefore, 1 ether);
    }

    /// @dev Before the grace period, ITM positions still cannot be expired.
    function test_graceExpiry_beforeGrace_itm_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        // Just after settlement window but before grace period
        vm.warp(standardExpiry + engine.SETTLEMENT_WINDOW() + 1);

        vm.expectRevert(OptionsEngine.PositionNotOTM.selector);
        engine.expirePosition(posId);
    }

    /// @dev OTM positions can still expire normally (no grace needed).
    function test_graceExpiry_otm_normalExpiry_stillWorks() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // OTM: S=$30 >= K=$25 for put
        _publishPrice(address(whype), standardExpiry, 30e18);

        vm.warp(standardExpiry + engine.SETTLEMENT_WINDOW() + 1);
        engine.expirePosition(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Expired));
    }

    // ---------------------------------------------------------------
    // C-2 / C-3: Missing Oracle Price — Emergency Release
    // ---------------------------------------------------------------

    /// @dev When oracle never publishes a price, emergencyRelease saves seller collateral.
    function test_emergencyRelease_noOraclePrice() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Do NOT publish any oracle price
        // Warp past grace period
        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        // Normal settle/expire both fail
        vm.expectRevert(OptionsEngine.OraclePriceNotAvailable.selector);
        engine.settle(posId);

        vm.expectRevert(OptionsEngine.OraclePriceNotAvailable.selector);
        engine.expirePosition(posId);

        // Emergency release succeeds
        uint256 sellerUsdcBefore = usdc.balanceOf(taker);
        vm.prank(alice);
        engine.emergencyRelease(posId);

        assertEq(usdc.balanceOf(taker) - sellerUsdcBefore, 25e6);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Expired));
    }

    /// @dev Emergency release for CC position returns underlying to seller.
    function test_emergencyRelease_cc_noOraclePrice() public {
        QuoteLib.Quote memory q = _buildCCQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        uint256 sellerWhypeBefore = whype.balanceOf(taker);
        engine.emergencyRelease(posId);

        assertEq(whype.balanceOf(taker) - sellerWhypeBefore, 1 ether);
    }

    /// @dev Emergency release reverts before grace period.
    function test_emergencyRelease_tooEarly_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() - 1);

        vm.expectRevert(OptionsEngine.TooEarlyForEmergency.selector);
        engine.emergencyRelease(posId);
    }

    /// @dev Emergency release reverts if oracle HAS published a price (use normal paths).
    function test_emergencyRelease_oracleAvailable_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        vm.expectRevert(OptionsEngine.OraclePriceAvailable.selector);
        engine.emergencyRelease(posId);
    }

    /// @dev Emergency release cannot double-release.
    function test_emergencyRelease_alreadyReleased_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        engine.emergencyRelease(posId);

        vm.expectRevert(OptionsEngine.PositionNotActive.selector);
        engine.emergencyRelease(posId);
    }

    // ---------------------------------------------------------------
    // C-2 / M-4: Oracle Emergency Publication
    // ---------------------------------------------------------------

    /// @dev Owner can emergency-publish a price after 48h when publishers fail.
    function test_emergencyPublish_success() public {
        vm.warp(standardExpiry + 48 hours + 1);

        vm.prank(owner);
        oracle.emergencyPublish(address(whype), standardExpiry, 20e18);

        (uint256 price, bool settled) = oracle.getSettlementPrice(address(whype), standardExpiry);
        assertEq(price, 20e18);
        assertTrue(settled);
    }

    /// @dev Emergency publish too early reverts.
    function test_emergencyPublish_tooEarly_reverts() public {
        vm.warp(standardExpiry + 48 hours - 1);

        vm.prank(owner);
        vm.expectRevert(SettlementPublisher.TooEarlyForEmergency.selector);
        oracle.emergencyPublish(address(whype), standardExpiry, 20e18);
    }

    /// @dev Emergency publish when price already set reverts.
    function test_emergencyPublish_alreadySettled_reverts() public {
        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.warp(standardExpiry + 48 hours + 1);

        vm.prank(owner);
        vm.expectRevert(SettlementPublisher.AlreadySettled.selector);
        oracle.emergencyPublish(address(whype), standardExpiry, 25e18);
    }

    /// @dev Non-owner cannot emergency publish.
    function test_emergencyPublish_nonOwner_reverts() public {
        vm.warp(standardExpiry + 48 hours + 1);

        vm.prank(alice);
        vm.expectRevert();
        oracle.emergencyPublish(address(whype), standardExpiry, 20e18);
    }

    /// @dev Emergency publish enables settlement that was previously blocked.
    function test_emergencyPublish_thenSettle() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // No normal publish. Emergency publish after 48h.
        vm.warp(standardExpiry + 48 hours + 1);
        vm.prank(owner);
        oracle.emergencyPublish(address(whype), standardExpiry, 20e18);

        // Now settle works (S=$20 < K=$25, ITM)
        vm.prank(maker);
        engine.settle(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    // ---------------------------------------------------------------
    // H-1: Soulbound NFTs — Non-Transferable
    // ---------------------------------------------------------------

    /// @dev Position NFTs cannot be transferred between non-zero addresses.
    function test_soulbound_transfer_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Maker (buyer) owns the NFT
        assertEq(engine.ownerOf(posId), maker);

        // Transfer to alice should revert
        vm.prank(maker);
        vm.expectRevert(OptionsEngine.NonTransferable.selector);
        engine.transferFrom(maker, alice, posId);
    }

    /// @dev safeTransferFrom also blocked.
    function test_soulbound_safeTransfer_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        vm.prank(maker);
        vm.expectRevert(OptionsEngine.NonTransferable.selector);
        engine.safeTransferFrom(maker, alice, posId);
    }

    /// @dev Mint (from=0) still works (verified by quote execution).
    function test_soulbound_mint_works() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        assertEq(engine.ownerOf(posId), maker);
    }

    /// @dev Burn (to=0) still works (verified by settlement).
    function test_soulbound_burn_works() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.prank(maker);
        engine.settle(posId);

        // NFT is burned
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, posId));
        engine.ownerOf(posId);
    }

    // ---------------------------------------------------------------
    // H-2: Oracle Timelock
    // ---------------------------------------------------------------

    /// @dev Oracle change requires propose + wait + accept.
    function test_oracleTimelock_fullFlow() public {
        address newOracle = address(0x1234);

        vm.prank(owner);
        engine.proposeOracle(newOracle);

        assertEq(engine.pendingOracle(), newOracle);

        // Accept too early reverts
        vm.prank(owner);
        vm.expectRevert(OptionsEngine.OracleTimelockNotElapsed.selector);
        engine.acceptOracle();

        // Warp past timelock
        vm.warp(block.timestamp + engine.ORACLE_TIMELOCK_DELAY() + 1);

        vm.prank(owner);
        engine.acceptOracle();

        assertEq(address(engine.oracle()), newOracle);
        assertEq(engine.pendingOracle(), address(0));
    }

    /// @dev Propose zero address reverts.
    function test_oracleTimelock_proposeZero_reverts() public {
        vm.prank(owner);
        vm.expectRevert(OptionsEngine.ZeroAddress.selector);
        engine.proposeOracle(address(0));
    }

    /// @dev Accept without propose reverts.
    function test_oracleTimelock_acceptWithoutPropose_reverts() public {
        vm.prank(owner);
        vm.expectRevert(OptionsEngine.NoOracleProposed.selector);
        engine.acceptOracle();
    }

    /// @dev Non-owner cannot propose.
    function test_oracleTimelock_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.proposeOracle(address(0x1234));
    }

    // ---------------------------------------------------------------
    // M-3: incrementNonce Doesn't Cancel High-Nonce Quotes
    // ---------------------------------------------------------------

    /// @dev A quote with nonce=10 survives a single incrementNonce().
    function test_highNonce_survivesIncrementNonce() public {
        // Sign quote with nonce=10
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.nonce = 10;
        bytes memory sig = _signQuote(q);

        // Increment nonce once (nonces[maker] = 1)
        vm.prank(maker);
        engine.incrementNonce();

        // Quote with nonce=10 still executes (10 >= 1)
        vm.prank(taker);
        uint256 posId = engine.execute(q, sig);

        assertTrue(posId > 0);
    }

    /// @dev Incrementing nonce past the quote nonce invalidates it.
    function test_highNonce_invalidatedAfterEnoughIncrements() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.nonce = 2;
        bytes memory sig = _signQuote(q);

        // Increment 3 times (nonces[maker] = 3)
        vm.startPrank(maker);
        engine.incrementNonce(); // 1
        engine.incrementNonce(); // 2
        engine.incrementNonce(); // 3
        vm.stopPrank();

        // Quote with nonce=2 now fails (2 < 3)
        vm.prank(taker);
        vm.expectRevert(OptionsEngine.NonceTooLow.selector);
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // L-2: cancelQuote Uses NotMaker Error
    // ---------------------------------------------------------------

    /// @dev cancelQuote by non-maker reverts with NotMaker, not InvalidSignature.
    function test_cancelQuote_nonMaker_revertsNotMaker() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.NotMaker.selector);
        engine.cancelQuote(q);
    }

    // ---------------------------------------------------------------
    // M-4: Publisher Misses Commit Window
    // ---------------------------------------------------------------

    /// @dev If publisher commits after expiry, reveal still fails (CommitAfterExpiry).
    function test_publisherCommitAfterExpiry_fails() public {
        vm.warp(standardExpiry + 1);

        bytes32 salt = bytes32(uint256(42));
        bytes32 commitHash = keccak256(abi.encodePacked(address(whype), standardExpiry, uint256(20e18), salt));

        vm.prank(publisher);
        oracle.commitPrice(commitHash);

        vm.warp(standardExpiry + 6 minutes);

        vm.prank(publisher);
        vm.expectRevert(SettlementPublisher.CommitAfterExpiry.selector);
        oracle.revealPrice(address(whype), standardExpiry, 20e18, salt);
    }

    /// @dev Publisher commits but never reveals — commitment is stale after REVEAL_WINDOW.
    function test_publisherCommitNoReveal_stale() public {
        // Commit before expiry
        vm.warp(standardExpiry - 1 hours);

        bytes32 salt = bytes32(uint256(42));
        bytes32 commitHash = keccak256(abi.encodePacked(address(whype), standardExpiry, uint256(20e18), salt));

        vm.prank(publisher);
        oracle.commitPrice(commitHash);

        // Warp past reveal window (commit + 24h)
        vm.warp(standardExpiry - 1 hours + 24 hours + 1);

        vm.prank(publisher);
        vm.expectRevert(SettlementPublisher.RevealTooLate.selector);
        oracle.revealPrice(address(whype), standardExpiry, 20e18, salt);

        // Price still not published
        assertFalse(oracle.hasPriceFor(address(whype), standardExpiry));
    }

    // ---------------------------------------------------------------
    // Integration: Emergency Publish + Grace Expiry Work Together
    // ---------------------------------------------------------------

    /// @dev Full scenario: publisher fails, owner emergency-publishes, then grace-expire an ITM position.
    function test_fullEmergencyScenario() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Buyer revokes approval
        vm.prank(maker);
        whype.approve(address(engine), 0);

        // No publisher commits. Warp to 48h after expiry.
        vm.warp(standardExpiry + 48 hours + 1);

        // Owner emergency publishes (S=$20, ITM)
        vm.prank(owner);
        oracle.emergencyPublish(address(whype), standardExpiry, 20e18);

        // settle() still fails (buyer has no approval)
        vm.expectRevert();
        vm.prank(alice);
        engine.settle(posId);

        // Warp to grace period
        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        // Grace-expiry succeeds — seller recovers collateral
        uint256 sellerBefore = usdc.balanceOf(taker);
        vm.prank(alice);
        engine.expirePosition(posId);

        assertEq(usdc.balanceOf(taker) - sellerBefore, 25e6);
    }

    /// @dev Scenario: No oracle price at all, emergencyRelease is the only path.
    function test_fullEmergencyRelease_noOracle() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // No publisher, no emergency publish. Warp past grace.
        vm.warp(standardExpiry + engine.SETTLEMENT_GRACE_PERIOD() + 1);

        // Both settle and expire fail
        vm.expectRevert(OptionsEngine.OraclePriceNotAvailable.selector);
        engine.settle(posId);

        vm.expectRevert(OptionsEngine.OraclePriceNotAvailable.selector);
        engine.expirePosition(posId);

        // Emergency release saves the day
        uint256 sellerBefore = usdc.balanceOf(taker);
        engine.emergencyRelease(posId);
        assertEq(usdc.balanceOf(taker) - sellerBefore, 25e6);
    }
}
