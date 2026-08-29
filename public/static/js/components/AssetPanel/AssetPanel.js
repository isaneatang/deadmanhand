// components/AssetPanel/AssetPanel.js
//
// Per UI Addendum v2 Section 4. Shows: native BOT balance, USDT balance
// (hidden cleanly if unconfirmed on this network), and all other
// ERC-20/ERC-721 holdings via Blockscout, each with an optional
// "include in vault" toggle for the setup flow. Includes the manual-paste
// fallback if the scan fails/times out.

import { ethers } from '../../lib/ethers.js';
import { getNetworkConfig } from '../../config/network.js';
import { scanAddressTokens, lookupTokenMetadata } from '../../lib/blockscout.js';
import { getReadOnlyProvider } from '../../lib/wallet.js';
import { getErc20ReadContract } from '../../lib/contract.js';
import { el, showToast } from '../theme/ui.js';

const MAX_SELECTED_ASSETS = 50;

/**
 * @param {object} opts
 * @param {string} opts.address - the wallet address to display holdings for
 * @param {boolean} opts.selectable - if true, renders an "include in vault" toggle per asset row
 * @param {(selectedAssets: Array<{address:string,symbol:string,decimals:number,type:string}>) => void} [opts.onSelectionChange]
 * @returns {{ node: HTMLElement, refresh: () => Promise<void>, getSelectedAssets: () => Array }}
 */
export function renderAssetPanel({ address, selectable = false, onSelectionChange }) {
  const net = getNetworkConfig();
  const container = el('div', { class: 'dmh-card' });
  const selected = new Map(); // tokenAddress -> asset
  let selectionFeedback = null;

  function assetKey(asset) {
    return asset.address.toLowerCase();
  }

  function updateSelectionFeedback(limitReached = false) {
    if (!selectionFeedback) return;
    selectionFeedback.textContent = limitReached || selected.size >= MAX_SELECTED_ASSETS
      ? `Maximum ${MAX_SELECTED_ASSETS} assets selected. Remove one to select another.`
      : `${selected.size} of ${MAX_SELECTED_ASSETS} assets selected.`;
  }

  function notifySelectionChange() {
    updateSelectionFeedback();
    onSelectionChange && onSelectionChange(Array.from(selected.values()));
  }

  function iconOrFallback(iconUrl, symbol) {
    try {
      const resolved = new URL(iconUrl, net.explorerUrl);
      if (iconUrl && resolved.origin === new URL(net.explorerUrl).origin) {
        const img = el('img', { src: resolved.href, alt: '', onError: (e) => { e.target.style.display = 'none'; } });
        return el('div', { class: 'dmh-asset-icon', 'aria-hidden': 'true' }, img);
      }
    } catch (_e) {
      // Fall through to the local text fallback for invalid/untrusted URLs.
    }
    return el('div', { class: 'dmh-asset-icon', 'aria-hidden': 'true' }, (symbol || '?').slice(0, 3).toUpperCase());
  }

  function renderAssetRow(asset, opts = {}) {
    const { toggleable = false, alreadySelected = false } = opts;
    const balanceDisplay = asset.balanceUnavailable
      ? 'Balance unavailable'
      : asset.decimals != null
      ? formatTokenAmount(asset.rawValue, asset.decimals)
      : asset.rawValue;

    const row = el('div', { class: 'dmh-asset-row' }, [
      iconOrFallback(asset.iconUrl, asset.symbol),
      el('div', { class: 'dmh-asset-info' }, [
        el('div', { class: 'dmh-asset-symbol' }, asset.symbol),
        el('div', { class: 'dmh-asset-balance mono' }, `${balanceDisplay} · ${asset.displayType || asset.type || 'ERC-20'}`),
      ]),
    ]);

    if (toggleable) {
      let isOn = alreadySelected;
      const knob = el('div', { class: 'dmh-toggle-knob' });
      const toggle = el('button', {
        class: `dmh-toggle${isOn ? ' on' : ''}`,
        style: 'padding:0;',
        type: 'button',
        role: 'switch',
        'aria-checked': String(isOn),
        'aria-label': `Include ${asset.symbol} in vault`,
      }, knob);
      toggle.addEventListener('click', () => {
        if (!isOn && selected.size >= MAX_SELECTED_ASSETS) {
          updateSelectionFeedback(true);
          showToast(`You can select up to ${MAX_SELECTED_ASSETS} assets.`, 'error');
          return;
        }
        isOn = !isOn;
        toggle.classList.toggle('on', isOn);
        toggle.setAttribute('aria-checked', String(isOn));
        if (isOn) {
          selected.set(assetKey(asset), asset);
        } else {
          selected.delete(assetKey(asset));
        }
        notifySelectionChange();
      });
      row.appendChild(toggle);
      if (isOn) selected.set(assetKey(asset), asset);
    }

    return row;
  }

  async function loadNativeAndUsdt() {
    const rows = [];
    try {
      const provider = getReadOnlyProvider();
      const balanceWei = await provider.getBalance(address);
      rows.push(
        renderAssetRow({
          address: null,
          symbol: net.nativeCurrency.symbol,
          type: 'Native',
          decimals: net.nativeCurrency.decimals,
          rawValue: balanceWei.toString(),
          iconUrl: null,
        })
      );
    } catch (e) {
      rows.push(el('div', { class: 'dmh-hint' }, `Native ${net.nativeCurrency.symbol} balance is unavailable.`));
    }
    rows.push(el('div', { class: 'dmh-hint' }, `Native ${net.nativeCurrency.symbol} is unsupported for vault protection and is display-only.`));

    if (net.usdtAddress) {
      try {
        const usdt = getErc20ReadContract(net.usdtAddress);
        const [balance, decimals] = await Promise.all([usdt.balanceOf(address), usdt.decimals()]);
        rows.push(
          renderAssetRow({
            address: net.usdtAddress,
            symbol: 'USDT',
            type: 'ERC-20',
            displayType: 'ERC-20 (fee token)',
            decimals: Number(decimals),
            rawValue: balance.toString(),
            iconUrl: null,
          }, {
            toggleable: selectable,
            alreadySelected: selected.has(net.usdtAddress.toLowerCase()),
          })
        );
      } catch (e) {
        rows.push(
          renderAssetRow({
            address: net.usdtAddress,
            symbol: 'USDT',
            type: 'ERC-20',
            displayType: 'ERC-20 (fee token)',
            decimals: net.usdtDecimals,
            rawValue: null,
            balanceUnavailable: true,
            iconUrl: null,
          }, {
            toggleable: selectable,
            alreadySelected: selected.has(net.usdtAddress.toLowerCase()),
          })
        );
      }
    } else {
      // Per spec: hide cleanly rather than showing a broken 0 / error state.
      rows.push(
        el('div', { class: 'dmh-warning-banner' }, [
          `USDT is not available/confirmed on ${net.chainName} yet. The unlock fee cannot be paid on this network — see config/network.js.`,
        ])
      );
    }
    return rows;
  }

  async function loadScannedTokens() {
    try {
      const tokens = await scanAddressTokens(address);
      // USDT already shown above; avoid duplicate row if it appears in the scan too.
      return tokens.filter((t) => !net.usdtAddress || t.address.toLowerCase() !== net.usdtAddress.toLowerCase());
    } catch (e) {
      return { failed: true };
    }
  }

  function renderManualPasteFallback(onAdd) {
    const inputId = `dmh-manual-token-${address.slice(2).toLowerCase()}`;
    const input = el('input', { id: inputId, class: 'dmh-input mono', placeholder: '0x... token contract address', type: 'text' });
    const typeChips = el('div', { class: 'dmh-chip-row', style: 'margin-top:8px;', role: 'group', 'aria-label': 'Token type' });
    let manualType = 'ERC-20';
    const chipErc20 = el('button', { class: 'dmh-chip selected', type: 'button', 'aria-pressed': 'true' }, 'ERC-20');
    const chipErc721 = el('button', { class: 'dmh-chip', type: 'button', 'aria-pressed': 'false' }, 'ERC-721 (NFT collection)');
    chipErc20.addEventListener('click', () => {
      manualType = 'ERC-20';
      chipErc20.classList.add('selected');
      chipErc721.classList.remove('selected');
      chipErc20.setAttribute('aria-pressed', 'true');
      chipErc721.setAttribute('aria-pressed', 'false');
    });
    chipErc721.addEventListener('click', () => {
      manualType = 'ERC-721';
      chipErc721.classList.add('selected');
      chipErc20.classList.remove('selected');
      chipErc721.setAttribute('aria-pressed', 'true');
      chipErc20.setAttribute('aria-pressed', 'false');
    });
    typeChips.appendChild(chipErc20);
    typeChips.appendChild(chipErc721);

    const addBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', style: 'margin-top:8px;' }, 'Add token');
    addBtn.addEventListener('click', async () => {
      const raw = input.value.trim();
      if (!ethers.isAddress(raw)) {
        showToast('Enter a valid contract address.', 'error');
        return;
      }
      const checksummed = ethers.getAddress(raw);
      if (/^0x0{40}$/i.test(checksummed)) {
        showToast('Enter a valid token contract address.', 'error');
        return;
      }
      addBtn.disabled = true;
      try {
        let meta;
        try {
          meta = await lookupTokenMetadata(checksummed);
        } catch (error) {
          if (error.code === 'UNSUPPORTED_TOKEN_TYPE') {
            showToast('Only ERC-20 tokens and ERC-721 collections are supported.', 'error');
            return;
          }
          meta = { address: checksummed, symbol: '???', name: 'Unknown Token', decimals: 0, type: manualType, iconUrl: null };
        }
        onAdd({ ...meta, rawValue: null, balanceUnavailable: true });
        input.value = '';
      } finally {
        addBtn.disabled = false;
      }
    });

    return el('div', { class: 'dmh-field', style: 'margin-top: 8px;' }, [
      el('label', { class: 'dmh-label', for: inputId }, "Can't see your token? Paste its contract address"),
      input,
      typeChips,
      addBtn,
    ]);
  }

  async function refresh() {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'dmh-card-title' }, 'Wallet Holdings'));
    container.appendChild(el('div', { style: 'display:flex; align-items:center; gap:8px; color: var(--dmh-text-muted); font-size:13px;' }, [
      el('span', { class: 'dmh-spinner' }),
      'Scanning holdings…',
    ]));

    const nativeRows = await loadNativeAndUsdt();
    const scanResult = await loadScannedTokens();

    container.innerHTML = '';
    container.appendChild(el('div', { class: 'dmh-card-title' }, 'Wallet Holdings'));
    if (selectable) {
      selectionFeedback = el('div', { class: 'dmh-hint', role: 'status', 'aria-live': 'polite' });
      container.appendChild(selectionFeedback);
      updateSelectionFeedback();
    }
    nativeRows.forEach((r) => container.appendChild(r));

    if (scanResult && scanResult.failed) {
      container.appendChild(
        el('div', { class: 'dmh-warning-banner' }, [
          'Could not scan your other holdings right now. You can still add tokens manually below.',
        ])
      );
    } else if (scanResult && scanResult.length > 0) {
      container.appendChild(el('div', { class: 'dmh-divider' }));
      for (const token of scanResult) {
        container.appendChild(
          renderAssetRow(
            { ...token, address: token.address },
            { toggleable: selectable, alreadySelected: selected.has(assetKey(token)) }
          )
        );
      }
    } else {
      container.appendChild(el('div', { class: 'dmh-empty-state' }, 'No other tokens/NFTs found for this address.'));
    }

    const visibleAddresses = new Set(
      Array.isArray(scanResult) ? scanResult.map((token) => assetKey(token)) : []
    );
    if (net.usdtAddress) visibleAddresses.add(net.usdtAddress.toLowerCase());
    for (const [key, asset] of selected) {
      if (!visibleAddresses.has(key)) {
        container.appendChild(renderAssetRow(asset, { toggleable: true, alreadySelected: true }));
      }
    }

    if (selectable) {
      container.appendChild(
        renderManualPasteFallback((asset) => {
          const key = assetKey(asset);
          if (selected.has(key)) {
            showToast('That asset is already selected.', 'info', 2500);
            return;
          }
          if (!selected.has(key) && selected.size >= MAX_SELECTED_ASSETS) {
            updateSelectionFeedback(true);
            showToast(`You can select up to ${MAX_SELECTED_ASSETS} assets.`, 'error');
            return;
          }
          selected.set(key, asset);
          container.insertBefore(
            renderAssetRow(asset, { toggleable: true, alreadySelected: true }),
            container.lastElementChild
          );
          notifySelectionChange();
          showToast('Token added. Balance unavailable.', 'success', 2500);
        })
      );
    }
  }

  refresh();

  return {
    node: container,
    refresh,
    getSelectedAssets: () => Array.from(selected.values()),
  };
}

function formatTokenAmount(rawValue, decimals) {
  try {
    const formatted = ethers.formatUnits(BigInt(rawValue), decimals);
    const num = Number(formatted);
    if (Number.isFinite(num)) {
      return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
    }
    return formatted;
  } catch (_e) {
    return rawValue;
  }
}
