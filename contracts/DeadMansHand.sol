// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Dead Man's Hand
/// @notice EIP-712-authorized transfer of approved assets after owner inactivity.
contract DeadMansHand is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error VaultAlreadyExists();
    error VaultNotFound();
    error NotVaultOwner();
    error VaultInactive();
    error TokenAlreadyRegistered();
    error TooManyTokens();
    error NotExpiredYet(uint256 timeRemaining);
    error InvalidInactivityPeriod();
    error InvalidAuthorizationSigner();
    error InvalidKdfSalt();
    error UnsupportedKdfVersion();
    error InvalidRecipient();
    error InvalidFeePayer();
    error InvalidNonce();
    error AuthorizationExpired();
    error FeeExceedsMaximum();
    error InvalidSignature();
    error FeeTransferFailed();
    error ZeroAddress();
    error InvalidBaseFee();

    uint8 public constant KDF_VERSION = 1;
    uint256 public constant MIN_INACTIVITY_PERIOD = 1 minutes;
    uint256 public constant MAX_INACTIVITY_PERIOD = 10 * 365 days;
    uint256 public constant MAX_TOKENS_PER_VAULT = 50;
    uint256 public constant MAX_NFTS_PER_TOKEN = 20;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(bytes32 vaultId,address recipient,address feePayer,uint256 nonce,uint256 deadline,uint256 maxFee)"
    );

    address public immutable feeToken;
    uint256 public immutable baseFee;
    address public immutable feeRecipient;

    struct Vault {
        address owner;
        address authorizationSigner;
        bytes32 kdfSalt;
        uint8 kdfVersion;
        uint256 inactivityPeriod;
        uint256 lastActive;
        bool active;
        bool claimed;
        bool exists;
        uint256 claimNonce;
    }

    struct Claim {
        bytes32 vaultId;
        address recipient;
        address feePayer;
        uint256 nonce;
        uint256 deadline;
        uint256 maxFee;
    }

    struct TokenEntry {
        address tokenAddress;
        bool isERC721;
    }

    mapping(bytes32 => Vault) public vaults;
    mapping(bytes32 => TokenEntry[]) private vaultTokens;
    mapping(bytes32 => mapping(address => bool)) private isTokenRegistered;
    mapping(address => bytes32[]) private ownerVaultIds;

    event VaultCreated(
        bytes32 indexed vaultId,
        address indexed owner,
        address indexed authorizationSigner,
        bytes32 kdfSalt,
        uint8 kdfVersion,
        uint256 inactivityPeriod
    );
    event TokenAdded(bytes32 indexed vaultId, address indexed token, bool isERC721);
    event Pinged(bytes32 indexed vaultId, uint256 timestamp);
    event VaultDeactivated(bytes32 indexed vaultId);
    event FeeCollected(bytes32 indexed vaultId, address indexed payer, uint256 amount);
    event VaultClaimed(bytes32 indexed vaultId, address indexed recipient, address indexed feePayer, uint256 nonce);
    event TokenTransferSucceeded(bytes32 indexed vaultId, address indexed token, address indexed recipient, uint256 amountOrId);
    event TokenTransferFailed(bytes32 indexed vaultId, address indexed token, address indexed recipient, string reason);

    constructor(address _feeToken, uint256 _baseFee, address _feeRecipient) EIP712("DeadMansHand", "2") {
        if (_feeToken == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        if (_baseFee == 0) revert InvalidBaseFee();
        feeToken = _feeToken;
        baseFee = _baseFee;
        feeRecipient = _feeRecipient;
    }

    modifier onlyVaultOwner(bytes32 vaultId) {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();
        if (v.owner != msg.sender) revert NotVaultOwner();
        _;
    }

    function createVault(
        bytes32 vaultId,
        address authorizationSigner,
        bytes32 kdfSalt,
        uint8 kdfVersion,
        uint256 inactivityPeriod
    ) external {
        if (vaults[vaultId].exists) revert VaultAlreadyExists();
        if (authorizationSigner == address(0)) revert InvalidAuthorizationSigner();
        if (kdfSalt == bytes32(0)) revert InvalidKdfSalt();
        if (kdfVersion != KDF_VERSION) revert UnsupportedKdfVersion();
        if (inactivityPeriod < MIN_INACTIVITY_PERIOD || inactivityPeriod > MAX_INACTIVITY_PERIOD) {
            revert InvalidInactivityPeriod();
        }

        vaults[vaultId] = Vault({
            owner: msg.sender,
            authorizationSigner: authorizationSigner,
            kdfSalt: kdfSalt,
            kdfVersion: kdfVersion,
            inactivityPeriod: inactivityPeriod,
            lastActive: block.timestamp,
            active: true,
            claimed: false,
            exists: true,
            claimNonce: 0
        });
        ownerVaultIds[msg.sender].push(vaultId);

        emit VaultCreated(vaultId, msg.sender, authorizationSigner, kdfSalt, kdfVersion, inactivityPeriod);
    }

    function addToken(bytes32 vaultId, address tokenAddress, bool isERC721) external onlyVaultOwner(vaultId) {
        Vault storage v = vaults[vaultId];
        if (!v.active) revert VaultInactive();
        if (tokenAddress == address(0)) revert ZeroAddress();
        if (isTokenRegistered[vaultId][tokenAddress]) revert TokenAlreadyRegistered();
        if (vaultTokens[vaultId].length >= MAX_TOKENS_PER_VAULT) revert TooManyTokens();

        vaultTokens[vaultId].push(TokenEntry({tokenAddress: tokenAddress, isERC721: isERC721}));
        isTokenRegistered[vaultId][tokenAddress] = true;
        emit TokenAdded(vaultId, tokenAddress, isERC721);
    }

    function ping(bytes32 vaultId) external onlyVaultOwner(vaultId) {
        Vault storage v = vaults[vaultId];
        if (!v.active) revert VaultInactive();
        v.lastActive = block.timestamp;
        emit Pinged(vaultId, block.timestamp);
    }

    function deactivateVault(bytes32 vaultId) external onlyVaultOwner(vaultId) {
        Vault storage v = vaults[vaultId];
        if (!v.active) revert VaultInactive();
        v.active = false;
        emit VaultDeactivated(vaultId);
    }

    function claim(Claim calldata authorization, bytes calldata signature) external nonReentrant {
        Vault storage v = vaults[authorization.vaultId];
        if (!v.exists) revert VaultNotFound();
        if (!v.active) revert VaultInactive();
        if (authorization.feePayer != msg.sender) revert InvalidFeePayer();
        if (authorization.recipient == address(0)) revert InvalidRecipient();
        if (authorization.nonce != v.claimNonce) revert InvalidNonce();
        if (block.timestamp > authorization.deadline) revert AuthorizationExpired();

        uint256 expiry = v.lastActive + v.inactivityPeriod;
        if (block.timestamp < expiry) revert NotExpiredYet(expiry - block.timestamp);
        if (baseFee > authorization.maxFee) revert FeeExceedsMaximum();

        bytes32 structHash = keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                authorization.vaultId,
                authorization.recipient,
                authorization.feePayer,
                authorization.nonce,
                authorization.deadline,
                authorization.maxFee
            )
        );
        (address recovered, ECDSA.RecoverError recoverError,) =
            ECDSA.tryRecoverCalldata(_hashTypedDataV4(structHash), signature);
        if (recoverError != ECDSA.RecoverError.NoError || recovered != v.authorizationSigner) {
            revert InvalidSignature();
        }

        address owner = v.owner;
        v.claimNonce++;
        v.active = false;
        v.claimed = true;

        if (!IERC20(feeToken).trySafeTransferFrom(msg.sender, feeRecipient, baseFee)) {
            revert FeeTransferFailed();
        }
        emit FeeCollected(authorization.vaultId, msg.sender, baseFee);
        emit VaultClaimed(authorization.vaultId, authorization.recipient, msg.sender, authorization.nonce);

        _sweepTokens(authorization.vaultId, owner, authorization.recipient);
    }

    function previewFee(bytes32 vaultId) external view returns (uint256) {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();
        if (!v.active) revert VaultInactive();
        return baseFee;
    }

    function _sweepTokens(bytes32 vaultId, address owner, address recipient) internal {
        TokenEntry[] storage entries = vaultTokens[vaultId];
        for (uint256 i = 0; i < entries.length; i++) {
            TokenEntry storage entry = entries[i];
            if (entry.isERC721) {
                _sweepERC721(vaultId, entry.tokenAddress, owner, recipient);
            } else {
                _sweepERC20(vaultId, entry.tokenAddress, owner, recipient);
            }
        }
    }

    function _sweepERC20(bytes32 vaultId, address token, address owner, address recipient) internal {
        uint256 allowed;
        try IERC20(token).allowance(owner, address(this)) returns (uint256 value) {
            allowed = value;
        } catch {
            emit TokenTransferFailed(vaultId, token, recipient, "allowance query failed");
            return;
        }

        uint256 balance;
        try IERC20(token).balanceOf(owner) returns (uint256 value) {
            balance = value;
        } catch {
            emit TokenTransferFailed(vaultId, token, recipient, "balance query failed");
            return;
        }

        uint256 amount = allowed < balance ? allowed : balance;
        if (amount == 0) {
            emit TokenTransferFailed(vaultId, token, recipient, "nothing transferable");
            return;
        }

        if (IERC20(token).trySafeTransferFrom(owner, recipient, amount)) {
            emit TokenTransferSucceeded(vaultId, token, recipient, amount);
        } else {
            emit TokenTransferFailed(vaultId, token, recipient, "transfer failed");
        }
    }

    function _sweepERC721(bytes32 vaultId, address token, address owner, address recipient) internal {
        uint256 balance;
        try IERC721(token).balanceOf(owner) returns (uint256 value) {
            balance = value;
        } catch {
            emit TokenTransferFailed(vaultId, token, recipient, "balance query failed");
            return;
        }

        if (balance == 0) {
            emit TokenTransferFailed(vaultId, token, recipient, "owner holds none");
            return;
        }

        uint256 count = balance > MAX_NFTS_PER_TOKEN ? MAX_NFTS_PER_TOKEN : balance;
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId;
            try IERC721Enumerable(token).tokenOfOwnerByIndex(owner, 0) returns (uint256 id) {
                tokenId = id;
            } catch {
                emit TokenTransferFailed(vaultId, token, recipient, "collection is not enumerable");
                return;
            }

            try IERC721(token).safeTransferFrom(owner, recipient, tokenId) {
                emit TokenTransferSucceeded(vaultId, token, recipient, tokenId);
            } catch {
                emit TokenTransferFailed(vaultId, token, recipient, "NFT transfer failed");
                return;
            }
        }

        if (balance > MAX_NFTS_PER_TOKEN) {
            emit TokenTransferFailed(vaultId, token, recipient, "NFT transfer cap reached");
        }
    }

    function getStatus(bytes32 vaultId)
        external
        view
        returns (bool expired, uint256 timeRemaining, bool active, bool locked, uint256 cooldownRemaining)
    {
        Vault storage v = vaults[vaultId];
        if (!v.exists) revert VaultNotFound();

        active = v.active;
        uint256 expiry = v.lastActive + v.inactivityPeriod;
        if (block.timestamp >= expiry) {
            expired = true;
        } else {
            timeRemaining = expiry - block.timestamp;
        }
        locked = false;
        cooldownRemaining = 0;
    }

    function getVaultTokens(bytes32 vaultId) external view returns (TokenEntry[] memory) {
        return vaultTokens[vaultId];
    }

    function getOwnerVaults(address owner) external view returns (bytes32[] memory) {
        return ownerVaultIds[owner];
    }
}
