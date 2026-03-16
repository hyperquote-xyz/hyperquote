// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {ISettlementOracle} from "./interfaces/ISettlementOracle.sol";
import {QuoteLib} from "./libraries/QuoteLib.sol";
import {CollateralMath} from "./libraries/CollateralMath.sol";

/// @title OptionsEngine
/// @notice Core contract for the HyperQuote Options RFQ engine.
///         Handles EIP-712 quote execution, ERC-721 position NFTs, collateral management,
///         and physical settlement at expiry.
/// @dev Supports Cash-Secured Put (CSP) and Covered Call (CC) only.
///      Markets are siloed by collateral token. HYPE-only underlying in V1.
contract OptionsEngine is ERC721, EIP712, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------

    uint256 public constant SETTLEMENT_WINDOW = 24 hours;
    uint256 public constant MIN_EXPIRY_DURATION = 24 hours;
    uint256 public constant MAX_EXPIRY_DURATION = 90 days;
    uint256 public constant EXPIRY_TIME_OF_DAY = 28800; // 08:00 UTC
    uint256 internal constant SECONDS_PER_DAY = 86400;
    uint16 public constant MAX_KEEPER_BPS = 50;
    uint256 public constant SETTLEMENT_GRACE_PERIOD = 30 days;
    uint256 public constant ORACLE_TIMELOCK_DELAY = 48 hours;

    // ---------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------

    ISettlementOracle public oracle;
    mapping(address => bool) public allowedCollateral;
    mapping(address => bool) public allowedUnderlying;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public usedQuotes;
    mapping(uint256 => Position) internal _positions;
    uint256 public nextPositionId = 1;
    uint16 public keeperBps = 10; // default 10 bps (0.10%)
    mapping(address => uint256) public maxKeeperFee; // per collateral token
    address public pendingOracle; // two-step oracle update
    uint256 public oracleProposedAt; // timestamp of proposeOracle call

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    event QuoteExecuted(
        bytes32 indexed quoteHash, uint256 indexed positionId, address indexed maker, address taker
    );
    event QuoteCancelled(bytes32 indexed quoteHash, address indexed maker);
    event NonceIncremented(address indexed maker, uint256 newNonce);
    event PositionSettled(
        uint256 indexed positionId,
        address indexed settler,
        uint256 settlementPrice,
        uint256 underlyingTransferred,
        uint256 collateralTransferred
    );
    event PositionExpired(uint256 indexed positionId, uint256 collateralReturned, address indexed returnedTo);
    event CollateralTokenUpdated(address indexed token, bool allowed);
    event UnderlyingTokenUpdated(address indexed token, bool allowed);
    event OracleUpdated(address indexed newOracle);
    event KeeperBpsUpdated(uint16 newBps);
    event MaxKeeperFeeUpdated(address indexed token, uint256 newMaxFee);
    event KeeperFeePaid(uint256 indexed positionId, address indexed keeper, uint256 fee);
    event OracleProposed(address indexed newOracle, uint256 acceptableAt);
    event EmergencyRelease(uint256 indexed positionId, uint256 collateralReturned, address indexed returnedTo);

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    error InvalidSignature();
    error QuoteAlreadyUsed();
    error QuoteExpired();
    error NonceTooLow();
    error TakerMismatch();
    error CollateralNotAllowed();
    error UnderlyingNotAllowed();
    error InvalidExpiry();
    error ZeroQuantity();
    error ZeroPremium();
    error ZeroStrike();
    error PositionNotActive();
    error NotBeforeExpiry();
    error SettlementWindowNotClosed();
    error OptionNotITM();
    error PositionNotOTM();
    error OraclePriceNotAvailable();
    error TakerMustBeSeller();
    error ZeroAddress();
    error KeeperBpsTooHigh();
    error MaxKeeperFeeTooHigh();
    error NotMaker();
    error TooEarlyForEmergency();
    error OraclePriceAvailable();
    error NoOracleProposed();
    error OracleTimelockNotElapsed();
    error NonTransferable();

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    constructor(address owner_, address oracle_)
        ERC721("HyperQuote Option", "HQOPT")
        EIP712("HyperQuote Options", "1")
        Ownable(owner_)
    {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = ISettlementOracle(oracle_);
    }

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------

    /// @notice Whitelist or de-list a collateral token.
    /// @dev WARNING: Fee-on-transfer and rebasing tokens MUST NOT be whitelisted.
    ///      The contract stores exact collateral amounts and assumes transfers deliver
    ///      the full requested value. Fee-on-transfer tokens will cause accounting
    ///      mismatches that can lock funds or cause settlement failures.
    function setAllowedCollateral(address token, bool allowed) external onlyOwner {
        allowedCollateral[token] = allowed;
        emit CollateralTokenUpdated(token, allowed);
    }

    /// @notice Whitelist or de-list an underlying token.
    /// @dev WARNING: Fee-on-transfer and rebasing tokens MUST NOT be whitelisted.
    ///      See setAllowedCollateral for details.
    function setAllowedUnderlying(address token, bool allowed) external onlyOwner {
        allowedUnderlying[token] = allowed;
        emit UnderlyingTokenUpdated(token, allowed);
    }

    /// @notice Propose a new oracle address. Takes effect after ORACLE_TIMELOCK_DELAY.
    /// @param newOracle The proposed oracle address.
    function proposeOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        pendingOracle = newOracle;
        oracleProposedAt = block.timestamp;
        emit OracleProposed(newOracle, block.timestamp + ORACLE_TIMELOCK_DELAY);
    }

    /// @notice Accept the pending oracle after the timelock delay has elapsed.
    function acceptOracle() external onlyOwner {
        if (pendingOracle == address(0)) revert NoOracleProposed();
        if (block.timestamp < oracleProposedAt + ORACLE_TIMELOCK_DELAY) revert OracleTimelockNotElapsed();
        oracle = ISettlementOracle(pendingOracle);
        emit OracleUpdated(pendingOracle);
        pendingOracle = address(0);
        oracleProposedAt = 0;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set the keeper fee in basis points.
    /// @param bps New keeper fee (1 bps = 0.01%). Capped at MAX_KEEPER_BPS (50).
    function setKeeperBps(uint16 bps) external onlyOwner {
        if (bps > MAX_KEEPER_BPS) revert KeeperBpsTooHigh();
        keeperBps = bps;
        emit KeeperBpsUpdated(bps);
    }

    /// @notice Set the maximum keeper fee for a collateral token.
    /// @param token Collateral token address (must be allowed).
    /// @param fee Maximum keeper fee in collateral token units.
    function setMaxKeeperFee(address token, uint256 fee) external onlyOwner {
        if (!allowedCollateral[token]) revert CollateralNotAllowed();
        // Cap at 50 units of the collateral token (sanity limit)
        uint8 cDec = _tokenDecimals(token);
        if (fee > 50 * (10 ** uint256(cDec))) revert MaxKeeperFeeTooHigh();
        maxKeeperFee[token] = fee;
        emit MaxKeeperFeeUpdated(token, fee);
    }

    // ---------------------------------------------------------------
    // Quote Execution
    // ---------------------------------------------------------------

    /// @notice Execute a signed EIP-712 quote to create an options position.
    function execute(QuoteLib.Quote calldata quote, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 positionId)
    {
        // Validate and verify signature — returns the digest
        bytes32 digest = _validateAndVerifyQuote(quote, signature);

        // Mark quote as used
        usedQuotes[digest] = true;

        // Create position and perform transfers
        positionId = _createPosition(quote);

        emit QuoteExecuted(digest, positionId, quote.maker, msg.sender);
    }

    // ---------------------------------------------------------------
    // Quote Cancellation
    // ---------------------------------------------------------------

    function cancelQuote(QuoteLib.Quote calldata quote) external {
        if (quote.maker != msg.sender) revert NotMaker();
        bytes32 digest = _hashTypedDataV4(QuoteLib.hash(quote));
        usedQuotes[digest] = true;
        emit QuoteCancelled(digest, msg.sender);
    }

    function incrementNonce() external {
        uint256 newNonce = ++nonces[msg.sender];
        emit NonceIncremented(msg.sender, newNonce);
    }

    // ---------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------

    /// @notice Settle an ITM position after expiry via physical delivery.
    /// @dev Anyone can call (keeper model). No upper time bound — settlement is always
    ///      possible as long as the position is active and ITM per oracle.
    ///      The caller receives a keeper fee in the position's collateral token.
    function settle(uint256 positionId) external nonReentrant {
        Position storage pos = _positions[positionId];
        if (pos.state != PositionState.Active) revert PositionNotActive();
        if (block.timestamp < pos.expiry) revert NotBeforeExpiry();

        // Get settlement price
        (uint256 settlementPrice, bool settled) = oracle.getSettlementPrice(pos.underlying, pos.expiry);
        if (!settled) revert OraclePriceNotAvailable();

        // Verify ITM
        if (pos.isCall) {
            if (settlementPrice <= pos.strike) revert OptionNotITM();
        } else {
            if (settlementPrice >= pos.strike) revert OptionNotITM();
        }

        // Mark settled (effects first)
        pos.state = PositionState.Settled;

        // Compute keeper fee
        uint256 keeperFee = _computeKeeperFee(pos);

        // Execute physical settlement and pay keeper fee
        (uint256 underlyingXfer, uint256 collateralXfer) = _executeSettlement(pos, keeperFee);

        // Pay keeper fee to msg.sender
        if (keeperFee > 0) {
            IERC20(pos.collateral).safeTransfer(msg.sender, keeperFee);
            emit KeeperFeePaid(positionId, msg.sender, keeperFee);
        }

        // Burn the NFT
        _burn(positionId);

        emit PositionSettled(positionId, msg.sender, settlementPrice, underlyingXfer, collateralXfer);
    }

    /// @notice Release collateral for an OTM/ATM position after the settlement window,
    ///         or force-release any position after the grace period.
    /// @dev Requires oracle price to exist and position to be OTM or ATM.
    ///      ITM positions cannot normally be expired — they must be settled.
    ///      However, after SETTLEMENT_GRACE_PERIOD the OTM/ATM check is bypassed,
    ///      allowing the seller to recover collateral from positions that cannot be
    ///      settled (e.g. buyer non-cooperation or prolonged inaction).
    function expirePosition(uint256 positionId) external nonReentrant {
        Position storage pos = _positions[positionId];
        if (pos.state != PositionState.Active) revert PositionNotActive();
        if (block.timestamp <= pos.expiry + SETTLEMENT_WINDOW) revert SettlementWindowNotClosed();

        // Oracle price must exist
        (uint256 settlementPrice, bool settled) = oracle.getSettlementPrice(pos.underlying, pos.expiry);
        if (!settled) revert OraclePriceNotAvailable();

        // After the grace period, any position can be expired regardless of ITM/OTM.
        // This prevents permanent fund-lock when the buyer cannot cooperate with settlement.
        bool pastGrace = block.timestamp > pos.expiry + SETTLEMENT_GRACE_PERIOD;
        if (!pastGrace) {
            // Verify OTM or ATM — ITM positions cannot be expired before grace period
            if (pos.isCall) {
                // Call is ITM when S > K → only allow expire when S <= K (OTM/ATM)
                if (settlementPrice > pos.strike) revert PositionNotOTM();
            } else {
                // Put is ITM when S < K → only allow expire when S >= K (OTM/ATM)
                if (settlementPrice < pos.strike) revert PositionNotOTM();
            }
        }

        pos.state = PositionState.Expired;

        uint256 collateralReturned = pos.collateralLocked;
        address seller = pos.seller;

        if (pos.isCall) {
            IERC20(pos.underlying).safeTransfer(seller, collateralReturned);
        } else {
            IERC20(pos.collateral).safeTransfer(seller, collateralReturned);
        }

        _burn(positionId);

        emit PositionExpired(positionId, collateralReturned, seller);
    }

    // ---------------------------------------------------------------
    // Emergency Release
    // ---------------------------------------------------------------

    /// @notice Emergency escape hatch for positions stuck due to oracle failure.
    /// @dev Callable by anyone if no oracle price exists SETTLEMENT_GRACE_PERIOD after expiry.
    ///      Returns locked collateral to the seller and burns the position NFT.
    ///      This prevents permanent fund-lock when the oracle fails to publish a price.
    function emergencyRelease(uint256 positionId) external nonReentrant {
        Position storage pos = _positions[positionId];
        if (pos.state != PositionState.Active) revert PositionNotActive();
        if (block.timestamp < pos.expiry + SETTLEMENT_GRACE_PERIOD) revert TooEarlyForEmergency();

        // Only available when oracle has NOT published a price
        (, bool settled) = oracle.getSettlementPrice(pos.underlying, pos.expiry);
        if (settled) revert OraclePriceAvailable();

        pos.state = PositionState.Expired;

        uint256 collateralReturned = pos.collateralLocked;
        address seller = pos.seller;

        if (pos.isCall) {
            IERC20(pos.underlying).safeTransfer(seller, collateralReturned);
        } else {
            IERC20(pos.collateral).safeTransfer(seller, collateralReturned);
        }

        _burn(positionId);

        emit EmergencyRelease(positionId, collateralReturned, seller);
    }

    // ---------------------------------------------------------------
    // View Functions
    // ---------------------------------------------------------------

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    function hashQuote(QuoteLib.Quote calldata quote) external view returns (bytes32) {
        return _hashTypedDataV4(QuoteLib.hash(quote));
    }

    function isQuoteUsed(bytes32 quoteHash) external view returns (bool) {
        return usedQuotes[quoteHash];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------
    // Internal — Quote Validation
    // ---------------------------------------------------------------

    /// @dev Validates quote parameters and verifies EIP-712 signature.
    ///      Returns the EIP-712 digest on success.
    function _validateAndVerifyQuote(QuoteLib.Quote calldata quote, bytes calldata signature)
        internal
        view
        returns (bytes32 digest)
    {
        if (quote.quantity == 0) revert ZeroQuantity();
        if (quote.premium == 0) revert ZeroPremium();
        if (quote.strike == 0) revert ZeroStrike();
        if (quote.isMakerSeller) revert TakerMustBeSeller();
        if (!allowedCollateral[quote.collateral]) revert CollateralNotAllowed();
        if (!allowedUnderlying[quote.underlying]) revert UnderlyingNotAllowed();
        _validateExpiry(quote.expiry);
        if (block.timestamp > quote.deadline) revert QuoteExpired();
        if (quote.nonce < nonces[quote.maker]) revert NonceTooLow();
        if (quote.taker != address(0) && quote.taker != msg.sender) revert TakerMismatch();

        digest = _hashTypedDataV4(QuoteLib.hash(quote));
        if (usedQuotes[digest]) revert QuoteAlreadyUsed();

        address signer = ECDSA.recover(digest, signature);
        if (signer != quote.maker) revert InvalidSignature();
    }

    // ---------------------------------------------------------------
    // Internal — Position Creation
    // ---------------------------------------------------------------

    /// @dev Creates position, mints NFT, transfers premium, locks collateral.
    ///      V1: isMakerSeller is always false → taker (msg.sender) is seller, maker is buyer.
    function _createPosition(QuoteLib.Quote calldata quote) internal returns (uint256 positionId) {
        // V1: taker is always seller, maker is always buyer
        address seller = msg.sender;
        address buyer = quote.maker;

        uint256 collateralAmount;
        if (quote.isCall) {
            collateralAmount = quote.quantity;
        } else {
            uint8 uDec = _tokenDecimals(quote.underlying);
            uint8 cDec = _tokenDecimals(quote.collateral);
            collateralAmount = CollateralMath.putCollateralRequired(quote.strike, quote.quantity, uDec, cDec);
        }

        positionId = nextPositionId++;
        _positions[positionId] = Position({
            seller: seller,
            buyer: buyer,
            underlying: quote.underlying,
            collateral: quote.collateral,
            isCall: quote.isCall,
            strike: quote.strike,
            quantity: quote.quantity,
            premium: quote.premium,
            expiry: quote.expiry,
            collateralLocked: collateralAmount,
            state: PositionState.Active
        });

        // Mint NFT to buyer
        _mint(buyer, positionId);

        // Transfer premium: buyer -> seller
        IERC20(quote.collateral).safeTransferFrom(buyer, seller, quote.premium);

        // Lock collateral from seller
        if (quote.isCall) {
            IERC20(quote.underlying).safeTransferFrom(seller, address(this), collateralAmount);
        } else {
            IERC20(quote.collateral).safeTransferFrom(seller, address(this), collateralAmount);
        }
    }

    // ---------------------------------------------------------------
    // Internal — Settlement Execution
    // ---------------------------------------------------------------

    /// @dev Executes physical settlement transfers, net of keeper fee.
    /// @param pos The position being settled.
    /// @param keeperFee Amount to be retained in the contract for the keeper (paid after this call).
    function _executeSettlement(Position storage pos, uint256 keeperFee)
        internal
        returns (uint256 underlyingXfer, uint256 collateralXfer)
    {
        address buyer = pos.buyer;
        address seller = pos.seller;

        if (pos.isCall) {
            // Covered Call ITM: buyer delivers strike×qty in collateral, receives underlying.
            // Keeper fee is deducted from the stablecoin the seller receives.
            uint8 uDec = _tokenDecimals(pos.underlying);
            uint8 cDec = _tokenDecimals(pos.collateral);
            uint256 grossCollateral = CollateralMath.callSettlementCost(pos.strike, pos.quantity, uDec, cDec);
            uint256 sellerNet = grossCollateral - keeperFee;
            collateralXfer = grossCollateral; // gross amount for event reporting
            underlyingXfer = pos.collateralLocked;

            // Buyer pays full strike×qty to contract (so contract can split keeper fee)
            IERC20(pos.collateral).safeTransferFrom(buyer, address(this), grossCollateral);
            // Contract pays seller net of keeper fee
            IERC20(pos.collateral).safeTransfer(seller, sellerNet);
            // Contract sends underlying to buyer
            IERC20(pos.underlying).safeTransfer(buyer, underlyingXfer);
        } else {
            // Cash-Secured Put ITM: buyer delivers underlying, receives collateral.
            // Keeper fee is deducted from the locked collateral the buyer receives.
            underlyingXfer = pos.quantity;
            collateralXfer = pos.collateralLocked; // gross amount for event reporting
            uint256 buyerNet = pos.collateralLocked - keeperFee;

            IERC20(pos.underlying).safeTransferFrom(buyer, seller, underlyingXfer);
            IERC20(pos.collateral).safeTransfer(buyer, buyerNet);
        }
    }

    /// @dev Computes the keeper fee for a position being settled.
    ///      Fee = min(notional * keeperBps / 10_000, maxKeeperFee[collateral]).
    ///      Capped to not exceed available seller-side collateral/proceeds.
    function _computeKeeperFee(Position storage pos) internal view returns (uint256) {
        uint16 bps = keeperBps;
        if (bps == 0) return 0;

        uint8 uDec = _tokenDecimals(pos.underlying);
        uint8 cDec = _tokenDecimals(pos.collateral);
        uint256 notionalValue = CollateralMath.notional(pos.strike, pos.quantity, uDec, cDec);

        // fee = ceilDiv(notional * bps, 10_000)
        uint256 fee = CollateralMath.ceilDiv(notionalValue * uint256(bps), 10_000);

        // Cap at maxKeeperFee for this collateral token
        uint256 maxFee = maxKeeperFee[pos.collateral];
        if (maxFee > 0 && fee > maxFee) {
            fee = maxFee;
        }

        // Ensure fee does not exceed available seller-side amount
        if (pos.isCall) {
            // For CC: fee comes from buyer's stablecoin payment (strike×qty)
            uint256 grossCollateral = CollateralMath.callSettlementCost(pos.strike, pos.quantity, uDec, cDec);
            if (fee > grossCollateral) fee = grossCollateral;
        } else {
            // For CSP: fee comes from locked collateral
            if (fee > pos.collateralLocked) fee = pos.collateralLocked;
        }

        return fee;
    }

    // ---------------------------------------------------------------
    // Internal — Helpers
    // ---------------------------------------------------------------

    function _validateExpiry(uint256 expiry) internal view {
        if (expiry % SECONDS_PER_DAY != EXPIRY_TIME_OF_DAY) revert InvalidExpiry();
        if (expiry < block.timestamp + MIN_EXPIRY_DURATION) revert InvalidExpiry();
        if (expiry > block.timestamp + MAX_EXPIRY_DURATION) revert InvalidExpiry();
    }

    function _tokenDecimals(address token) internal view returns (uint8) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (success && data.length >= 32) {
            return abi.decode(data, (uint8));
        }
        return 18;
    }

    // ---------------------------------------------------------------
    // Internal — Soulbound NFT
    // ---------------------------------------------------------------

    /// @dev Positions are soulbound — transfers between non-zero addresses are blocked.
    ///      Only mint (from == address(0)) and burn (to == address(0)) are allowed.
    ///      This prevents misleading secondary markets where the NFT holder has no
    ///      settlement rights (settlement uses stored pos.buyer, not ownerOf).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) revert NonTransferable();
        return from;
    }
}
