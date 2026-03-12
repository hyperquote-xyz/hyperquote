// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestSetup} from "./helpers/TestSetup.sol";
import {QuoteLib} from "../contracts/libraries/QuoteLib.sol";
import {OptionsEngine} from "../contracts/OptionsEngine.sol";
import {CollateralMath} from "../contracts/libraries/CollateralMath.sol";

/// @dev V1 roles: maker = buyer, taker = seller. Strike & price at 18 decimals.
///      Settlement: anyone can call settle() (keeper model), no upper time bound.
///      Expiry: requires oracle proof of OTM/ATM. ITM positions cannot be expired.
contract SettlementTest is TestSetup {
    // ---------------------------------------------------------------
    // Cash-Secured Put — ITM Settlement (S < K)
    // ---------------------------------------------------------------

    function test_settle_csp_itm() public {
        // Strike=$25, qty=1 WHYPE, premium=1 USDC
        // V1: maker=buyer, taker=seller
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Warp to expiry (but still before expiry for commit)
        // We need commit before expiry. Current time is after setUp, well before standardExpiry.
        // Publish price S=$20 (ITM: S < K) — commit happens now (before expiry), reveal after expiry
        _publishPrice(address(whype), standardExpiry, 20e18);

        // Warp to after expiry (publish already warped us past expiry + 6min)
        // Now settle
        uint256 makerUsdcBefore = usdc.balanceOf(maker); // buyer
        uint256 makerWhypeBefore = whype.balanceOf(maker);
        uint256 takerWhypeBefore = whype.balanceOf(taker); // seller

        // Anyone can settle — use maker (buyer) here
        vm.prank(maker);
        engine.settle(posId);

        // Buyer delivered 1 WHYPE to seller
        assertEq(makerWhypeBefore - whype.balanceOf(maker), 1 ether);
        // Buyer received 25 USDC (collateral)
        assertEq(usdc.balanceOf(maker) - makerUsdcBefore, 25e6);
        // Seller received 1 WHYPE
        assertEq(whype.balanceOf(taker) - takerWhypeBefore, 1 ether);

        // Position is settled
        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    function test_settle_csp_itm_deepItm() public {
        // S=$1 (near zero), K=$25 — deep ITM put
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 2 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 1e18);

        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        vm.prank(maker);
        engine.settle(posId);

        // Buyer receives full 50 USDC (25 × 2)
        assertEq(usdc.balanceOf(maker) - makerUsdcBefore, 50e6);
    }

    // ---------------------------------------------------------------
    // Covered Call — ITM Settlement (S > K)
    // ---------------------------------------------------------------

    function test_settle_cc_itm() public {
        // Strike=$30, qty=1 WHYPE, premium=2 USDC
        QuoteLib.Quote memory q = _buildCCQuote(30e18, 1 ether, 2e6);
        uint256 posId = _executeQuote(q);

        // S=$50 (ITM: S > K)
        _publishPrice(address(whype), standardExpiry, 50e18);

        uint256 makerWhypeBefore = whype.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        // Buyer (maker) settles: delivers strike×qty=30 USDC, receives 1 WHYPE
        // Keeper fee: notional=30e6, fee=ceil(30e6*10/10_000)=30000 (0.03 USDC)
        // Buyer is also the keeper here, so net USDC cost = 30e6 - 30000
        vm.prank(maker);
        engine.settle(posId);

        uint256 keeperFee = 30000; // ceil(30e6 * 10 / 10_000)
        // Buyer net USDC paid = grossCollateral - keeperFee (since buyer is also keeper)
        assertEq(makerUsdcBefore - usdc.balanceOf(maker), 30e6 - keeperFee);
        // Buyer received 1 WHYPE
        assertEq(whype.balanceOf(maker) - makerWhypeBefore, 1 ether);
        // Seller received grossCollateral - keeperFee
        assertEq(usdc.balanceOf(taker) - takerUsdcBefore, 30e6 - keeperFee);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    function test_settle_cc_itm_deep() public {
        // S=$1000, K=$30 — very deep ITM call
        QuoteLib.Quote memory q = _buildCCQuote(30e18, 3 ether, 5e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 1000e18);

        uint256 makerWhypeBefore = whype.balanceOf(maker);

        vm.prank(maker);
        engine.settle(posId);

        // Buyer receives 3 WHYPE of locked underlying
        assertEq(whype.balanceOf(maker) - makerWhypeBefore, 3 ether);
    }

    // ---------------------------------------------------------------
    // Anyone-Can-Settle (Keeper Model)
    // ---------------------------------------------------------------

    function test_settle_anyoneCanCall() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        // Alice (random third party) calls settle
        vm.prank(alice);
        engine.settle(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    function test_settle_sellerCanCall() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        // Taker (seller) can also call settle
        vm.prank(taker);
        engine.settle(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    // ---------------------------------------------------------------
    // No Upper Settlement Time Bound
    // ---------------------------------------------------------------

    function test_settle_afterSettlementWindow_succeeds() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        // Warp way past the settlement window (was previously capped at 24h)
        vm.warp(standardExpiry + 7 days);

        vm.prank(alice);
        engine.settle(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    function test_settle_longAfterExpiry_succeeds() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        // 30 days after expiry — still settles
        vm.warp(standardExpiry + 30 days);

        vm.prank(maker);
        engine.settle(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    // ---------------------------------------------------------------
    // OTM Expiry — Requires Oracle OTM/ATM Proof
    // ---------------------------------------------------------------

    function test_expire_csp_otm() public {
        // Strike=$25, S=$30 (OTM: S >= K for a put)
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Publish OTM price (commit before expiry)
        _publishPrice(address(whype), standardExpiry, 30e18);

        // Warp past expiry + settlement window
        vm.warp(standardExpiry + 24 hours + 1);

        uint256 takerUsdcBefore = usdc.balanceOf(taker); // seller gets collateral back

        engine.expirePosition(posId);

        // Seller gets collateral back (25 USDC)
        assertEq(usdc.balanceOf(taker) - takerUsdcBefore, 25e6);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Expired));
    }

    function test_expire_cc_otm() public {
        // Strike=$30, S=$20 (OTM: S <= K for a call)
        QuoteLib.Quote memory q = _buildCCQuote(30e18, 2 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.warp(standardExpiry + 24 hours + 1);

        uint256 takerWhypeBefore = whype.balanceOf(taker); // seller

        engine.expirePosition(posId);

        // Seller gets underlying back (2 WHYPE)
        assertEq(whype.balanceOf(taker) - takerWhypeBefore, 2 ether);
    }

    // ---------------------------------------------------------------
    // ITM Positions Cannot Be Expired (Must Be Settled)
    // ---------------------------------------------------------------

    function test_expire_itmPut_reverts() public {
        // Strike=$25, S=$20 (ITM put) — cannot expire, must settle
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.warp(standardExpiry + 24 hours + 1);

        vm.expectRevert(OptionsEngine.PositionNotOTM.selector);
        engine.expirePosition(posId);
    }

    function test_expire_itmCall_reverts() public {
        // Strike=$30, S=$50 (ITM call) — cannot expire
        QuoteLib.Quote memory q = _buildCCQuote(30e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 50e18);

        vm.warp(standardExpiry + 24 hours + 1);

        vm.expectRevert(OptionsEngine.PositionNotOTM.selector);
        engine.expirePosition(posId);
    }

    function test_expire_itmPosition_buyerCanStillSettle() public {
        // ITM position where seller tries to expire but cannot.
        // Buyer can still settle at any time.
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        // Way past settlement window
        vm.warp(standardExpiry + 30 days);

        // Seller tries to expire — fails because ITM
        vm.prank(taker);
        vm.expectRevert(OptionsEngine.PositionNotOTM.selector);
        engine.expirePosition(posId);

        // Buyer can still settle
        vm.prank(maker);
        engine.settle(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Settled));
    }

    // ---------------------------------------------------------------
    // Expire Requires Oracle Price
    // ---------------------------------------------------------------

    function test_expire_noOraclePrice_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        vm.warp(standardExpiry + 24 hours + 1);

        // No oracle price published
        vm.expectRevert(OptionsEngine.OraclePriceNotAvailable.selector);
        engine.expirePosition(posId);
    }

    // ---------------------------------------------------------------
    // ATM (S == K) — Treated as OTM for expiry, not ITM for settle
    // ---------------------------------------------------------------

    function test_settle_atm_csp_reverts() public {
        // S = K = $25 — at the money
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 25e18);

        // settle should revert because ATM is treated as OTM (S >= K for put)
        vm.prank(maker);
        vm.expectRevert(OptionsEngine.OptionNotITM.selector);
        engine.settle(posId);
    }

    function test_settle_atm_cc_reverts() public {
        QuoteLib.Quote memory q = _buildCCQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 25e18);

        vm.prank(maker);
        vm.expectRevert(OptionsEngine.OptionNotITM.selector);
        engine.settle(posId);
    }

    function test_expire_atm_succeeds() public {
        // ATM positions expire normally (S==K treated as OTM)
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 25e18);

        vm.warp(standardExpiry + 24 hours + 1);
        engine.expirePosition(posId);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(uint256(pos.state), uint256(OptionsEngine.PositionState.Expired));
    }

    // ---------------------------------------------------------------
    // Settlement Window Enforcement
    // ---------------------------------------------------------------

    function test_settle_beforeExpiry_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Don't warp to expiry
        vm.prank(maker);
        vm.expectRevert(OptionsEngine.NotBeforeExpiry.selector);
        engine.settle(posId);
    }

    function test_expire_withinSettlementWindow_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 30e18);

        // Warp to within settlement window (after expiry but before window end)
        vm.warp(standardExpiry + 12 hours);

        vm.expectRevert(OptionsEngine.SettlementWindowNotClosed.selector);
        engine.expirePosition(posId);
    }

    // ---------------------------------------------------------------
    // Oracle Dependency
    // ---------------------------------------------------------------

    function test_settle_oracleNotPublished_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        vm.warp(standardExpiry);
        // Don't publish oracle price

        vm.prank(maker);
        vm.expectRevert(OptionsEngine.OraclePriceNotAvailable.selector);
        engine.settle(posId);
    }

    // ---------------------------------------------------------------
    // Double Settlement / Expiry Prevention
    // ---------------------------------------------------------------

    function test_settle_alreadySettled_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.prank(maker);
        engine.settle(posId);

        vm.prank(maker);
        vm.expectRevert(OptionsEngine.PositionNotActive.selector);
        engine.settle(posId);
    }

    function test_expire_alreadyExpired_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 30e18); // OTM

        vm.warp(standardExpiry + 24 hours + 1);
        engine.expirePosition(posId);

        vm.expectRevert(OptionsEngine.PositionNotActive.selector);
        engine.expirePosition(posId);
    }

    function test_expire_alreadySettled_reverts() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.prank(maker);
        engine.settle(posId);

        vm.warp(standardExpiry + 24 hours + 1);
        vm.expectRevert(OptionsEngine.PositionNotActive.selector);
        engine.expirePosition(posId);
    }

    // ---------------------------------------------------------------
    // NFT Burning
    // ---------------------------------------------------------------

    function test_settle_burnsNFT() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        assertEq(engine.ownerOf(posId), maker); // buyer gets NFT

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.prank(maker);
        engine.settle(posId);

        vm.expectRevert(); // ERC721: owner query for nonexistent token
        engine.ownerOf(posId);
    }

    function test_expire_burnsNFT() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 30e18);

        vm.warp(standardExpiry + 24 hours + 1);
        engine.expirePosition(posId);

        vm.expectRevert();
        engine.ownerOf(posId);
    }

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    function test_settle_emitsPositionSettled() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        uint256 keeperFee = 25000; // ceil(25e6 * 10 / 10_000)

        // KeeperFeePaid emitted first
        vm.expectEmit(true, true, false, true);
        emit OptionsEngine.KeeperFeePaid(posId, maker, keeperFee);

        // Then PositionSettled (gross collateralXfer)
        vm.expectEmit(true, true, false, true);
        emit OptionsEngine.PositionSettled(posId, maker, 20e18, 1 ether, 25e6);

        vm.prank(maker);
        engine.settle(posId);
    }

    function test_expire_emitsPositionExpired() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 30e18);

        vm.warp(standardExpiry + 24 hours + 1);

        vm.expectEmit(true, false, true, true);
        emit OptionsEngine.PositionExpired(posId, 25e6, taker); // seller gets collateral

        engine.expirePosition(posId);
    }

    // ---------------------------------------------------------------
    // Collateral Math Edge Cases
    // ---------------------------------------------------------------

    function test_csp_collateral_roundsUp() public {
        // strike=$3 (3e18), qty=1/3 WHYPE, collateral=USDC(6 dec)
        // 3e18 * 333333333333333333 / 10^30 = 999999999999999999 / 10^30 → rounds up
        // Actually: product = 3e18 * 333333333333333333 = 999999999999999999e18 = ~1e36
        // divisor = 10^(18+18-6) = 10^30
        // 999999999999999999000000000000000000 / 10^30 = 999999999.999... → ceil = 1000000000? No...
        // Let's compute: 3e18 = 3000000000000000000, qty = 333333333333333333
        // product = 3000000000000000000 * 333333333333333333 = 999999999999999999000000000000000000
        // that's ~9.999e35
        // divisor = 1e30
        // quotient = 999999999.999... → ceil = 1000000000 = 1e9? That's 1000 USDC.
        // Actually $3 * 0.333... WHYPE ≈ $1, so ~1 USDC = 1e6. Let me recompute.
        // product = 3e18 * 333333333333333333 = 999999999999999999 * 1e18? No.
        // 3e18 = 3 * 10^18
        // qty = 333333333333333333 ≈ 0.333e18
        // product = 3 * 10^18 * 333333333333333333 = 3 * 333333333333333333 * 10^18
        //         = 999999999999999999 * 10^18 = 999999999999999999000000000000000000
        //         ≈ 10^36
        // divisor = 10^30
        // result = 999999999999999999000000000000000000 / 10^30 = 999999.999999999999
        // ceil = 1000000 = 1e6 = 1 USDC ✓
        QuoteLib.Quote memory q = _buildCSPQuote(3e18, 333333333333333333, 1e6);
        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, 1e6);
    }

    function test_csp_collateral_usdc6_exactDivision() public {
        // strike=$25, qty=2 WHYPE — should divide evenly
        // 25e18 * 2e18 / 10^30 = 50e36 / 10^30 = 50e6 exactly
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 2 ether, 1e6);
        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, 50e6);
    }

    function test_csp_collateral_usdh18_exactDivision() public {
        // strike=$25 (25e18), qty=2 WHYPE (2e18), collateral=USDH18(18 dec)
        // 25e18 * 2e18 / 10^(18+18-18) = 50e36 / 10^18 = 50e18
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 2 ether, 1e18);
        q.collateral = address(usdh18);
        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, 50e18);
    }

    // ---------------------------------------------------------------
    // Fuzz Tests — Collateral Math Cross-Decimal
    // ---------------------------------------------------------------

    function testFuzz_csp_collateral_usdc6(uint256 strike, uint256 qty) public {
        // Bound to reasonable ranges to avoid overflow
        strike = bound(strike, 1e16, 1_000_000e18); // $0.01 to $1M
        qty = bound(qty, 1e12, 1_000e18); // 0.000001 to 1000 WHYPE

        QuoteLib.Quote memory q = _buildCSPQuote(strike, qty, 1e6);

        // Compute expected collateral
        uint256 expected = CollateralMath.putCollateralRequired(strike, qty, 18, 6);

        // Ensure taker has enough collateral
        usdc.mint(taker, expected);
        // Ensure maker has enough for premium
        usdc.mint(maker, 1e6);

        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, expected);
    }

    function testFuzz_csp_collateral_usdh18(uint256 strike, uint256 qty) public {
        // Bound to reasonable ranges
        strike = bound(strike, 1e16, 1_000_000e18);
        qty = bound(qty, 1e12, 1_000e18);

        QuoteLib.Quote memory q = _buildCSPQuote(strike, qty, 1e18);
        q.collateral = address(usdh18);

        // Compute expected collateral
        uint256 expected = CollateralMath.putCollateralRequired(strike, qty, 18, 18);

        // Ensure participants have enough
        usdh18.mint(taker, expected);
        usdh18.mint(maker, 1e18);

        uint256 posId = _executeQuote(q);

        OptionsEngine.Position memory pos = engine.getPosition(posId);
        assertEq(pos.collateralLocked, expected);
    }

    function testFuzz_collateralMath_ceilDiv(uint256 strike, uint256 qty) public pure {
        // Just test the library directly
        strike = bound(strike, 1, 1_000_000e18);
        qty = bound(qty, 1, 1_000_000e18);

        // USDC (6 decimals)
        uint256 result6 = CollateralMath.putCollateralRequired(strike, qty, 18, 6);
        // Result should be >= floor division
        uint256 product = strike * qty;
        uint256 divisor = 10 ** 30; // 18 + 18 - 6
        uint256 floor = product / divisor;
        assertTrue(result6 >= floor);
        assertTrue(result6 <= floor + 1);

        // USDH18 (18 decimals)
        uint256 result18 = CollateralMath.putCollateralRequired(strike, qty, 18, 18);
        uint256 divisor18 = 10 ** 18;
        uint256 floor18 = product / divisor18;
        assertTrue(result18 >= floor18);
        assertTrue(result18 <= floor18 + 1);
    }

    // ---------------------------------------------------------------
    // Pause Does Not Affect Settlement/Expiry
    // ---------------------------------------------------------------

    function test_settle_whilePaused_succeeds() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        // Pause the engine
        vm.prank(owner);
        engine.pause();

        _publishPrice(address(whype), standardExpiry, 20e18);

        // Settlement should still work while paused
        vm.prank(maker);
        engine.settle(posId);
    }

    function test_expire_whilePaused_succeeds() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        vm.prank(owner);
        engine.pause();

        _publishPrice(address(whype), standardExpiry, 30e18);

        vm.warp(standardExpiry + 24 hours + 1);
        engine.expirePosition(posId);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Config
    // ---------------------------------------------------------------

    function test_keeperBps_default() public view {
        assertEq(engine.keeperBps(), 10);
    }

    function test_maxKeeperFee_defaults() public view {
        assertEq(engine.maxKeeperFee(address(usdc)), 5e6);
        assertEq(engine.maxKeeperFee(address(usdh)), 5e6);
        assertEq(engine.maxKeeperFee(address(usdh18)), 5e18);
    }

    function test_setKeeperBps_success() public {
        vm.prank(owner);
        engine.setKeeperBps(25);
        assertEq(engine.keeperBps(), 25);
    }

    function test_setKeeperBps_tooHigh_reverts() public {
        vm.prank(owner);
        vm.expectRevert(OptionsEngine.KeeperBpsTooHigh.selector);
        engine.setKeeperBps(51);
    }

    function test_setKeeperBps_maxAllowed() public {
        vm.prank(owner);
        engine.setKeeperBps(50);
        assertEq(engine.keeperBps(), 50);
    }

    function test_setKeeperBps_nonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setKeeperBps(25);
    }

    function test_setMaxKeeperFee_success() public {
        vm.prank(owner);
        engine.setMaxKeeperFee(address(usdc), 10e6);
        assertEq(engine.maxKeeperFee(address(usdc)), 10e6);
    }

    function test_setMaxKeeperFee_notAllowed_reverts() public {
        vm.prank(owner);
        vm.expectRevert(OptionsEngine.CollateralNotAllowed.selector);
        engine.setMaxKeeperFee(address(0x9999), 1e6);
    }

    function test_setMaxKeeperFee_tooHigh_reverts() public {
        vm.prank(owner);
        vm.expectRevert(OptionsEngine.MaxKeeperFeeTooHigh.selector);
        engine.setMaxKeeperFee(address(usdc), 51e6); // 51 USDC > 50 USDC cap
    }

    // ---------------------------------------------------------------
    // Keeper Fee — CSP Settlement
    // ---------------------------------------------------------------

    function test_keeper_csp_aliceReceivesFee() public {
        // Strike=$25, qty=1 WHYPE, premium=1 USDC
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18); // ITM

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        // Alice (third party keeper) settles
        vm.prank(alice);
        engine.settle(posId);

        // Keeper fee: notional=25e6, fee=ceil(25e6*10/10_000)=25000
        uint256 expectedFee = 25000;
        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, expectedFee);

        // Buyer receives collateral minus keeper fee
        assertEq(usdc.balanceOf(maker) - makerUsdcBefore, 25e6 - expectedFee);
    }

    function test_keeper_csp_feeEmitsEvent() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        vm.expectEmit(true, true, false, true);
        emit OptionsEngine.KeeperFeePaid(posId, alice, 25000);

        vm.prank(alice);
        engine.settle(posId);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — CC Settlement
    // ---------------------------------------------------------------

    function test_keeper_cc_aliceReceivesFee() public {
        // Strike=$30, qty=1 WHYPE, premium=2 USDC
        QuoteLib.Quote memory q = _buildCCQuote(30e18, 1 ether, 2e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 50e18); // ITM

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);
        uint256 makerWhypeBefore = whype.balanceOf(maker);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        vm.prank(alice);
        engine.settle(posId);

        // Keeper fee: notional=30e6, fee=ceil(30e6*10/10_000)=30000
        uint256 expectedFee = 30000;
        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, expectedFee);

        // Buyer paid grossCollateral to contract
        // Buyer net USDC change = -30e6 (paid to contract, no keeper rebate since alice is keeper)
        assertEq(makerUsdcBefore - usdc.balanceOf(maker), 30e6);
        // Buyer received 1 WHYPE
        assertEq(whype.balanceOf(maker) - makerWhypeBefore, 1 ether);
        // Seller received grossCollateral - keeperFee
        assertEq(usdc.balanceOf(taker) - takerUsdcBefore, 30e6 - expectedFee);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Capped at maxKeeperFee
    // ---------------------------------------------------------------

    function test_keeper_feeCappedAtMax() public {
        // Use a high strike to make uncapped fee > maxKeeperFee
        // Strike=$10000, qty=10 WHYPE: notional=100_000e6=100_000_000_000
        // Uncapped fee = ceil(100_000_000_000 * 10 / 10_000) = 100_000_000 = 100 USDC
        // maxKeeperFee(USDC) = 5e6 = 5 USDC → fee capped at 5e6
        QuoteLib.Quote memory q = _buildCSPQuote(10_000e18, 10 ether, 100e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 5000e18); // ITM

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        engine.settle(posId);

        // Fee should be capped at 5e6 (5 USDC)
        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, 5e6);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Zero when keeperBps is zero
    // ---------------------------------------------------------------

    function test_keeper_zeroBps_noFee() public {
        // Set keeperBps to 0
        vm.prank(owner);
        engine.setKeeperBps(0);

        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18);

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        vm.prank(alice);
        engine.settle(posId);

        // No keeper fee
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore);
        // Buyer gets full collateral
        assertEq(usdc.balanceOf(maker) - makerUsdcBefore, 25e6);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Does Not Affect Expiry
    // ---------------------------------------------------------------

    function test_expire_noKeeperFee() public {
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 30e18); // OTM

        vm.warp(standardExpiry + 24 hours + 1);

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        vm.prank(alice);
        engine.expirePosition(posId);

        // Alice (expirer) gets NO keeper fee
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore);
        // Seller gets full collateral back
        assertEq(usdc.balanceOf(taker) - takerUsdcBefore, 25e6);
    }

    function test_expire_cc_noKeeperFee() public {
        QuoteLib.Quote memory q = _buildCCQuote(30e18, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18); // OTM

        vm.warp(standardExpiry + 24 hours + 1);

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 takerWhypeBefore = whype.balanceOf(taker);

        vm.prank(alice);
        engine.expirePosition(posId);

        // Alice gets no fee
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore);
        // Seller gets underlying back
        assertEq(whype.balanceOf(taker) - takerWhypeBefore, 1 ether);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Net Payouts Correct (CSP detailed)
    // ---------------------------------------------------------------

    function test_keeper_csp_netPayoutsCorrect() public {
        // Strike=$100, qty=5 WHYPE, premium=10 USDC
        // notional = 100e18 * 5e18 / 10^30 = 500e6
        // fee = ceil(500e6 * 10 / 10_000) = 500_000 (0.5 USDC)
        // maxFee = 5e6, so uncapped
        QuoteLib.Quote memory q = _buildCSPQuote(100e18, 5 ether, 10e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 50e18); // ITM

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);
        uint256 makerWhypeBefore = whype.balanceOf(maker);
        uint256 takerWhypeBefore = whype.balanceOf(taker);

        vm.prank(alice);
        engine.settle(posId);

        uint256 expectedFee = 500_000; // 0.5 USDC
        uint256 collateralLocked = 500e6; // 100 * 5 USDC

        // Keeper gets fee
        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, expectedFee);
        // Buyer gets collateral minus fee
        assertEq(usdc.balanceOf(maker) - makerUsdcBefore, collateralLocked - expectedFee);
        // Buyer delivered 5 WHYPE
        assertEq(makerWhypeBefore - whype.balanceOf(maker), 5 ether);
        // Seller received 5 WHYPE
        assertEq(whype.balanceOf(taker) - takerWhypeBefore, 5 ether);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Net Payouts Correct (CC detailed)
    // ---------------------------------------------------------------

    function test_keeper_cc_netPayoutsCorrect() public {
        // Strike=$50, qty=2 WHYPE, premium=5 USDC
        // notional = 50e18 * 2e18 / 10^30 = 100e6
        // fee = ceil(100e6 * 10 / 10_000) = 100_000 (0.1 USDC)
        QuoteLib.Quote memory q = _buildCCQuote(50e18, 2 ether, 5e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 80e18); // ITM

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);
        uint256 makerWhypeBefore = whype.balanceOf(maker);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        vm.prank(alice);
        engine.settle(posId);

        uint256 grossCollateral = 100e6; // 50 * 2 USDC
        uint256 expectedFee = 100_000; // 0.1 USDC

        // Keeper gets fee
        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, expectedFee);
        // Buyer paid full grossCollateral
        assertEq(makerUsdcBefore - usdc.balanceOf(maker), grossCollateral);
        // Buyer received 2 WHYPE
        assertEq(whype.balanceOf(maker) - makerWhypeBefore, 2 ether);
        // Seller received grossCollateral - fee
        assertEq(usdc.balanceOf(taker) - takerUsdcBefore, grossCollateral - expectedFee);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Fee Does Not Exceed Seller Collateral
    // ---------------------------------------------------------------

    function test_keeper_feeCannotExceedSellerCollateral() public {
        // Set very high keeperBps (max 50) and very high maxKeeperFee
        vm.startPrank(owner);
        engine.setKeeperBps(50);
        engine.setMaxKeeperFee(address(usdc), 50e6); // 50 USDC max
        vm.stopPrank();

        // Small strike to make collateral small
        // Strike=$0.01 (1e16), qty=1 WHYPE
        // notional = 1e16 * 1e18 / 10^30 = 1e34 / 10^30 = 10_000 (0.01 USDC)
        // fee = ceil(10_000 * 50 / 10_000) = ceil(50) = 50 (0.00005 USDC)
        // collateralLocked = 10_000 (0.01 USDC)
        // fee (50) < collateralLocked (10_000) → safe
        QuoteLib.Quote memory q = _buildCSPQuote(1e16, 1 ether, 1e6);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 1e15); // ITM (S=$0.001 < K=$0.01)

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        vm.prank(alice);
        engine.settle(posId);

        uint256 expectedFee = 50;
        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, expectedFee);
        // Buyer gets collateral minus fee
        uint256 collateralLocked = 10_000; // ceil(1e16 * 1e18 / 10^30) = ceil(10_000) = 10_000
        assertEq(usdc.balanceOf(maker) - makerUsdcBefore, collateralLocked - expectedFee);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Fuzz Tests
    // ---------------------------------------------------------------

    function testFuzz_keeper_csp_feeCorrect(uint256 strike, uint256 qty) public {
        strike = bound(strike, 1e16, 10_000e18); // $0.01 to $10,000
        qty = bound(qty, 1e12, 100e18); // 0.000001 to 100 WHYPE

        QuoteLib.Quote memory q = _buildCSPQuote(strike, qty, 1e6);

        // Compute collateral needed
        uint256 collateral = CollateralMath.putCollateralRequired(strike, qty, 18, 6);
        // Ensure taker has enough
        usdc.mint(taker, collateral);
        usdc.mint(maker, 1e6);

        uint256 posId = _executeQuote(q);

        // Publish ITM price (half of strike)
        uint256 itmPrice = strike / 2;
        if (itmPrice == 0) itmPrice = 1; // ensure > 0
        // Ensure it's actually ITM (S < K for put)
        if (itmPrice >= strike) itmPrice = strike - 1;

        _publishPrice(address(whype), standardExpiry, itmPrice);

        // Compute expected keeper fee
        uint256 notionalVal = CollateralMath.notional(strike, qty, 18, 6);
        uint256 uncappedFee = CollateralMath.ceilDiv(notionalVal * 10, 10_000);
        uint256 expectedFee = uncappedFee;
        if (expectedFee > 5e6) expectedFee = 5e6; // maxKeeperFee cap
        if (expectedFee > collateral) expectedFee = collateral; // solvency cap

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        engine.settle(posId);

        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, expectedFee);
    }

    function testFuzz_keeper_cc_feeCorrect(uint256 strike, uint256 qty) public {
        strike = bound(strike, 1e16, 10_000e18);
        qty = bound(qty, 1e12, 100e18);

        QuoteLib.Quote memory q = _buildCCQuote(strike, qty, 1e6);

        // Ensure taker has enough underlying
        whype.mint(taker, qty);
        // Ensure buyer has enough collateral for settlement (strike×qty in USDC)
        uint256 grossCollateral = CollateralMath.callSettlementCost(strike, qty, 18, 6);
        usdc.mint(maker, grossCollateral);

        uint256 posId = _executeQuote(q);

        // Publish ITM price (double the strike)
        uint256 itmPrice = strike * 2;
        if (itmPrice <= strike) itmPrice = strike + 1; // handle overflow edge

        _publishPrice(address(whype), standardExpiry, itmPrice);

        // Compute expected keeper fee
        uint256 notionalVal = CollateralMath.notional(strike, qty, 18, 6);
        uint256 uncappedFee = CollateralMath.ceilDiv(notionalVal * 10, 10_000);
        uint256 expectedFee = uncappedFee;
        if (expectedFee > 5e6) expectedFee = 5e6;
        if (expectedFee > grossCollateral) expectedFee = grossCollateral;

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        engine.settle(posId);

        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, expectedFee);
    }

    // ---------------------------------------------------------------
    // Keeper Fee — Cross-Decimal (18-dec collateral)
    // ---------------------------------------------------------------

    function test_keeper_csp_usdh18_feeCorrect() public {
        // Strike=$25, qty=1 WHYPE, collateral=USDH18 (18 decimals)
        // notional = 25e18 * 1e18 / 10^(18+18-18) = 25e36/10^18 = 25e18
        // fee = ceil(25e18 * 10 / 10_000) = 25e15 = 0.025 USDH18
        QuoteLib.Quote memory q = _buildCSPQuote(25e18, 1 ether, 1e18);
        q.collateral = address(usdh18);
        uint256 posId = _executeQuote(q);

        _publishPrice(address(whype), standardExpiry, 20e18); // ITM

        uint256 aliceUsdh18Before = usdh18.balanceOf(alice);
        uint256 makerUsdh18Before = usdh18.balanceOf(maker);

        vm.prank(alice);
        engine.settle(posId);

        uint256 expectedFee = 25e15; // 0.025 USDH18
        uint256 collateralLocked = 25e18; // 25 USDH18

        assertEq(usdh18.balanceOf(alice) - aliceUsdh18Before, expectedFee);
        assertEq(usdh18.balanceOf(maker) - makerUsdh18Before, collateralLocked - expectedFee);
    }
}
