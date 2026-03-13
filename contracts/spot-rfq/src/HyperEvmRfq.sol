// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title HyperEvmRfq
 * @notice Permissionless RFQ settlement contract for atomic ERC-20 swaps on HyperEVM
 * @dev Supports Exact-In and Exact-Out order styles with EIP-712 signed maker quotes
 */
contract HyperEvmRfq is EIP712, Ownable2Step {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum QuoteKind {
        EXACT_IN,
        EXACT_OUT
    }

    // ============ Structs ============

    /**
     * @notice Quote structure signed by makers
     * @param kind EXACT_IN or EXACT_OUT
     * @param maker Address of the market maker
     * @param taker Required taker address — must match msg.sender (address(0) is rejected)
     * @param tokenIn Token the taker pays
     * @param tokenOut Token the taker receives
     * @param amountIn Amount of tokenIn
     * @param amountOut Amount of tokenOut
     * @param expiry Timestamp when quote expires
     * @param nonce Must match maker's current nonce
     */
    struct Quote {
        QuoteKind kind;
        address maker;
        address taker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 expiry;
        uint256 nonce;
    }

    // ============ Constants ============

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(uint8 kind,address maker,address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 expiry,uint256 nonce)"
    );

    uint32 public constant MAX_FEE_PIPS = 10_000; // 1% max fee

    // ============ State Variables ============

    /// @notice Fee in pips (parts per million). 250 = 2.5 bps = 0.025%
    uint32 public feePips;

    /// @notice Address that receives protocol fees
    address public feeRecipient;

    /// @notice Maker nonce for canceling all outstanding quotes
    mapping(address => uint256) public makerNonce;

    /// @notice Tracks used quote hashes for replay protection
    mapping(bytes32 => bool) public quoteUsed;

    /// @notice Denied tokens that cannot be traded
    mapping(address => bool) public tokenDenied;

    // ============ Events ============

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

    event MakerNonceIncremented(address indexed maker, uint256 newNonce);

    event FeeParamsUpdated(address feeRecipient, uint32 feePips);

    event TokenDenied(address indexed token, bool denied);

    // ============ Errors ============

    error InvalidMaker();
    error InvalidTokenIn();
    error InvalidTokenOut();
    error InvalidAmountIn();
    error InvalidAmountOut();
    error QuoteExpired();
    error InvalidNonce();
    error QuoteAlreadyUsed();
    error InvalidSignature();
    error TakerNotAllowed();
    error SameTokenPair();
    error TokenDeniedError();
    error MinOutNotMet();
    error MaxInExceeded();
    error InvalidFeeRecipient();
    error FeeTooHigh();
    error WrongQuoteKind();

    // ============ Constructor ============

    /**
     * @notice Initialize the RFQ contract
     * @param _owner Contract owner address
     * @param _feeRecipient Address to receive fees
     * @param _feePips Fee in pips (250 = 2.5 bps)
     */
    constructor(
        address _owner,
        address _feeRecipient,
        uint32 _feePips
    ) EIP712("HyperQuote", "1") Ownable(_owner) {
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();
        if (_feePips > MAX_FEE_PIPS) revert FeeTooHigh();
        
        feeRecipient = _feeRecipient;
        feePips = _feePips;

        emit FeeParamsUpdated(_feeRecipient, _feePips);
    }

    // ============ External Functions ============

    /**
     * @notice Fill an Exact-In quote (taker pays fixed amountIn, receives amountOut)
     * @param quote The maker's signed quote
     * @param makerSig EIP-712 signature from maker
     * @param minOut Minimum tokenOut taker will accept (0 for no minimum)
     */
    function fillExactIn(
        Quote calldata quote,
        bytes calldata makerSig,
        uint256 minOut
    ) external {
        if (quote.kind != QuoteKind.EXACT_IN) revert WrongQuoteKind();
        if (quote.amountOut < minOut) revert MinOutNotMet();
        
        _fill(quote, makerSig);
    }

    /**
     * @notice Fill an Exact-Out quote (taker receives fixed amountOut, pays amountIn)
     * @param quote The maker's signed quote
     * @param makerSig EIP-712 signature from maker
     * @param maxIn Maximum tokenIn taker will pay (type(uint256).max for no cap)
     */
    function fillExactOut(
        Quote calldata quote,
        bytes calldata makerSig,
        uint256 maxIn
    ) external {
        if (quote.kind != QuoteKind.EXACT_OUT) revert WrongQuoteKind();
        if (quote.amountIn > maxIn) revert MaxInExceeded();
        
        _fill(quote, makerSig);
    }

    /**
     * @notice Cancel all outstanding quotes by incrementing maker nonce
     */
    function cancelAllQuotes() external {
        uint256 newNonce = ++makerNonce[msg.sender];
        emit MakerNonceIncremented(msg.sender, newNonce);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update fee parameters (owner only)
     * @param _feeRecipient New fee recipient address
     * @param _feePips New fee in pips
     */
    function setFeeParams(address _feeRecipient, uint32 _feePips) external onlyOwner {
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();
        if (_feePips > MAX_FEE_PIPS) revert FeeTooHigh();
        
        feeRecipient = _feeRecipient;
        feePips = _feePips;

        emit FeeParamsUpdated(_feeRecipient, _feePips);
    }

    /**
     * @notice Add or remove a token from the denylist (owner only)
     * @param token Token address
     * @param denied True to deny, false to allow
     */
    function setTokenDenied(address token, bool denied) external onlyOwner {
        tokenDenied[token] = denied;
        emit TokenDenied(token, denied);
    }

    // ============ View Functions ============

    /**
     * @notice Compute the EIP-712 hash of a quote
     * @param quote The quote to hash
     * @return The typed data hash
     */
    function getQuoteHash(Quote calldata quote) external view returns (bytes32) {
        return _hashTypedDataV4(_quoteStructHash(quote));
    }

    /**
     * @notice Get the EIP-712 domain separator
     * @return The domain separator
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============ Internal Functions ============

    /**
     * @notice Internal fill logic shared by fillExactIn and fillExactOut
     * @param quote The validated quote
     * @param makerSig The maker's signature
     */
    function _fill(Quote calldata quote, bytes calldata makerSig) internal {
        // Validate quote fields
        if (quote.maker == address(0)) revert InvalidMaker();
        if (quote.tokenIn == address(0)) revert InvalidTokenIn();
        if (quote.tokenOut == address(0)) revert InvalidTokenOut();
        if (quote.tokenIn == quote.tokenOut) revert SameTokenPair();
        if (quote.amountIn == 0) revert InvalidAmountIn();
        if (quote.amountOut == 0) revert InvalidAmountOut();
        if (block.timestamp > quote.expiry) revert QuoteExpired();
        if (quote.nonce != makerNonce[quote.maker]) revert InvalidNonce();

        // Enforce taker-bound quotes — open quotes (address(0)) are not allowed
        if (quote.taker == address(0) || quote.taker != msg.sender) {
            revert TakerNotAllowed();
        }

        // Check token denylist
        if (tokenDenied[quote.tokenIn]) revert TokenDeniedError();
        if (tokenDenied[quote.tokenOut]) revert TokenDeniedError();

        // Compute quote hash and verify signature
        bytes32 structHash = _quoteStructHash(quote);
        bytes32 quoteHash = _hashTypedDataV4(structHash);
        
        // Check replay protection
        if (quoteUsed[quoteHash]) revert QuoteAlreadyUsed();

        // Verify signature
        address signer = ECDSA.recover(quoteHash, makerSig);
        if (signer != quote.maker) revert InvalidSignature();

        // Mark quote as used BEFORE transfers (CEI pattern)
        quoteUsed[quoteHash] = true;

        // Calculate fee
        uint256 feeAmount = (quote.amountIn * feePips) / 1_000_000;
        uint256 makerReceives = quote.amountIn - feeAmount;

        // Execute atomic transfers
        // 1. Taker -> Maker (amountIn minus fee)
        IERC20(quote.tokenIn).safeTransferFrom(msg.sender, quote.maker, makerReceives);
        
        // 2. Taker -> FeeRecipient (fee)
        if (feeAmount > 0) {
            IERC20(quote.tokenIn).safeTransferFrom(msg.sender, feeRecipient, feeAmount);
        }
        
        // 3. Maker -> Taker (amountOut)
        IERC20(quote.tokenOut).safeTransferFrom(quote.maker, msg.sender, quote.amountOut);

        emit QuoteFilled(
            quoteHash,
            quote.maker,
            msg.sender,
            quote.tokenIn,
            quote.tokenOut,
            quote.amountIn,
            quote.amountOut,
            feeAmount
        );
    }

    /**
     * @notice Compute the struct hash for a quote
     * @param quote The quote
     * @return The struct hash
     */
    function _quoteStructHash(Quote calldata quote) internal pure returns (bytes32) {
        return keccak256(
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
    }
}
