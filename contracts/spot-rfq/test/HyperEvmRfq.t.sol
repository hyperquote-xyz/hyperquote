// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {HyperEvmRfq} from "../src/HyperEvmRfq.sol";
import {ERC20Mock} from "./mocks/ERC20Mock.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract HyperEvmRfqTest is Test {

event MakerNonceIncremented(address indexed maker, uint256 newNonce);
event FeeParamsUpdated(address feeRecipient, uint32 feePips);
event TokenDenied(address indexed token, bool denied);
event QuoteFilled(
    bytes32 indexed quoteHash,
    address indexed maker,
    address indexed taker,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOut,
    uint256 feeAmountIn
);



    HyperEvmRfq public rfq;
    ERC20Mock public tokenA;
    ERC20Mock public tokenB;

    address public owner;
    address public feeRecipient;
    
    // Maker and taker with known private keys for signing
    uint256 public makerPrivateKey = 0xA11CE;
    uint256 public takerPrivateKey = 0xB0B;
    address public maker;
    address public taker;
    
    uint32 public constant FEE_PIPS = 250; // 2.5 bps
    uint256 public constant INITIAL_BALANCE = 1_000_000e18;

    // EIP-712 constants (must match contract)
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(uint8 kind,address maker,address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 expiry,uint256 nonce)"
    );

    function setUp() public {
        owner = makeAddr("owner");
        feeRecipient = makeAddr("feeRecipient");
        maker = vm.addr(makerPrivateKey);
        taker = vm.addr(takerPrivateKey);

        // Deploy contract
        vm.prank(owner);
        rfq = new HyperEvmRfq(owner, feeRecipient, FEE_PIPS);

        // Deploy mock tokens
        tokenA = new ERC20Mock("Token A", "TKNA");
        tokenB = new ERC20Mock("Token B", "TKNB");

        // Mint tokens
        tokenA.mint(taker, INITIAL_BALANCE);
        tokenB.mint(maker, INITIAL_BALANCE);

        // Approve RFQ contract
        vm.prank(taker);
        tokenA.approve(address(rfq), type(uint256).max);
        
        vm.prank(maker);
        tokenB.approve(address(rfq), type(uint256).max);
    }

    // ============ Helper Functions ============

    function _createQuote(
        HyperEvmRfq.QuoteKind kind,
        address _taker,
        uint256 amountIn,
        uint256 amountOut,
        uint256 expiry
    ) internal returns (HyperEvmRfq.Quote memory) {
        return HyperEvmRfq.Quote({
            kind: kind,
            maker: maker,
            taker: _taker,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            amountOut: amountOut,
            expiry: expiry,
            nonce: rfq.makerNonce(maker)
        });
    }

    function _signQuote(HyperEvmRfq.Quote memory quote, uint256 privateKey) internal returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                uint8(quote.kind),
                quote.maker,
                quote.taker,
                quote.tokenIn,
                quote.tokenOut,
                quote.amountIn,
                quote.amountOut,
                quote.expiry,
                quote.nonce
            )
        );
        
        bytes32 digest = MessageHashUtils.toTypedDataHash(rfq.DOMAIN_SEPARATOR(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _quoteToCalldata(HyperEvmRfq.Quote memory quote) internal pure returns (HyperEvmRfq.Quote memory) {
        // This is a workaround - we'll just use memory quotes and pass them directly
        // The contract accepts calldata but Solidity will handle the conversion
        return quote;
    }

    // ============ Happy Path Tests ============

    function test_fillExactIn_happyPath_minOutZero() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        uint256 takerTokenABefore = tokenA.balanceOf(taker);
        uint256 takerTokenBBefore = tokenB.balanceOf(taker);
        uint256 makerTokenABefore = tokenA.balanceOf(maker);
        uint256 makerTokenBBefore = tokenB.balanceOf(maker);
        uint256 feeRecipientBefore = tokenA.balanceOf(feeRecipient);

        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0); // minOut = 0

        // Calculate expected fee
        uint256 expectedFee = (amountIn * FEE_PIPS) / 1_000_000;
        uint256 makerReceives = amountIn - expectedFee;

        // Verify balances
        assertEq(tokenA.balanceOf(taker), takerTokenABefore - amountIn, "Taker tokenA balance");
        assertEq(tokenB.balanceOf(taker), takerTokenBBefore + amountOut, "Taker tokenB balance");
        assertEq(tokenA.balanceOf(maker), makerTokenABefore + makerReceives, "Maker tokenA balance");
        assertEq(tokenB.balanceOf(maker), makerTokenBBefore - amountOut, "Maker tokenB balance");
        assertEq(tokenA.balanceOf(feeRecipient), feeRecipientBefore + expectedFee, "FeeRecipient balance");
    }

    function test_fillExactOut_happyPath_maxInMax() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_OUT,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        uint256 takerTokenABefore = tokenA.balanceOf(taker);
        uint256 takerTokenBBefore = tokenB.balanceOf(taker);

        vm.prank(taker);
        rfq.fillExactOut(quote, sig, type(uint256).max); // maxIn = max

        uint256 expectedFee = (amountIn * FEE_PIPS) / 1_000_000;

        assertEq(tokenA.balanceOf(taker), takerTokenABefore - amountIn, "Taker tokenA");
        assertEq(tokenB.balanceOf(taker), takerTokenBBefore + amountOut, "Taker tokenB");
        assertEq(tokenA.balanceOf(feeRecipient), expectedFee, "Fee collected");
    }

    // ============ MinOut / MaxIn Check Tests ============

    function test_fillExactIn_revert_minOutNotMet() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.MinOutNotMet.selector);
        rfq.fillExactIn(quote, sig, amountOut + 1); // minOut > amountOut
    }

    function test_fillExactOut_revert_maxInExceeded() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_OUT,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.MaxInExceeded.selector);
        rfq.fillExactOut(quote, sig, amountIn - 1); // maxIn < amountIn
    }

    // ============ Taker Restriction Tests ============

    function test_takerRestriction_correctTaker() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker, // Restricted to specific taker
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0);

        // Should succeed - verified by no revert
        assertEq(tokenB.balanceOf(taker), amountOut);
    }

    function test_takerRestriction_wrongTaker_reverts() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        address wrongTaker = makeAddr("wrongTaker");
        
        // Setup wrong taker with tokens
        tokenA.mint(wrongTaker, INITIAL_BALANCE);
        vm.prank(wrongTaker);
        tokenA.approve(address(rfq), type(uint256).max);

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker, // Restricted to original taker
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(wrongTaker);
        vm.expectRevert(HyperEvmRfq.TakerNotAllowed.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    // ============ Maker Nonce Tests ============

    function test_makerNonce_invalidatesOldQuotes() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        // Create quote with current nonce (0)
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        // Maker cancels all quotes
        vm.prank(maker);
        rfq.cancelAllQuotes();

        // Verify nonce incremented
        assertEq(rfq.makerNonce(maker), 1);

        // Try to fill old quote - should revert
        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.InvalidNonce.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    function test_cancelAllQuotes_emitsEvent() public {
        vm.prank(maker);
        vm.expectEmit(true, false, false, true);
        emit MakerNonceIncremented(maker, 1);
        rfq.cancelAllQuotes();
    }

    // ============ Replay Protection Tests ============

    function test_replayProtection_secondFillReverts() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        // First fill succeeds
        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0);

        // Mint more tokens to taker so balance isn't the issue
        tokenA.mint(taker, amountIn);
        tokenB.mint(maker, amountOut);

        // Second fill with same quote reverts
        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.QuoteAlreadyUsed.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    // ============ Denylist Tests ============

    function test_denylist_tokenInDenied_reverts() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        // Deny tokenIn
        vm.prank(owner);
        rfq.setTokenDenied(address(tokenA), true);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.TokenDeniedError.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    function test_denylist_tokenOutDenied_reverts() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        // Deny tokenOut
        vm.prank(owner);
        rfq.setTokenDenied(address(tokenB), true);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.TokenDeniedError.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    function test_denylist_canBeRemoved() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        // Deny then un-deny tokenA
        vm.startPrank(owner);
        rfq.setTokenDenied(address(tokenA), true);
        rfq.setTokenDenied(address(tokenA), false);
        vm.stopPrank();

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        // Should succeed now
        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0);

        assertEq(tokenB.balanceOf(taker), amountOut);
    }

    // ============ Fee Math Tests ============

    function test_feeMath_correctness() public {
        uint256 amountIn = 1_000_000e18; // Large amount for precision
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        // Mint extra tokens
        tokenA.mint(taker, amountIn);

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        uint256 makerBefore = tokenA.balanceOf(maker);
        uint256 feeRecipientBefore = tokenA.balanceOf(feeRecipient);

        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0);

        // fee = amountIn * 250 / 1_000_000 = amountIn * 0.00025
        uint256 expectedFee = (amountIn * 250) / 1_000_000;
        uint256 expectedMakerReceives = amountIn - expectedFee;

        assertEq(tokenA.balanceOf(feeRecipient) - feeRecipientBefore, expectedFee, "Fee amount");
        assertEq(tokenA.balanceOf(maker) - makerBefore, expectedMakerReceives, "Maker receives");
        
        // Verify the math: 1_000_000e18 * 250 / 1_000_000 = 250e18
        assertEq(expectedFee, 250e18, "Fee calculation verification");
    }

    function test_feeMath_smallAmount() public {
        // Test with small amount where fee might be 0
        uint256 amountIn = 1000; // Very small - fee = 1000 * 250 / 1_000_000 = 0.25 = 0 (truncated)
        uint256 amountOut = 500;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        uint256 makerBefore = tokenA.balanceOf(maker);
        uint256 feeRecipientBefore = tokenA.balanceOf(feeRecipient);

        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0);

        uint256 expectedFee = (amountIn * 250) / 1_000_000; // = 0
        assertEq(tokenA.balanceOf(feeRecipient) - feeRecipientBefore, expectedFee);
        assertEq(tokenA.balanceOf(maker) - makerBefore, amountIn - expectedFee);
    }

    // ============ Validation Tests ============

    function test_validation_expiredQuote_reverts() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp - 1; // Already expired

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.QuoteExpired.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    function test_validation_zeroAmountIn_reverts() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            0, // Zero amountIn
            500e18,
            block.timestamp + 1 hours
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.InvalidAmountIn.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    function test_validation_zeroAmountOut_reverts() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            1000e18,
            0, // Zero amountOut
            block.timestamp + 1 hours
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.InvalidAmountOut.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    function test_validation_invalidSignature_reverts() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            1000e18,
            500e18,
            block.timestamp + 1 hours
        );
        
        // Sign with wrong private key
        bytes memory badSig = _signQuote(quote, takerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.InvalidSignature.selector);
        rfq.fillExactIn(quote, badSig, 0);
    }

    function test_validation_wrongQuoteKind_exactIn_reverts() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_OUT, // Wrong kind for fillExactIn
            taker,
            1000e18,
            500e18,
            block.timestamp + 1 hours
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.WrongQuoteKind.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    function test_validation_wrongQuoteKind_exactOut_reverts() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN, // Wrong kind for fillExactOut
            taker,
            1000e18,
            500e18,
            block.timestamp + 1 hours
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.WrongQuoteKind.selector);
        rfq.fillExactOut(quote, sig, type(uint256).max);
    }

    // ============ Admin Tests ============

    function test_admin_setFeeParams() public {
        address newFeeRecipient = makeAddr("newFeeRecipient");
        uint32 newFeePips = 500; // 5 bps

        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit FeeParamsUpdated(newFeeRecipient, newFeePips);
        rfq.setFeeParams(newFeeRecipient, newFeePips);

        assertEq(rfq.feeRecipient(), newFeeRecipient);
        assertEq(rfq.feePips(), newFeePips);
    }

    function test_admin_setFeeParams_zeroRecipient_reverts() public {
        vm.prank(owner);
        vm.expectRevert(HyperEvmRfq.InvalidFeeRecipient.selector);
        rfq.setFeeParams(address(0), 250);
    }

    function test_admin_setFeeParams_feeTooHigh_reverts() public {
        vm.prank(owner);
        vm.expectRevert(HyperEvmRfq.FeeTooHigh.selector);
        rfq.setFeeParams(feeRecipient, 10_001); // > 1%
    }

    function test_admin_setFeeParams_onlyOwner() public {
        vm.prank(makeAddr("notOwner"));
        vm.expectRevert();
        rfq.setFeeParams(feeRecipient, 500);
    }

    function test_admin_setTokenDenied_onlyOwner() public {
        vm.prank(makeAddr("notOwner"));
        vm.expectRevert();
        rfq.setTokenDenied(address(tokenA), true);
    }

    function test_admin_setTokenDenied_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit TokenDenied(address(tokenA), true);
        rfq.setTokenDenied(address(tokenA), true);
    }

    // ============ View Function Tests ============

    function test_getQuoteHash() public  {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            1000e18,
            500e18,
            block.timestamp + 1 hours
        );

        bytes32 hash = rfq.getQuoteHash(quote);
        assertTrue(hash != bytes32(0));
    }

    function test_domainSeparator() public  {
        bytes32 separator = rfq.DOMAIN_SEPARATOR();
        assertTrue(separator != bytes32(0));
    }

    // ============ Event Tests ============

    function test_quoteFilled_emitsEvent() public {
        uint256 amountIn = 1000e18;
        uint256 amountOut = 500e18;
        uint256 expiry = block.timestamp + 1 hours;

        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            amountIn,
            amountOut,
            expiry
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        bytes32 expectedHash = rfq.getQuoteHash(quote);
        uint256 expectedFee = (amountIn * FEE_PIPS) / 1_000_000;

        vm.prank(taker);
        vm.expectEmit(true, true, true, true);
        emit QuoteFilled(
            expectedHash,
            maker,
            taker,
            address(tokenA),
            address(tokenB),
            amountIn,
            amountOut,
            expectedFee
        );
        rfq.fillExactIn(quote, sig, 0);
    }

    // ============ Hardening Tests ============

    /// @notice address(0) taker now reverts (no open/wildcard quotes)
    function test_hardening_zeroTaker_exactIn_reverts() public {
        HyperEvmRfq.Quote memory quote = HyperEvmRfq.Quote({
            kind: HyperEvmRfq.QuoteKind.EXACT_IN,
            maker: maker,
            taker: address(0), // open quote — must be rejected
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000e18,
            amountOut: 500e18,
            expiry: block.timestamp + 1 hours,
            nonce: rfq.makerNonce(maker)
        });
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.TakerNotAllowed.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    /// @notice address(0) taker also reverts on ExactOut path
    function test_hardening_zeroTaker_exactOut_reverts() public {
        HyperEvmRfq.Quote memory quote = HyperEvmRfq.Quote({
            kind: HyperEvmRfq.QuoteKind.EXACT_OUT,
            maker: maker,
            taker: address(0),
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1000e18,
            amountOut: 500e18,
            expiry: block.timestamp + 1 hours,
            nonce: rfq.makerNonce(maker)
        });
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.TakerNotAllowed.selector);
        rfq.fillExactOut(quote, sig, type(uint256).max);
    }

    /// @notice tokenIn == tokenOut reverts with SameTokenPair
    function test_hardening_selfSwap_reverts() public {
        HyperEvmRfq.Quote memory quote = HyperEvmRfq.Quote({
            kind: HyperEvmRfq.QuoteKind.EXACT_IN,
            maker: maker,
            taker: taker,
            tokenIn: address(tokenA),
            tokenOut: address(tokenA), // same token — must be rejected
            amountIn: 1000e18,
            amountOut: 500e18,
            expiry: block.timestamp + 1 hours,
            nonce: rfq.makerNonce(maker)
        });
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.SameTokenPair.selector);
        rfq.fillExactIn(quote, sig, 0);
    }

    /// @notice Self-swap check also fires on ExactOut path
    function test_hardening_selfSwap_exactOut_reverts() public {
        HyperEvmRfq.Quote memory quote = HyperEvmRfq.Quote({
            kind: HyperEvmRfq.QuoteKind.EXACT_OUT,
            maker: maker,
            taker: taker,
            tokenIn: address(tokenB),
            tokenOut: address(tokenB), // same token
            amountIn: 1000e18,
            amountOut: 500e18,
            expiry: block.timestamp + 1 hours,
            nonce: rfq.makerNonce(maker)
        });
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        vm.prank(taker);
        vm.expectRevert(HyperEvmRfq.SameTokenPair.selector);
        rfq.fillExactOut(quote, sig, type(uint256).max);
    }

    /// @notice Valid taker-bound ExactIn still settles correctly after hardening
    function test_hardening_takerBound_exactIn_fills() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,
            1000e18,
            500e18,
            block.timestamp + 1 hours
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        uint256 takerBBefore = tokenB.balanceOf(taker);

        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0);

        assertEq(tokenB.balanceOf(taker), takerBBefore + 500e18, "taker received amountOut");
    }

    /// @notice Valid taker-bound ExactOut still settles correctly after hardening
    function test_hardening_takerBound_exactOut_fills() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_OUT,
            taker,
            1000e18,
            500e18,
            block.timestamp + 1 hours
        );
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        uint256 takerBBefore = tokenB.balanceOf(taker);

        vm.prank(taker);
        rfq.fillExactOut(quote, sig, type(uint256).max);

        assertEq(tokenB.balanceOf(taker), takerBBefore + 500e18, "taker received amountOut");
    }

    // ============ E2E Cross-Validation Test ============

    /**
     * @notice Proves the full EIP-712 signing + on-chain settlement flow:
     *   1. Cross-validates manual EIP-712 digest == on-chain getQuoteHash()
     *   2. Signs the digest (identical to wallet signTypedData)
     *   3. Fills on-chain — no InvalidSignature
     *   4. Verifies all balances including fee distribution
     */
    function test_e2e_signTypedData_fillExactIn_settles() public {
        HyperEvmRfq.Quote memory quote = _createQuote(
            HyperEvmRfq.QuoteKind.EXACT_IN,
            taker,       // taker-bound (not address(0))
            1000e18,     // amountIn
            500e18,      // amountOut
            block.timestamp + 1 hours
        );

        // Cross-validate: manual EIP-712 hash == on-chain getQuoteHash
        bytes32 manualDigest = MessageHashUtils.toTypedDataHash(
            rfq.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                QUOTE_TYPEHASH,
                uint8(quote.kind), quote.maker, quote.taker,
                quote.tokenIn, quote.tokenOut,
                quote.amountIn, quote.amountOut,
                quote.expiry, quote.nonce
            ))
        );
        assertEq(manualDigest, rfq.getQuoteHash(quote), "EIP-712 digest mismatch");

        // Sign (identical to wallet signTypedData) and fill
        bytes memory sig = _signQuote(quote, makerPrivateKey);

        // Snapshot balances before fill
        uint256[4] memory before = [
            tokenA.balanceOf(taker),
            tokenB.balanceOf(taker),
            tokenA.balanceOf(maker),
            tokenA.balanceOf(feeRecipient)
        ];

        vm.prank(taker);
        rfq.fillExactIn(quote, sig, 0);

        // Verify settlement — no InvalidSignature, correct balances
        uint256 fee = (quote.amountIn * FEE_PIPS) / 1_000_000;
        assertEq(tokenA.balanceOf(taker), before[0] - quote.amountIn, "taker paid amountIn");
        assertEq(tokenB.balanceOf(taker), before[1] + quote.amountOut, "taker received amountOut");
        assertEq(tokenA.balanceOf(maker), before[2] + (quote.amountIn - fee), "maker received net");
        assertEq(tokenA.balanceOf(feeRecipient), before[3] + fee, "fee collected");
    }
}
