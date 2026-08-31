// lib/contract.js
//
// DeadMansHand contract interaction helpers. All calls resolve the contract
// address via getNetworkConfig() — never a hardcoded address (Section 8.3).

import { ethers } from './ethers.js';
import { DMH_ABI } from './dmhAbi.js';
import { ERC20_ABI, ERC721_ABI } from './erc20Abi.js';
import { getNetworkConfig } from '../config/network.js';
import { getReadOnlyProvider, getCachedSigner } from './wallet.js';

export class DmhNotDeployedError extends Error {
  constructor(networkName) {
    super(
      `Dead Man's Hand is not yet deployed on ${networkName}. dmhContractAddress is UNVERIFIED/null in config/network.js — deploy the contract (scripts/deploy.cjs) and fill in the address before using this feature.`
    );
    this.name = 'DmhNotDeployedError';
  }
}

function requireDeployedAddress() {
  const net = getNetworkConfig();
  if (!net.dmhContractAddress) {
    throw new DmhNotDeployedError(net.chainName);
  }
  return net;
}

export function getDmhReadContract() {
  const net = requireDeployedAddress();
  return new ethers.Contract(net.dmhContractAddress, DMH_ABI, getReadOnlyProvider());
}

export function getDmhWriteContract() {
  const net = requireDeployedAddress();
  const signer = getCachedSigner();
  if (!signer) throw new Error('Wallet not connected.');
  return new ethers.Contract(net.dmhContractAddress, DMH_ABI, signer);
}

export function getErc20ReadContract(tokenAddress, providerOrSigner) {
  return new ethers.Contract(tokenAddress, ERC20_ABI, providerOrSigner || getReadOnlyProvider());
}

export function getErc20WriteContract(tokenAddress) {
  const signer = getCachedSigner();
  if (!signer) throw new Error('Wallet not connected.');
  return new ethers.Contract(tokenAddress, ERC20_ABI, signer);
}

export function getErc721WriteContract(tokenAddress) {
  const signer = getCachedSigner();
  if (!signer) throw new Error('Wallet not connected.');
  return new ethers.Contract(tokenAddress, ERC721_ABI, signer);
}

// ---------------------------------------------------------------------
// High-level operations
// ---------------------------------------------------------------------

export async function createVault(vaultId, authorizationSigner, kdfSalt, kdfVersion, inactivityPeriodSeconds) {
  const dmh = getDmhWriteContract();
  const tx = await dmh.createVault(vaultId, authorizationSigner, kdfSalt, kdfVersion, BigInt(inactivityPeriodSeconds));
  return tx.wait();
}

export async function addTokenToVault(vaultId, tokenAddress, isERC721) {
  const dmh = getDmhWriteContract();
  const tx = await dmh.addToken(vaultId, tokenAddress, isERC721);
  return tx.wait();
}

export async function pingVault(vaultId) {
  const dmh = getDmhWriteContract();
  const tx = await dmh.ping(vaultId);
  return tx.wait();
}

export async function deactivateVault(vaultId) {
  const dmh = getDmhWriteContract();
  const tx = await dmh.deactivateVault(vaultId);
  return tx.wait();
}

/**
 * @returns {{expired: boolean, timeRemaining: bigint, active: boolean, claimed: boolean}}
 */
export async function getVaultStatus(vaultId) {
  const dmh = getDmhReadContract();
  const result = await getVaultMetadata(vaultId);
  if (!result.exists) throw new Error('No vault found with that ID.');
  const block = await getReadOnlyProvider().getBlock('latest');
  const remaining = BigInt(result.lastActive) + BigInt(result.inactivityPeriod) - BigInt(block.timestamp);
  return {
    expired: remaining <= 0n,
    timeRemaining: remaining > 0n ? remaining : 0n,
    active: result.active,
    claimed: result.claimed, locked: false, cooldownRemaining: 0n,
  };
}

export async function getVaultMetadata(vaultId) {
  const result = await getDmhReadContract().vaults(vaultId);
  return Object.fromEntries(['owner','authorizationSigner','kdfSalt','kdfVersion','inactivityPeriod','lastActive','active','claimed','exists','claimNonce'].map((key, i) => [key, result[key] ?? result[i]]));
}

/**
 * Fetch the owner address stored for a vaultId.
 */
export async function getVaultOwner(vaultId) { return (await getVaultMetadata(vaultId)).owner; }

export async function getOwnerVaultIds(ownerAddress) {
  const dmh = getDmhReadContract();
  return dmh.getOwnerVaults(ownerAddress);
}

export async function getVaultTokens(vaultId) {
  const dmh = getDmhReadContract();
  const entries = await dmh.getVaultTokens(vaultId);
  return entries.map((e) => ({ tokenAddress: e.tokenAddress ?? e[0], isERC721: e.isERC721 ?? e[1] }));
}

export async function previewFee(vaultId) {
  const dmh = getDmhReadContract();
  return dmh.previewFee(vaultId);
}

export async function getFailedAttempts(_vaultId) { return 0n; }

/**
 * Approve the fee token when needed, then submit a signed v2 claim. The
 * phrase is intentionally not an argument to this function.
 */
export async function submitClaim(claim, signature) {
  const net = requireDeployedAddress();
  if (!net.usdtAddress) {
    throw new Error(
      `USDT is not available/confirmed on ${net.chainName} yet — the unlock fee cannot be paid. See config/network.js.`
    );
  }

  const dmh = getDmhWriteContract();
  const signer = getCachedSigner();
  const signerAddress = ethers.getAddress(await signer.getAddress());
  if (signerAddress !== ethers.getAddress(claim.feePayer)) {
    throw new Error('The connected wallet changed after the claim was signed. Reconnect and sign again.');
  }
  const walletNetwork = await signer.provider.getNetwork();
  if (walletNetwork.chainId !== BigInt(net.chainId)) {
    throw new Error(`The connected wallet is not on ${net.chainName}.`);
  }
  const fee = BigInt(claim.maxFee);

  const feeToken = await dmh.feeToken();
  const usdt = getErc20WriteContract(feeToken);
  const balance = await usdt.balanceOf(claim.feePayer);
  if (balance < fee) {
    throw new Error(
      `The fee-paying wallet needs ${ethers.formatUnits(fee, net.usdtDecimals || 6)} USDT but only has ${ethers.formatUnits(balance, net.usdtDecimals || 6)} USDT.`
    );
  }
  const currentAllowance = await usdt.allowance(claim.feePayer, net.dmhContractAddress);
  if (currentAllowance < fee) {
    const approveTx = await usdt.approve(net.dmhContractAddress, fee);
    await approveTx.wait();
  }

  // Run the exact signed claim first so stale vault state, signatures, fees,
  // and token-transfer failures are reported before asking for another tx.
  try {
    await dmh.claim.staticCall(claim, signature);
  } catch (error) {
    throw new Error(describeClaimError(error));
  }

  const tx = await dmh.claim(claim, signature);
  const receipt = await tx.wait();

  const iface = new ethers.Interface(DMH_ABI);
  const succeeded = [];
  const failed = [];
  let matched = false;
  let recipient = claim.recipient;
  let feePayer = claim.feePayer;
  let feePaid = fee;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== net.dmhContractAddress.toLowerCase()) continue;
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch (_e) {
      continue; // not one of our events (e.g. raw ERC20 Transfer log)
    }
    if (!parsed) continue;

    if (parsed.name === 'VaultClaimed') {
      matched = true;
      recipient = parsed.args.recipient;
      feePayer = parsed.args.feePayer;
    } else if (parsed.name === 'FeeCollected') {
      feePaid = parsed.args.amount;
    }
    else if (parsed.name === 'TokenTransferSucceeded') {
      succeeded.push({ token: parsed.args.token, amountOrId: parsed.args.amountOrId });
    } else if (parsed.name === 'TokenTransferFailed') {
      failed.push({ token: parsed.args.token, reason: parsed.args.reason });
    }
  }

  if (!matched) throw new Error('The claim receipt did not contain the expected vault confirmation event.');

  return { receipt, matched, recipient, feePayer, succeeded, failed, feePaid };
}

function describeClaimError(error) {
  const data = extractRevertData(error);
  if (data) {
    try {
      const parsed = new ethers.Interface(DMH_ABI).parseError(data);
      if (parsed) {
        if (parsed.name === 'NotExpiredYet') return `This vault is not claimable for another ${parsed.args.timeRemaining} seconds.`;
        const messages = {
          VaultNotFound: 'The vault no longer exists at the configured contract.',
          VaultInactive: 'This vault is already claimed or was deactivated.',
          InvalidFeePayer: 'The connected wallet is not the fee payer signed into this claim.',
          InvalidRecipient: 'The claim recipient is invalid.',
          InvalidNonce: 'The vault changed after lookup. Return to lookup and load it again.',
          AuthorizationExpired: 'The signed claim expired. Submit it again to create a fresh authorization.',
          FeeExceedsMaximum: 'The contract fee changed after this claim was prepared. Reload the claim.',
          InvalidSignature: 'The generated authorization signature was rejected by the contract.',
          FeeTransferFailed: 'The 1 USDT fee transfer failed. Check the fee payer balance and approval, then retry.',
        };
        if (messages[parsed.name]) return messages[parsed.name];
        return `Claim rejected: ${parsed.name}.`;
      }
    } catch (_error) {
      // Fall through to the wallet/provider message when the selector is not
      // emitted by the DMH contract.
    }
  }
  return error.shortMessage || error.reason || error.message || 'The claim simulation was rejected.';
}

function extractRevertData(error) {
  const candidates = [
    error?.data,
    error?.info?.error?.data,
    error?.error?.data,
    error?.cause?.data,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^0x[0-9a-f]+$/i.test(candidate)) return candidate;
    if (typeof candidate?.data === 'string' && /^0x[0-9a-f]+$/i.test(candidate.data)) return candidate.data;
  }
  return null;
}

/**
 * Resolve an owner address to its vault(s), then fetch status for each.
 * Used by the claimant lookup flow (address-primary per Section 8/4.5).
 */
export async function lookupVaultsByAddress(ownerAddress) {
  const vaultIds = await getOwnerVaultIds(ownerAddress);
  const results = [];
  for (const vaultId of vaultIds) {
    const status = await getVaultStatus(vaultId);
    results.push({ vaultId, ...status });
  }
  return results;
}
