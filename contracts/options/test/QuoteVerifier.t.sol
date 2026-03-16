// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "./helpers/TestSetup.sol";
import {QuoteLib} from "../src/libraries/QuoteLib.sol";
import {OptionsEngine} from "../src/OptionsEngine.sol";
import {CollateralMath} from "../src/libraries/CollateralMath.sol";

/// @dev V1 roles: maker = buyer, taker = seller. isMakerSeller must be false.
///      Strike is 18 decimals (1e18 = $1). Premium is in collateral decimals.
contract QuoteVerifierTest is TestSetup {
    // ---------------------------------------------------------------
    // Signature Verification
    // ---------------------------------------------------------------

    function test_execute_validSignature_createsPosition() public {
        // strike=$25, qty=1 WHYPE, premium=1 USDC
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.seller, taker); // taker is seller in V1
        assertEq(pos.buyer, maker); // maker is buyer in V1
        assertEq(pos.strike, 25e18);
        assertEq(pos.quantity, 1 ether);
        assertEq(pos.premium, 1e6);
        assertFalse(pos.isCall);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Active));
    }

    function test_execute_invalidSignature_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);

        // Sign with wrong key
        uint256 wrongPk = 0xDEAD;
        bytes32 structHash = _hashQuoteMemory(q);
        bytes32 digest = _toTypedDataHash(engine.domainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.InvalidSignature.selector);
        engine.execute(q, badSig);
    }

    function test_execute_modifiedQuote_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        bytes memory sig = _signQuote(q);

        // Tamper with premium
        q.premium = 2e6;

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.InvalidSignature.selector);
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // Quote Validity
    // ---------------------------------------------------------------

    function test_execute_expiredDeadline_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.deadline = block.timestamp - 1;
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.QuoteExpired.selector);
        engine.execute(q, sig);
    }

    function test_execute_alreadyUsedQuote_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        _executeQuote(q);

        // Second execution should fail
        bytes memory sig = _signQuote(q);
        vm.prank(taker);
        vm.expectRevert(OptionsEngine.QuoteAlreadyUsed.selector);
        engine.execute(q, sig);
    }

    function test_execute_staleNonce_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.nonce = 0;
        bytes memory sig = _signQuote(q);

        // Increment maker nonce to 1
        vm.prank(maker);
        engine.incrementNonce();

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.NonceTooLow.selector);
        engine.execute(q, sig);
    }

    function test_execute_wrongTaker_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.taker = alice; // specific taker
        bytes memory sig = _signQuote(q);

        vm.prank(taker); // wrong taker
        vm.expectRevert(OptionsEngine.TakerMismatch.selector);
        engine.execute(q, sig);
    }

    function test_execute_openQuote_anyTaker() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.taker = address(0); // open

        // Alice acts as taker (seller) — needs USDC for collateral + receives premium
        bytes memory sig = _signQuote(q);
        vm.prank(alice);
        uint256 posId = engine.execute(q, sig);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.seller, alice); // alice is the taker/seller
        assertEq(pos.buyer, maker); // maker is always the buyer
    }

    function test_execute_targetedQuote_correctTaker() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.taker = taker;
        uint256 posId = _executeQuote(q);
        assertGt(posId, 0);
    }

    // ---------------------------------------------------------------
    // V1 Constraint: isMakerSeller must be false
    // ---------------------------------------------------------------

    function test_execute_isMakerSeller_true_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.isMakerSeller = true;
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.TakerMustBeSeller.selector);
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // Collateral Locking — Cash-Secured Put
    // ---------------------------------------------------------------

    function test_execute_csp_locksCorrectCollateral() public {
        // strike=$25 (25e18), quantity=2 WHYPE (2e18), collateral=USDC(6 dec)
        // collateral = ceilDiv(25e18 * 2e18, 10^(18+18-6)) = ceilDiv(50e36, 10^30) = 50e6 = 50 USDC
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 2 ether, 1e6);

        uint256 takerUsdcBefore = usdc.balanceOf(taker); // taker is seller in V1
        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, 50e6);

        // Taker (seller) lost 50 USDC collateral - received 1 USDC premium = net -49 USDC
        uint256 takerUsdcAfter = usdc.balanceOf(taker);
        assertEq(takerUsdcBefore - takerUsdcAfter, 49e6);
    }

    function test_execute_csp_insufficientCollateral_reverts() public {
        // Drain taker's (seller's) USDC
        uint256 bal = usdc.balanceOf(taker);
        vm.prank(taker);
        usdc.transfer(address(1), bal);

        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(); // SafeERC20 will revert
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // Collateral Locking — Covered Call
    // ---------------------------------------------------------------

    function test_execute_cc_locksUnderlyingQuantity() public {
        // CC: taker (seller) locks underlying
        QuoteLib.Quote memory q = _buildCCQuote(30e18, 5 ether, 2e6);

        uint256 takerWhypeBefore = whype.balanceOf(taker);
        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, 5 ether); // locks underlying qty

        uint256 takerWhypeAfter = whype.balanceOf(taker);
        assertEq(takerWhypeBefore - takerWhypeAfter, 5 ether);
    }

    function test_execute_cc_insufficientUnderlying_reverts() public {
        // Drain taker's WHYPE
        uint256 bal = whype.balanceOf(taker);
        vm.prank(taker);
        whype.transfer(address(1), bal);

        QuoteLib.Quote memory q = _buildCCQuote(30e18, 1 ether, 1e6);
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert();
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // Premium Transfer
    // ---------------------------------------------------------------

    function test_execute_premiumTransferred_buyerToSeller() public {
        // maker=buyer pays premium, taker=seller receives premium
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 3e6);

        uint256 makerBefore = usdc.balanceOf(maker); // buyer
        uint256 takerBefore = usdc.balanceOf(taker); // seller

        _executeQuote(q);

        // Maker (buyer) paid 3 USDC premium
        assertEq(makerBefore - usdc.balanceOf(maker), 3e6);
        // Taker (seller) received premium (+3), locked collateral (-25) = net -22 USDC
        assertEq(takerBefore - usdc.balanceOf(taker), 22e6);
    }

    // ---------------------------------------------------------------
    // Cancellation
    // ---------------------------------------------------------------

    function test_cancelQuote_makerCancels() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        bytes32 digest = _toTypedDataHash(engine.domainSeparator(), _hashQuoteMemory(q));

        vm.prank(maker);
        engine.cancelQuote(q);

        assertTrue(engine.isQuoteUsed(digest));
    }

    function test_cancelQuote_nonMaker_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.NotMaker.selector);
        engine.cancelQuote(q);
    }

    function test_cancelQuote_preventsFutureExecution() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);

        vm.prank(maker);
        engine.cancelQuote(q);

        bytes memory sig = _signQuote(q);
        vm.prank(taker);
        vm.expectRevert(OptionsEngine.QuoteAlreadyUsed.selector);
        engine.execute(q, sig);
    }

    function test_incrementNonce_invalidatesPriorQuotes() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.nonce = 0;
        bytes memory sig = _signQuote(q);

        vm.prank(maker);
        engine.incrementNonce();
        assertEq(engine.nonces(maker), 1);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.NonceTooLow.selector);
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // Parameter Validation
    // ---------------------------------------------------------------

    function test_execute_zeroQuantity_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 0, 1e6);
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.ZeroQuantity.selector);
        engine.execute(q, sig);
    }

    function test_execute_zeroPremium_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 0);
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.ZeroPremium.selector);
        engine.execute(q, sig);
    }

    function test_execute_zeroStrike_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(0, 1 ether, 1e6);
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.ZeroStrike.selector);
        engine.execute(q, sig);
    }

    function test_execute_disallowedCollateral_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.collateral = address(0xDEAD); // not allowed
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.CollateralNotAllowed.selector);
        engine.execute(q, sig);
    }

    function test_execute_disallowedUnderlying_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.underlying = address(0xDEAD); // not allowed
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.UnderlyingNotAllowed.selector);
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // Expiry Validation
    // ---------------------------------------------------------------

    function test_execute_expiryNot0800UTC_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.expiry = standardExpiry + 1; // not 08:00 UTC
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.InvalidExpiry.selector);
        engine.execute(q, sig);
    }

    function test_execute_expiryTooSoon_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        // Find an expiry less than 24h away
        uint256 soonExpiry = _nextExpiry(block.timestamp);
        // If soonExpiry is less than 24h away, use it
        if (soonExpiry < block.timestamp + 24 hours) {
            q.expiry = soonExpiry;
            bytes memory sig = _signQuote(q);
            vm.prank(taker);
            vm.expectRevert(OptionsEngine.InvalidExpiry.selector);
            engine.execute(q, sig);
        }
        // If not, warp closer to an expiry
        else {
            vm.warp(soonExpiry - 23 hours);
            q.expiry = soonExpiry;
            q.deadline = block.timestamp + 1 hours;
            bytes memory sig = _signQuote(q);
            vm.prank(taker);
            vm.expectRevert(OptionsEngine.InvalidExpiry.selector);
            engine.execute(q, sig);
        }
    }

    function test_execute_expiryTooFar_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.expiry = _nextExpiry(block.timestamp + 91 days);
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(OptionsEngine.InvalidExpiry.selector);
        engine.execute(q, sig);
    }

    // ---------------------------------------------------------------
    // Pause
    // ---------------------------------------------------------------

    function test_execute_whenPaused_reverts() public {
        vm.prank(owner);
        engine.pause();

        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        bytes memory sig = _signQuote(q);

        vm.prank(taker);
        vm.expectRevert(); // Pausable: paused
        engine.execute(q, sig);
    }

    function test_execute_afterUnpause_succeeds() public {
        vm.prank(owner);
        engine.pause();
        vm.prank(owner);
        engine.unpause();

        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);
        assertGt(posId, 0);
    }

    // ---------------------------------------------------------------
    // NFT Minting
    // ---------------------------------------------------------------

    function test_execute_mintsNFTToBuyer() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        assertEq(engine.ownerOf(posId), maker); // maker=buyer gets NFT
    }

    function test_execute_positionIdIncrements() public {
        QuoteLib.Quote memory q1 = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 id1 = _executeQuote(q1);

        QuoteLib.Quote memory q2 = _buildCSPQuote(30e18, 1 ether, 1e6);
        q2.nonce = 0; // same nonce is fine since these are different quotes
        uint256 id2 = _executeQuote(q2);

        assertEq(id1, 1);
        assertEq(id2, 2);
    }

    // ---------------------------------------------------------------
    // Multi-Collateral
    // ---------------------------------------------------------------

    function test_execute_withUSDH() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        q.collateral = address(usdh);

        uint256 posId = _executeQuote(q);
        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateral, address(usdh));
    }

    function test_execute_withUSDH18_crossDecimal() public {
        // USDH18 has 18 decimals — collateral = ceilDiv(25e18 * 1e18, 10^(18+18-18)) = ceilDiv(25e36, 1e18) = 25e18
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e18);
        q.collateral = address(usdh18);

        uint256 posId = _executeQuote(q);
        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, 25e18); // 25 USDH18 in 18-decimal units
    }

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    function test_execute_emitsQuoteExecuted() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        bytes memory sig = _signQuote(q);

        bytes32 digest = _toTypedDataHash(engine.domainSeparator(), _hashQuoteMemory(q));

        vm.expectEmit(true, true, true, true);
        emit OptionsEngine.QuoteExecuted(digest, 1, maker, taker);

        vm.prank(taker);
        engine.execute(q, sig);
    }

    function test_cancelQuote_emitsQuoteCancelled() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        bytes32 digest = _toTypedDataHash(engine.domainSeparator(), _hashQuoteMemory(q));

        vm.expectEmit(true, true, false, true);
        emit OptionsEngine.QuoteCancelled(digest, maker);

        vm.prank(maker);
        engine.cancelQuote(q);
    }

    function test_incrementNonce_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit OptionsEngine.NonceIncremented(maker, 1);

        vm.prank(maker);
        engine.incrementNonce();
    }
}
