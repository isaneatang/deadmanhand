// lib/blockscout.js
//
// Asset-scan API calls against BOT Chain's Blockscout instance, plus the
// manual-paste fallback contract described in Master Build Prompt Section
// 3.4/4.2 and UI Addendum v2 Section 4.
//
// Endpoint confirmed live against both scan.bohr.life and scan.botchain.ai
// at build time (2026-08-28):
//   GET {explorerApiBase}/addresses/{address}/tokens
//   -> { items: [{ token: {address, symbol, name, decimals, type, icon_url}, value }], next_page_params }
// This matches the shape anticipated in both build prompts; verified with a
// live curl against a real BOT-chain holder address before wiring it in
// (not fabricated).

import { getNetworkConfig } from '../config/network.js';

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Blockscout request failed: HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scan all ERC-20/ERC-721/ERC-1155 tokens held by an address.
 * @param {string} address
 * @returns {Promise<Array<{address:string, symbol:string, name:string, decimals:number, type:string, iconUrl:string|null, rawValue:string}>>}
 * @throws on network failure/timeout — caller must catch and fall back to
 *         the manual-paste UI per the spec (never silently show a broken/
 *         empty list as if it were a confirmed-empty result).
 */
export async function scanAddressTokens(address) {
  const net = getNetworkConfig();
  const url = `${net.explorerApiBase}/addresses/${address}/tokens`;
  const data = await fetchWithTimeout(url);

  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((item) => {
    const token = item.token || {};
    return {
      address: token.address,
      symbol: token.symbol || '???',
      name: token.name || 'Unknown Token',
      decimals: token.decimals != null ? Number(token.decimals) : 0,
      type: token.type || 'ERC-20',
      iconUrl: token.icon_url || null,
      rawValue: item.value != null ? String(item.value) : '0',
    };
  });
}

/**
 * Look up basic token metadata for a manually-pasted contract address —
 * used by the manual-paste fallback so the UI can still show a symbol/name
 * instead of just a bare address, even when the full holdings scan failed.
 */
export async function lookupTokenMetadata(tokenAddress) {
  const net = getNetworkConfig();
  const url = `${net.explorerApiBase}/tokens/${tokenAddress}`;
  const data = await fetchWithTimeout(url);
  return {
    address: data.address || tokenAddress,
    symbol: data.symbol || '???',
    name: data.name || 'Unknown Token',
    decimals: data.decimals != null ? Number(data.decimals) : 0,
    type: data.type || 'ERC-20',
    iconUrl: data.icon_url || null,
  };
}

/**
 * Resolve every vault registered to an owner address, by asking the
 * Blockscout instance's address page for BOT-chain wide search... actually
 * this app resolves owner->vaultIds on-chain (see lib/contract.js
 * getOwnerVaultIds), NOT via Blockscout. This function intentionally does
 * not exist here — kept out to avoid confusing two different address
 * lookups (asset scan vs. vault lookup).
 */
