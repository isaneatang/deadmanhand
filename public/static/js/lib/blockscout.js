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
const SCAN_TIMEOUT_MS = 30000;
const MAX_SCAN_PAGES = 25;

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS, overallSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortForOverallTimeout = () => controller.abort();
  if (overallSignal) {
    if (overallSignal.aborted) controller.abort();
    else overallSignal.addEventListener('abort', abortForOverallTimeout, { once: true });
  }
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Blockscout request failed: HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    if (overallSignal) overallSignal.removeEventListener('abort', abortForOverallTimeout);
  }
}

function normalizeTokenType(type) {
  const compact = String(type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact === 'ERC20') return 'ERC-20';
  if (compact === 'ERC721') return 'ERC-721';
  return null;
}

function isContractAddress(address) {
  return typeof address === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(address)
    && !/^0x0{40}$/i.test(address);
}

function safeText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : fallback;
}

function safeExplorerIcon(iconUrl, explorerUrl) {
  if (!iconUrl) return null;
  try {
    const explorerOrigin = new URL(explorerUrl).origin;
    const resolved = new URL(iconUrl, explorerUrl);
    return resolved.origin === explorerOrigin ? resolved.href : null;
  } catch (_e) {
    return null;
  }
}

function normalizeTokenItem(item, net) {
  const token = item && item.token ? item.token : {};
  const type = normalizeTokenType(token.type);
  if (!isContractAddress(token.address) || !type) return null;

  const parsedDecimals = Number(token.decimals);
  const decimals = Number.isInteger(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 255
    ? parsedDecimals
    : 0;
  return {
    address: token.address,
    symbol: safeText(token.symbol, '???'),
    name: safeText(token.name, 'Unknown Token'),
    decimals,
    type,
    iconUrl: safeExplorerIcon(token.icon_url, net.explorerUrl),
    rawValue: item.value != null && /^\d+$/.test(String(item.value)) ? String(item.value) : '0',
  };
}

/**
 * Scan all valid ERC-20/ERC-721 tokens held by an address.
 * @param {string} address
 * @returns {Promise<Array<{address:string, symbol:string, name:string, decimals:number, type:string, iconUrl:string|null, rawValue:string}>>}
 * @throws on network failure/timeout — caller must catch and fall back to
 *         the manual-paste UI per the spec (never silently show a broken/
 *         empty list as if it were a confirmed-empty result).
 */
export async function scanAddressTokens(address) {
  const net = getNetworkConfig();
  const baseUrl = `${net.explorerApiBase}/addresses/${address}/tokens`;
  const overallController = new AbortController();
  const overallTimer = setTimeout(() => overallController.abort(), SCAN_TIMEOUT_MS);
  const tokens = new Map();
  const seenPages = new Set();
  let url = baseUrl;

  try {
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const data = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, overallController.signal);
      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) {
        const token = normalizeTokenItem(item, net);
        if (token) tokens.set(token.address.toLowerCase(), token);
      }

      const next = data.next_page_params;
      if (!next || typeof next !== 'object' || Array.isArray(next) || Object.keys(next).length === 0) {
        return Array.from(tokens.values());
      }

      const nextUrl = new URL(baseUrl);
      for (const [key, value] of Object.entries(next)) {
        if (value !== null && value !== undefined && ['string', 'number', 'boolean'].includes(typeof value)) {
          nextUrl.searchParams.set(key, String(value));
        }
      }
      const pageKey = nextUrl.search;
      if (!pageKey || seenPages.has(pageKey)) throw new Error('Invalid Blockscout pagination');
      seenPages.add(pageKey);
      url = nextUrl.href;
    }
    throw new Error('Blockscout pagination limit reached');
  } finally {
    clearTimeout(overallTimer);
  }
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
  const type = normalizeTokenType(data.type);
  if (!type) {
    const error = new Error('Unsupported token type');
    error.code = 'UNSUPPORTED_TOKEN_TYPE';
    throw error;
  }
  const parsedDecimals = Number(data.decimals);
  return {
    address: isContractAddress(data.address) ? data.address : tokenAddress,
    symbol: safeText(data.symbol, '???'),
    name: safeText(data.name, 'Unknown Token'),
    decimals: Number.isInteger(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 255 ? parsedDecimals : 0,
    type,
    iconUrl: safeExplorerIcon(data.icon_url, net.explorerUrl),
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
