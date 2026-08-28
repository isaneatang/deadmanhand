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

export async function createVault(vaultId, secretHash, inactivityPeriodSeconds) {
  const dmh = getDmhWriteContract();
  const tx = await dmh.createVault(vaultId, secretHash, BigInt(inactivityPeriodSeconds));
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
 * @returns {{expired: boolean, timeRemaining: bigint, active: boolean, locked: boolean, cooldownRemaining: bigint}}
 */
export async function getVaultStatus(vaultId) {
  const dmh = getDmhReadContract();
  const result = await dmh.getStatus(vaultId);
  return {
    expired: result.expired,
    timeRemaining: result.timeRemaining,
    active: result.active,
    locked: result.locked,
    cooldownRemaining: result.cooldownRemaining,
  };
}

/**
 * Fetch the owner address stored for a vaultId (public `vaults` mapping
 * getter) — needed client-side to recompute the secret hash for comparison
 * before/while calling attemptUnlock.
 */
export async function getVaultOwner(vaultId) {
  const dmh = getDmhReadContract();
  const result = await dmh.vaults(vaultId);
  return result.owner ?? result[0];
}

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

export async function getFailedAttempts(vaultId) {
  const dmh = getDmhReadContract();
  return dmh.getFailedAttempts(vaultId);
}

/**
 * Full claim flow step: approve the fee token for the current previewed
 * fee amount (only if allowance is insufficient), then call attemptUnlock.
 * Returns the transaction receipt plus decoded UnlockAttempted/TokenTransfer*
 * events so the result screen can show an itemized outcome.
 */
export async function attemptUnlock(vaultId, secretPlaintext, claimantAddress) {
  const net = requireDeployedAddress();
  if (!net.usdtAddress) {
    throw new Error(
      `USDT is not available/confirmed on ${net.chainName} yet — the unlock fee cannot be paid. See config/network.js.`
    );
  }

  const dmh = getDmhWriteContract();
  const fee = await dmh.previewFee(vaultId);

  const usdt = getErc20WriteContract(net.usdtAddress);
  const currentAllowance = await usdt.allowance(claimantAddress, net.dmhContractAddress);
  if (currentAllowance < fee) {
    const approveTx = await usdt.approve(net.dmhContractAddress, fee);
    await approveTx.wait();
  }

  const tx = await dmh.attemptUnlock(vaultId, secretPlaintext);
  const receipt = await tx.wait();

  const iface = new ethers.Interface(DMH_ABI);
  const succeeded = [];
  const failed = [];
  let matched = false;

  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch (_e) {
      continue; // not one of our events (e.g. raw ERC20 Transfer log)
    }
    if (!parsed) continue;

    if (parsed.name === 'UnlockAttempted') {
      matched = parsed.args.success;
    } else if (parsed.name === 'TokenTransferSucceeded') {
      succeeded.push({ token: parsed.args.token, amountOrId: parsed.args.amountOrId });
    } else if (parsed.name === 'TokenTransferFailed') {
      failed.push({ token: parsed.args.token, reason: parsed.args.reason });
    }
  }

  return { receipt, matched, succeeded, failed, feePaid: fee };
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
