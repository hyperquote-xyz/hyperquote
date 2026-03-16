// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISettlementOracle} from "./interfaces/ISettlementOracle.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SettlementPublisher
/// @notice Commit-reveal oracle for publishing settlement prices at option expiry.
/// @dev V1 implementation of ISettlementOracle. The owner authorizes publishers who use
///      a two-phase commit-reveal to post settlement prices. This prevents front-running
///      of the settlement price by requiring a commitment before the actual price is known.
///
///      Flow:
///        1. Publisher calls commitPrice(hash) where hash = keccak256(abi.encodePacked(asset, expiry, price, salt))
///        2. After REVEAL_DELAY, publisher calls revealPrice(asset, expiry, price, salt)
///        3. Price is verified against the commitment and stored permanently.
///
///      This contract can later be replaced by a HyperCore precompile reader
///      that also implements ISettlementOracle.
contract SettlementPublisher is ISettlementOracle, Ownable {
    // ---------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------

    /// @notice Minimum delay between commit and reveal (prevents same-block front-running).
    uint256 public constant REVEAL_DELAY = 5 minutes;

    /// @notice Maximum time after commit in which a reveal must occur.
    uint256 public constant REVEAL_WINDOW = 24 hours;

    /// @notice Minimum delay after expiry before emergency publication is allowed.
    uint256 public constant EMERGENCY_DELAY = 48 hours;

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------

    /// @notice Authorized price publishers.
    mapping(address => bool) public isPublisher;

    /// @notice Stored settlement prices: asset => expiry => price.
    mapping(address => mapping(uint256 => uint256)) internal _prices;

    /// @notice Whether a price has been set: asset => expiry => settled.
    mapping(address => mapping(uint256 => bool)) internal _settled;

    /// @notice Commit storage: commitHash => timestamp of commit.
    mapping(bytes32 => uint256) public commitTimestamps;

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    event PublisherAdded(address indexed publisher);
    event PublisherRemoved(address indexed publisher);
    event PriceCommitted(bytes32 indexed commitHash, address indexed publisher);

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    error NotPublisher();
    error AlreadySettled();
    error AlreadyCommitted();
    error NotCommitted();
    error RevealTooEarly();
    error RevealTooLate();
    error CommitHashMismatch();
    error ExpiryNotPassed();
    error CommitAfterExpiry();
    error TooEarlyForEmergency();

    // ---------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------

    modifier onlyPublisher() {
        if (!isPublisher[msg.sender]) revert NotPublisher();
        _;
    }

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    constructor(address owner_) Ownable(owner_) {}

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------

    /// @notice Authorize a new price publisher.
    function addPublisher(address publisher) external onlyOwner {
        isPublisher[publisher] = true;
        emit PublisherAdded(publisher);
    }

    /// @notice Revoke a price publisher's authorization.
    function removePublisher(address publisher) external onlyOwner {
        isPublisher[publisher] = false;
        emit PublisherRemoved(publisher);
    }

    // ---------------------------------------------------------------
    // Commit-Reveal
    // ---------------------------------------------------------------

    /// @notice Phase 1: Commit a hash of the settlement price.
    /// @param commitHash keccak256(abi.encodePacked(asset, expiry, price, salt))
    function commitPrice(bytes32 commitHash) external onlyPublisher {
        if (commitTimestamps[commitHash] != 0) revert AlreadyCommitted();
        commitTimestamps[commitHash] = block.timestamp;
        emit PriceCommitted(commitHash, msg.sender);
    }

    /// @notice Phase 2: Reveal the committed settlement price.
    /// @param asset The underlying asset address.
    /// @param expiry The expiry timestamp.
    /// @param price The settlement price (USD, 18 decimals — 1e18 = $1.00).
    /// @param salt Random salt used in the commitment.
    function revealPrice(address asset, uint256 expiry, uint256 price, bytes32 salt) external onlyPublisher {
        if (_settled[asset][expiry]) revert AlreadySettled();
        if (block.timestamp < expiry) revert ExpiryNotPassed();

        bytes32 commitHash = keccak256(abi.encodePacked(asset, expiry, price, salt));
        uint256 committedAt = commitTimestamps[commitHash];

        if (committedAt == 0) revert NotCommitted();
        if (committedAt >= expiry) revert CommitAfterExpiry();
        if (block.timestamp < committedAt + REVEAL_DELAY) revert RevealTooEarly();
        if (block.timestamp > committedAt + REVEAL_WINDOW) revert RevealTooLate();

        _prices[asset][expiry] = price;
        _settled[asset][expiry] = true;

        // Clean up commitment to free storage
        delete commitTimestamps[commitHash];

        emit SettlementPricePublished(asset, expiry, price, msg.sender);
    }

    // ---------------------------------------------------------------
    // Emergency
    // ---------------------------------------------------------------

    /// @notice Emergency price publication by the owner, bypassing commit-reveal.
    /// @dev Only available EMERGENCY_DELAY (48h) after expiry and only if no price
    ///      has been published yet. This prevents permanent fund-lock in OptionsEngine
    ///      when all publishers fail to commit before expiry.
    /// @param asset The underlying asset address.
    /// @param expiry The expiry timestamp.
    /// @param price The settlement price (USD, 18 decimals — 1e18 = $1.00).
    function emergencyPublish(address asset, uint256 expiry, uint256 price) external onlyOwner {
        if (_settled[asset][expiry]) revert AlreadySettled();
        if (block.timestamp < expiry + EMERGENCY_DELAY) revert TooEarlyForEmergency();

        _prices[asset][expiry] = price;
        _settled[asset][expiry] = true;

        emit SettlementPricePublished(asset, expiry, price, msg.sender);
    }

    // ---------------------------------------------------------------
    // ISettlementOracle
    // ---------------------------------------------------------------

    /// @inheritdoc ISettlementOracle
    function getSettlementPrice(address asset, uint256 expiry)
        external
        view
        override
        returns (uint256 price, bool settled)
    {
        return (_prices[asset][expiry], _settled[asset][expiry]);
    }

    /// @inheritdoc ISettlementOracle
    function hasPriceFor(address asset, uint256 expiry) external view override returns (bool) {
        return _settled[asset][expiry];
    }
}
