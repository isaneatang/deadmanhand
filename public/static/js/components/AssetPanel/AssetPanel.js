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

  function notifySelectionChange() {
    onSelectionChange && onSelectionChange(Array.from(selected.values()));
  }

  function iconOrFallback(iconUrl, symbol) {
    if (iconUrl) {
      const img = el('img', { src: iconUrl, alt: symbol, onError: (e) => { e.target.style.display = 'none'; } });
      return el('div', { class: 'dmh-asset-icon' }, img);
    }
    return el('div', { class: 'dmh-asset-icon' }, (symbol || '?').slice(0, 3).toUpperCase());
  }

  function renderAssetRow(asset, opts = {}) {
    const { toggleable = false, alreadySelected = false } = opts;
    const balanceDisplay = asset.decimals != null
      ? formatTokenAmount(asset.rawValue, asset.decimals)
      : asset.rawValue;

    const row = el('div', { class: 'dmh-asset-row' }, [
      iconOrFallback(asset.iconUrl, asset.symbol),
      el('div', { class: 'dmh-asset-info' }, [
        el('div', { class: 'dmh-asset-symbol' }, asset.symbol),
        el('div', { class: 'dmh-asset-balance mono' }, `${balanceDisplay} · ${asset.type || 'ERC-20'}`),
      ]),
    ]);

    if (toggleable) {
      let isOn = alreadySelected;
      const knob = el('div', { class: 'dmh-toggle-knob' });
      const toggle = el('div', { class: `dmh-toggle${isOn ? ' on' : ''}` }, knob);
      toggle.addEventListener('click', () => {
        isOn = !isOn;
        toggle.classList.toggle('on', isOn);
        if (isOn) {
          selected.set(asset.address, asset);
        } else {
          selected.delete(asset.address);
        }
        notifySelectionChange();
      });
      row.appendChild(toggle);
      if (isOn) selected.set(asset.address, asset);
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
      rows.push(el('div', { class: 'dmh-hint' }, `Could not load native ${net.nativeCurrency.symbol} balance: ${e.message}`));
    }

    if (net.usdtAddress) {
      try {
        const usdt = getErc20ReadContract(net.usdtAddress);
        const [balance, decimals] = await Promise.all([usdt.balanceOf(address), usdt.decimals()]);
        rows.push(
          renderAssetRow({
            address: net.usdtAddress,
            symbol: 'USDT',
            type: 'ERC-20 (fee token)',
            decimals: Number(decimals),
            rawValue: balance.toString(),
            iconUrl: null,
          })
        );
      } catch (e) {
        rows.push(el('div', { class: 'dmh-hint' }, `Could not load USDT balance: ${e.message}`));
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
      return { failed: true, error: e };
    }
  }

  function renderManualPasteFallback(onAdd) {
    const input = el('input', { class: 'dmh-input mono', placeholder: '0x... token contract address', type: 'text' });
    const typeChips = el('div', { class: 'dmh-chip-row', style: 'margin-top:8px;' });
    let manualType = 'ERC-20';
    const chipErc20 = el('button', { class: 'dmh-chip selected', type: 'button' }, 'ERC-20');
    const chipErc721 = el('button', { class: 'dmh-chip', type: 'button' }, 'ERC-721 (NFT collection)');
    chipErc20.addEventListener('click', () => {
      manualType = 'ERC-20';
      chipErc20.classList.add('selected');
      chipErc721.classList.remove('selected');
    });
    chipErc721.addEventListener('click', () => {
      manualType = 'ERC-721';
      chipErc721.classList.add('selected');
      chipErc20.classList.remove('selected');
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
      addBtn.disabled = true;
      try {
        let meta;
        try {
          meta = await lookupTokenMetadata(checksummed);
        } catch (_e) {
          meta = { address: checksummed, symbol: '???', name: 'Unknown Token', decimals: 0, type: manualType, iconUrl: null };
        }
        onAdd({ ...meta, type: manualType, rawValue: '0' });
        input.value = '';
        showToast('Token added.', 'success', 2000);
      } finally {
        addBtn.disabled = false;
      }
    });

    return el('div', { class: 'dmh-field', style: 'margin-top: 8px;' }, [
      el('label', { class: 'dmh-label' }, "Can't see your token? Paste its contract address"),
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
    nativeRows.forEach((r) => container.appendChild(r));

    if (scanResult && scanResult.failed) {
      container.appendChild(
        el('div', { class: 'dmh-warning-banner' }, [
          `Could not scan your other holdings (${scanResult.error.message}). You can still add tokens manually below.`,
        ])
      );
    } else if (scanResult && scanResult.length > 0) {
      container.appendChild(el('div', { class: 'dmh-divider' }));
      for (const token of scanResult) {
        container.appendChild(
          renderAssetRow(
            { ...token, address: token.address },
            { toggleable: selectable }
          )
        );
      }
    } else {
      container.appendChild(el('div', { class: 'dmh-empty-state' }, 'No other tokens/NFTs found for this address.'));
    }

    if (selectable) {
      container.appendChild(
        renderManualPasteFallback((asset) => {
          container.insertBefore(
            renderAssetRow(asset, { toggleable: true, alreadySelected: true }),
            container.lastElementChild
          );
          notifySelectionChange();
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
