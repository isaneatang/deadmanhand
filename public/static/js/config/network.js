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
//   - testnet usdtAddress: confirmed by the product owner and verified live
//     via https://scan.bohr.life/api/v2/tokens/0x75edC9335175Fc0552D51D48439F229c10420fe3
//     -> { name: "Tether USD", symbol: "USDT", decimals: "6", holders: "1002" }.
//     (Blockscout's testnet instance lists several other tokens also named
//     "USDT" from unrelated test deployments — this specific address is the
//     one confirmed correct for this project, not a guess.)
//
// dmhContractAddress is intentionally null on both networks until
// DeadMansHand.sol is actually deployed. Fill these in immediately after
// running the deployment script (scripts/deploy.cjs) — see README
// "Deployment" section.

const NETWORKS = {
  testnet: {
    chainId: 968,
    chainIdHex: '0x3c8',
    chainName: 'BOT Chain Testnet',
    rpcUrl: 'https://rpc.bohr.life',
    explorerUrl: 'https://scan.bohr.life',
    explorerApiBase: 'https://scan.bohr.life/api/v2',
    nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
    usdtAddress: '0x75edC9335175Fc0552D51D48439F229c10420fe3', // confirmed testnet Tether USD
    usdtDecimals: 6,
    faucetUrl: 'https://faucet.botchain.ai/basic',
    dmhContractAddress: null, // fill in after deployment
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
    dmhContractAddress: null, // fill in after deployment
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
