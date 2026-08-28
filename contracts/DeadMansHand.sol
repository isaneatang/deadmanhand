// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Dead Man's Hand (DMH)
/// @notice Decentralized crypto inheritance / emergency-access protocol.
///         Per-token approval model, EOA-based (see Master Build Prompt Section 2).
///         The owner's assets never move or get locked during normal use; they
///         remain in the owner's own wallet until a successful claim.
///
/// @dev Design notes / documented decisions filling gaps left open by the spec
///      (these are engineering decisions, not fabricated external values):
///
///      1. ERC-721 collections are registered as a whole (matching
///         `setApprovalForAll`), so at claim time this contract needs to
///         discover which specific tokenIds the owner currently holds in that
///         collection. This requires the collection to implement
///         `ERC721Enumerable`. If a registered collection does NOT implement
///         it, enumeration will fail gracefully and that collection is
///         skipped (skip-and-continue, per Master Prompt Section 4.6),
///         logged via `TokenTransferFailed`. This is a real limitation of any
///         on-chain-only (no indexer/oracle) design and is documented here
///         and in the README rather than silently assumed to work universally.
///      2. To bound gas usage of the claim loop, at most `MAX_NFTS_PER_TOKEN`
///         NFTs per registered collection and `MAX_TOKENS_PER_VAULT` total
///         registered token entries are processed/allowed.
///      3. Failure-threshold / cooldown-duration / escalation-cap are left as
///         constructor parameters (Master Prompt Section 11 explicitly marks
///         the exact numbers as an open product question) with the suggested
///         defaults used at deploy time (5 failures / 24h / doubling).
contract DeadMansHand is ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------
    error VaultAlreadyExists();
    error VaultNotFound();
    error NotVaultOwner();
    error VaultInactive();
    error TokenAlreadyRegistered();
    error TooManyTokens();
    error VaultLockedError(uint256 cooldownRemaining);
    error NotExpiredYet(uint256 timeRemaining);
    error SecretTooLong();
    error InvalidInactivityPeriod();
    error FeeTransferFailed();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    uint256 public constant MIN_INACTIVITY_PERIOD = 1 days;
    uint256 public constant MAX_INACTIVITY_PERIOD = 10 * 365 days;
    uint256 public constant MAX_TOKENS_PER_VAULT = 50;
    uint256 public constant MAX_SECRET_LENGTH = 256;
    uint256 public constant MAX_NFTS_PER_TOKEN = 20;

    // ---------------------------------------------------------------------
    // Immutable deployment configuration
    // ---------------------------------------------------------------------

    /// @notice ERC-20 token used to pay the flat unlock-attempt fee (USDT on
    ///         the target network). Set once at deploy time.
    address public immutable feeToken;

    /// @notice Base fee amount, in feeToken's smallest unit (e.g. 1_000000
    ///         for 1 USDT at 6 decimals). Flat fee per Master Prompt Section 5.
    uint256 public immutable baseFee;

    /// @notice Consecutive mismatched attempts before a vault enters cooldown.
    uint16 public immutable failureThreshold;

    /// @notice Cooldown duration once failureThreshold is reached.
    uint256 public immutable cooldownDuration;

    /// @notice Cap on the fee-doubling exponent within one lockout cycle, so
    ///         the fee never grows unboundedly even if failureThreshold is
    ///         configured very high.
    uint16 public immutable maxEscalationDoublings;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Vault {
        address owner;
        bytes32 secretHash;
        uint256 inactivityPeriod;
        uint256 lastActive;
        bool active; // false once owner deactivates; deactivated vaults can never be claimed
        bool exists;
        uint16 failedAttempts; // consecutive mismatches in the current cycle
        uint256 cooldownUntil; // 0 if not currently locked
    }

    struct TokenEntry {
        address tokenAddress;
        bool isERC721; // true = whole-collection NFT approval (setApprovalForAll)
    }

    mapping(bytes32 => Vault) public vaults;
    mapping(bytes32 => TokenEntry[]) private vaultTokens;
    mapping(bytes32 => mapping(address => bool)) private isTokenRegistered;

    /// @notice On-chain index so address-based lookup (Master Prompt Section
    ///         4.5) can be resolved without an external indexer.
    mapping(address => bytes32[]) private ownerVaultIds;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint256 inactivityPeriod);
    event TokenAdded(bytes32 indexed vaultId, address indexed token, bool isERC721);
    event Pinged(bytes32 indexed vaultId, uint256 timestamp);
    event VaultDeactivated(bytes32 indexed vaultId);
    event FeeCollected(bytes32 indexed vaultId, address indexed payer, uint256 amount);
    event UnlockAttempted(bytes32 indexed vaultId, address indexed claimant, bool success);
    event VaultLocked(bytes32 indexed vaultId, uint256 cooldownUntil);
    event TokenTransferSucceeded(bytes32 indexed vaultId, address indexed token, address indexed claimant, uint256 amountOrId);
    event TokenTransferFailed(bytes32 indexed vaultId, address indexed token, address indexed claimant, string reason);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------
    constructor(
        address _feeToken,
        uint256 _baseFee,
        uint16 _failureThreshold,
        uint256 _cooldownDuration,
        uint16 _maxEscalationDoublings
    ) {
        if (_feeToken == address(0)) revert ZeroAddress();
        require(_baseFee > 0, "baseFee=0");
        require(_failureThreshold > 0, "failureThreshold=0");
        require(_cooldownDuration > 0, "cooldownDuration=0");

        feeToken = _feeToken;
        baseFee = _baseFee;
        failureThreshold = _failureThreshold;
        cooldownDuration = _cooldownDuration;
        maxEscalationDoublings = _maxEscalationDoublings;
    }

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------
    modifier onlyVaultOwner(bytes32 vaultId) {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();
        if (v.owner != msg.sender) revert NotVaultOwner();
        _;
    }

    // ---------------------------------------------------------------------
    // Owner actions
    // ---------------------------------------------------------------------

    /// @notice Create a new vault. `secretHash` must already be
    ///         `keccak256(abi.encodePacked(secretPlaintext, msg.sender, vaultId))`,
    ///         computed client-side — the plaintext secret must never reach
    ///         this contract at creation time.
    function createVault(bytes32 vaultId, bytes32 secretHash, uint256 inactivityPeriod) external {
        if (vaults[vaultId].exists) revert VaultAlreadyExists();
        if (inactivityPeriod < MIN_INACTIVITY_PERIOD || inactivityPeriod > MAX_INACTIVITY_PERIOD) {
            revert InvalidInactivityPeriod();
        }

        vaults[vaultId] = Vault({
            owner: msg.sender,
            secretHash: secretHash,
            inactivityPeriod: inactivityPeriod,
            lastActive: block.timestamp,
            active: true,
            exists: true,
            failedAttempts: 0,
            cooldownUntil: 0
        });

        ownerVaultIds[msg.sender].push(vaultId);

        emit VaultCreated(vaultId, msg.sender, inactivityPeriod);
    }

    /// @notice Register a token/collection this vault is allowed to pull from
    ///         at claim time. The corresponding `approve`/`setApprovalForAll`
    ///         transaction must already have been sent by the owner directly
    ///         to the token/collection contract (not through this function).
    function addToken(bytes32 vaultId, address tokenAddress, bool isERC721) external onlyVaultOwner(vaultId) {
        if (tokenAddress == address(0)) revert ZeroAddress();
        if (isTokenRegistered[vaultId][tokenAddress]) revert TokenAlreadyRegistered();
        if (vaultTokens[vaultId].length >= MAX_TOKENS_PER_VAULT) revert TooManyTokens();

        vaultTokens[vaultId].push(TokenEntry({tokenAddress: tokenAddress, isERC721: isERC721}));
        isTokenRegistered[vaultId][tokenAddress] = true;

        emit TokenAdded(vaultId, tokenAddress, isERC721);
    }

    /// @notice Owner heartbeat — resets the inactivity clock. Self-ping only;
    ///         see Master Prompt Section 4.3 for why this can't observe
    ///         general wallet activity.
    function ping(bytes32 vaultId) external onlyVaultOwner(vaultId) {
        Vault storage v = vaults[vaultId];
        if (!v.active) revert VaultInactive();
        v.lastActive = block.timestamp;
        emit Pinged(vaultId, block.timestamp);
    }

    /// @notice Owner-initiated deactivation. Gated by wallet signature only,
    ///         NOT by the secret (Master Prompt Section 4.4). Does not revoke
    ///         individual token approvals.
    function deactivateVault(bytes32 vaultId) external onlyVaultOwner(vaultId) {
        vaults[vaultId].active = false;
        emit VaultDeactivated(vaultId);
    }

    // ---------------------------------------------------------------------
    // Claim / unlock
    // ---------------------------------------------------------------------

    /// @notice The fee (in feeToken smallest units) that the NEXT attemptUnlock
    ///         call against this vault would require, given its current
    ///         consecutive-failure count. Frontend should call this before
    ///         prompting the claimant for a token approval.
    function previewFee(bytes32 vaultId) external view returns (uint256) {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();
        // Mirror the auto-expiry check in attemptUnlock so a stale cooldown
        // that has already elapsed (but hasn't been touched by a new
        // attemptUnlock call yet) doesn't report an inflated fee.
        uint16 effectiveFailedAttempts = v.failedAttempts;
        if (v.cooldownUntil != 0 && block.timestamp >= v.cooldownUntil) {
            effectiveFailedAttempts = 0;
        }
        return _currentFee(effectiveFailedAttempts);
    }

    function _currentFee(uint16 failedAttempts) internal view returns (uint256) {
        uint16 exponent = failedAttempts;
        if (exponent > maxEscalationDoublings) {
            exponent = maxEscalationDoublings;
        }
        // baseFee * 2^exponent, exponent bounded by maxEscalationDoublings
        // (set at deploy time; kept small, e.g. <= failureThreshold) so this
        // cannot overflow.
        return baseFee << exponent;
    }

    /// @notice Attempt to unlock a vault with a candidate secret. Charges the
    ///         current escalated fee in `feeToken` from the caller regardless
    ///         of match outcome (Master Prompt Section 4.6). On match, sweeps
    ///         every registered token/collection to the caller using
    ///         skip-and-continue semantics — one stale/failed transfer never
    ///         blocks the rest.
    /// @param secretPlaintext The raw secret. NEVER logged; only used in a
    ///        single keccak256 comparison within this call.
    function attemptUnlock(bytes32 vaultId, string calldata secretPlaintext) external nonReentrant {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();
        if (!v.active) revert VaultInactive();
        if (bytes(secretPlaintext).length > MAX_SECRET_LENGTH) revert SecretTooLong();

        // Auto-expire a finished cooldown cycle before evaluating this attempt.
        if (v.cooldownUntil != 0 && block.timestamp >= v.cooldownUntil) {
            v.cooldownUntil = 0;
            v.failedAttempts = 0;
        }

        if (v.cooldownUntil != 0 && block.timestamp < v.cooldownUntil) {
            revert VaultLockedError(v.cooldownUntil - block.timestamp);
        }

        uint256 deadline = v.lastActive + v.inactivityPeriod;
        if (block.timestamp < deadline) {
            revert NotExpiredYet(deadline - block.timestamp);
        }

        // --- Fee collection (charged either way) ---
        uint256 fee = _currentFee(v.failedAttempts);
        bool feeOk = IERC20(feeToken).transferFrom(msg.sender, address(this), fee);
        if (!feeOk) revert FeeTransferFailed();
        emit FeeCollected(vaultId, msg.sender, fee);

        // --- Secret comparison ---
        bytes32 candidateHash = keccak256(abi.encodePacked(secretPlaintext, v.owner, vaultId));

        if (candidateHash == v.secretHash) {
            v.failedAttempts = 0;
            v.cooldownUntil = 0;
            _sweepTokens(vaultId, v.owner, msg.sender);
            emit UnlockAttempted(vaultId, msg.sender, true);
        } else {
            v.failedAttempts += 1;
            if (v.failedAttempts >= failureThreshold) {
                v.cooldownUntil = block.timestamp + cooldownDuration;
                emit VaultLocked(vaultId, v.cooldownUntil);
            }
            emit UnlockAttempted(vaultId, msg.sender, false);
        }
    }

    /// @dev Skip-and-continue transfer loop over every registered token for
    ///      this vault. Never reverts the outer transaction on a single
    ///      token's failure (Master Prompt Section 4.6).
    function _sweepTokens(bytes32 vaultId, address owner, address claimant) internal {
        TokenEntry[] storage entries = vaultTokens[vaultId];
        uint256 len = entries.length;
        for (uint256 i = 0; i < len; i++) {
            TokenEntry storage entry = entries[i];
            if (entry.isERC721) {
                _sweepERC721(vaultId, entry.tokenAddress, owner, claimant);
            } else {
                _sweepERC20(vaultId, entry.tokenAddress, owner, claimant);
            }
        }
    }

    function _sweepERC20(bytes32 vaultId, address token, address owner, address claimant) internal {
        uint256 allowed;
        try IERC20(token).allowance(owner, address(this)) returns (uint256 a) {
            allowed = a;
        } catch {
            emit TokenTransferFailed(vaultId, token, claimant, "allowance() reverted");
            return;
        }

        if (allowed == 0) {
            emit TokenTransferFailed(vaultId, token, claimant, "no allowance");
            return;
        }

        uint256 bal;
        try IERC20(token).balanceOf(owner) returns (uint256 b) {
            bal = b;
        } catch {
            emit TokenTransferFailed(vaultId, token, claimant, "balanceOf() reverted");
            return;
        }

        uint256 amount = allowed < bal ? allowed : bal;
        if (amount == 0) {
            emit TokenTransferFailed(vaultId, token, claimant, "zero balance");
            return;
        }

        try IERC20(token).transferFrom(owner, claimant, amount) returns (bool ok) {
            if (ok) {
                emit TokenTransferSucceeded(vaultId, token, claimant, amount);
            } else {
                emit TokenTransferFailed(vaultId, token, claimant, "transferFrom returned false");
            }
        } catch {
            emit TokenTransferFailed(vaultId, token, claimant, "transferFrom reverted");
        }
    }

    function _sweepERC721(bytes32 vaultId, address token, address owner, address claimant) internal {
        uint256 bal;
        try IERC721(token).balanceOf(owner) returns (uint256 b) {
            bal = b;
        } catch {
            emit TokenTransferFailed(vaultId, token, claimant, "balanceOf() reverted (not enumerable/approved?)");
            return;
        }

        if (bal == 0) {
            emit TokenTransferFailed(vaultId, token, claimant, "owner holds none");
            return;
        }

        uint256 count = bal > MAX_NFTS_PER_TOKEN ? MAX_NFTS_PER_TOKEN : bal;
        // Always re-query index 0: after each successful transfer the
        // owner's remaining tokens shift down, so index 0 always points at
        // the next token still held. Avoids stale-index bugs.
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId;
            bool gotId;
            try IERC721Enumerable(token).tokenOfOwnerByIndex(owner, 0) returns (uint256 id) {
                tokenId = id;
                gotId = true;
            } catch {
                emit TokenTransferFailed(vaultId, token, claimant, "collection is not ERC721Enumerable");
            }

            if (!gotId) {
                break; // enumeration unsupported entirely; stop trying this collection
            }

            try IERC721(token).safeTransferFrom(owner, claimant, tokenId) {
                emit TokenTransferSucceeded(vaultId, token, claimant, tokenId);
            } catch {
                emit TokenTransferFailed(vaultId, token, claimant, "safeTransferFrom reverted (stale approval?)");
                break; // further indices will very likely fail the same way; stop this collection
            }
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @return expired True if past the inactivity deadline and claimable.
    /// @return timeRemaining Seconds until expiry (0 if already expired).
    /// @return active False if the owner deactivated this vault.
    /// @return locked True if currently in a failed-attempt cooldown.
    /// @return cooldownRemaining Seconds left in cooldown (0 if not locked).
    function getStatus(bytes32 vaultId)
        external
        view
        returns (bool expired, uint256 timeRemaining, bool active, bool locked, uint256 cooldownRemaining)
    {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();

        active = v.active;

        uint256 deadline = v.lastActive + v.inactivityPeriod;
        if (block.timestamp >= deadline) {
            expired = true;
            timeRemaining = 0;
        } else {
            expired = false;
            timeRemaining = deadline - block.timestamp;
        }

        if (v.cooldownUntil != 0 && block.timestamp < v.cooldownUntil) {
            locked = true;
            cooldownRemaining = v.cooldownUntil - block.timestamp;
        } else {
            locked = false;
            cooldownRemaining = 0;
        }
    }

    function getVaultTokens(bytes32 vaultId) external view returns (TokenEntry[] memory) {
        return vaultTokens[vaultId];
    }

    function getOwnerVaults(address owner) external view returns (bytes32[] memory) {
        return ownerVaultIds[owner];
    }

    function getFailedAttempts(bytes32 vaultId) external view returns (uint16) {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();
        return v.failedAttempts;
    }
}
