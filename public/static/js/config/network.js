// config/network.js
//
// Single source of truth for BOT Chain network parameters. Per DMH UI Build
// Prompt Addendum v2, Section 3: nothing else in the codebase should
// hardcode a chain ID, RPC URL, explorer URL, or token address — everything
// must go through getNetworkConfig().
//
// Values verified against BOT Chain's own dev docs and live Blockscout
// instances at build time (2026-08-28):
//   - chainId / rpcUrl / explorerUrl / faucetUrl: confirmed via
//     https://dev-docs.bohr.life/docs/Developers/quick-guide/
//   - mainnet usdtAddress: confirmed via live query against
//     https://scan.botchain.ai/api/v2/tokens?q=USDT (bridged USDT, 291k+
//     holders, exchange_rate "1" — the canonical bridged USDT for BOT Chain
//     mainnet).
//   - testnet usdtAddress: UNVERIFIED. Blockscout's testnet instance
//     (scan.bohr.life) lists at least a dozen different tokens named/symbol
//     "USDT" (test deployments from many different builders — see
//     scan.bohr.life/tokens), with no single canonical "the" testnet USDT.
//     Per the Master Build Prompt (Section 3.3) and Addendum v2 (Section 3),
//     this must not be guessed. It is left null; the UI must hide the USDT
//     balance row and disable fee-based actions on testnet with a visible
//     "not available on testnet" notice until a real testnet USDT contract
//     is confirmed and filled in here.
//
// dmhContractAddress is intentionally null on both networks: DeadMansHand.sol
// has not been deployed anywhere yet (this is a from-scratch build). Fill
// these in immediately after running the deployment script
// (scripts/deploy.cjs) — see README "Deployment" section.

const NETWORKS = {
  testnet: {
    chainId: 968,
    chainIdHex: '0x3c8',
    chainName: 'BOT Chain Testnet',
    rpcUrl: 'https://rpc.bohr.life',
    explorerUrl: 'https://scan.bohr.life',
    explorerApiBase: 'https://scan.bohr.life/api/v2',
    nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
    usdtAddress: null, // UNVERIFIED — see note above. Do not fabricate.
    usdtDecimals: 6,
    faucetUrl: 'https://faucet.botchain.ai/basic',
    dmhContractAddress: null, // UNVERIFIED — fill in after deployment
  },
  mainnet: {
    chainId: 677,
    chainIdHex: '0x2a5',
    chainName: 'BOT Chain',
    rpcUrl: 'https://rpc.botchain.ai',
    explorerUrl: 'https://scan.botchain.ai',
    explorerApiBase: 'https://scan.botchain.ai/api/v2',
    nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
    usdtAddress: '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C', // confirmed bridged USDT
    usdtDecimals: 6,
    faucetUrl: null,
    dmhContractAddress: null, // UNVERIFIED — fill in after deployment
  },
};

// The ONLY place this flag is set. Change this one value to switch networks
// app-wide. Kept in localStorage so a user's explicit testnet/mainnet choice
// (Section 8.3 network badge / switch) persists across reloads without
// needing a server round-trip.
const STORAGE_KEY = 'dmh_active_network';
const DEFAULT_NETWORK = 'testnet';

export function getActiveNetworkKey() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'testnet' || stored === 'mainnet') return stored;
  } catch (_e) {
    // localStorage unavailable (rare, e.g. some in-app browser privacy modes)
  }
  return DEFAULT_NETWORK;
}

export function setActiveNetworkKey(key) {
  if (key !== 'testnet' && key !== 'mainnet') {
    throw new Error(`Invalid network key: ${key}`);
  }
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch (_e) {
    // ignore — falls back to DEFAULT_NETWORK on next load
  }
}

export function getNetworkConfig() {
  return NETWORKS[getActiveNetworkKey()];
}

export function getAllNetworkKeys() {
  return Object.keys(NETWORKS);
}

export function getNetworkConfigFor(key) {
  return NETWORKS[key];
}
