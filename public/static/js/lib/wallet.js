// lib/wallet.js
//
// Thin wrapper around window.ethereum (EIP-1193) using ethers.js
// BrowserProvider. Targets normal EOA wallets (MetaMask, OKX, Trust Wallet,
// Rainbow, Coinbase Wallet in-app browsers, etc.) per Master Build Prompt
// Section 2 — no Safe/smart-account connection logic at all.

import { ethers } from './ethers.js';
import { getNetworkConfig } from '../config/network.js';

let cachedProvider = null;
let cachedSigner = null;

export function isWalletAvailable() {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
}

/**
 * Prompt the user's wallet to connect, returning the connected address.
 * Does NOT switch networks by itself — call ensureCorrectNetwork() after,
 * since the mainnet-confirmation UX (Section 7) needs to happen first for
 * mainnet actions.
 */
export async function connectWallet() {
  if (!isWalletAvailable()) {
    throw new Error('No wallet detected. Open this page inside a wallet app (MetaMask, OKX, etc.) or install a browser wallet extension.');
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send('eth_requestAccounts', []);
  if (!accounts || accounts.length === 0) {
    throw new Error('Wallet connection was rejected or returned no accounts.');
  }
  cachedProvider = provider;
  cachedSigner = await provider.getSigner();
  return ethers.getAddress(accounts[0]);
}

export function getCachedSigner() {
  return cachedSigner;
}

export function getCachedProvider() {
  return cachedProvider;
}

export function disconnectWalletCache() {
  cachedProvider = null;
  cachedSigner = null;
}

/**
 * Read-only provider for the active network — works even without a wallet
 * connected (used for lookup/status views that anyone can view).
 */
export function getReadOnlyProvider() {
  const net = getNetworkConfig();
  return new ethers.JsonRpcProvider(net.rpcUrl, { chainId: net.chainId, name: net.chainName });
}

/**
 * Ask the connected wallet to switch to (or add, if unknown) the active
 * network's chain. Required before any write tx, since a user might be
 * connected to some other chain entirely.
 */
export async function ensureCorrectNetwork() {
  if (!isWalletAvailable()) throw new Error('No wallet detected.');
  const net = getNetworkConfig();

  const currentChainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
  if (currentChainIdHex?.toLowerCase() === net.chainIdHex.toLowerCase()) {
    return; // already on the right chain
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: net.chainIdHex }],
    });
  } catch (switchError) {
    // 4902 = chain not added to this wallet yet — add it, then switch.
    if (switchError && switchError.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: net.chainIdHex,
            chainName: net.chainName,
            nativeCurrency: net.nativeCurrency,
            rpcUrls: [net.rpcUrl],
            blockExplorerUrls: [net.explorerUrl],
          },
        ],
      });
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: net.chainIdHex }],
      });
    } else {
      throw switchError;
    }
  }

  const confirmedChainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (confirmedChainId?.toLowerCase() !== net.chainIdHex.toLowerCase()) {
    throw new Error(`Switch your wallet to ${net.chainName} before continuing.`);
  }
}

export function onAccountsChanged(callback) {
  if (!isWalletAvailable()) return () => {};
  const handler = (accounts) => callback(accounts);
  window.ethereum.on('accountsChanged', handler);
  return () => window.ethereum.removeListener('accountsChanged', handler);
}

export function onChainChanged(callback) {
  if (!isWalletAvailable()) return () => {};
  const handler = (chainId) => callback(chainId);
  window.ethereum.on('chainChanged', handler);
  return () => window.ethereum.removeListener('chainChanged', handler);
}
