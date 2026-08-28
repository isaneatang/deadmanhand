// components/theme/ui.js
//
// Shared, framework-free DOM helpers implementing the layout chrome required
// by UI Addendum v2 Section 5 (mobile & wallet-browser navigation): the
// persistent back button, step indicator, sticky CTA bar, and toast system.
// Also the network badge from Section 3/8.3.
//
// No component library / virtual DOM here — plain functions that build and
// return real DOM nodes, kept deliberately simple so the whole app stays
// auditable (Security section rationale for splitting files applies to
// avoiding an opaque framework layer too).

import { getActiveNetworkKey, setActiveNetworkKey, getAllNetworkKeys, getNetworkConfigFor } from '../../config/network.js';
import { openBottomSheet } from '../DropdownSheet/DropdownSheet.js';

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value; // only ever used with static, non-user-derived strings in this app
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const kid of kids) {
    if (kid === null || kid === undefined) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ---------------------------------------------------------------------
// Top bar with network badge (Section 3/8.3 — safety feature, always
// visible, unambiguous)
// ---------------------------------------------------------------------
export function renderTopBar(onNetworkChanged) {
  const netKey = getActiveNetworkKey();
  const badge = el(
    'span',
    {
      class: `dmh-network-badge ${netKey}`,
      onClick: () => {
        const options = getAllNetworkKeys().map((key) => ({
          value: key,
          label: getNetworkConfigFor(key).chainName,
          description: key === 'mainnet' ? 'Real funds. Requires confirmation.' : 'Safe to experiment.',
        }));
        openBottomSheet({
          title: 'Select network',
          options,
          selectedValue: netKey,
          onSelect: (value) => {
            if (value === netKey) return;
            if (value === 'mainnet') {
              showMainnetConfirmation(() => {
                setActiveNetworkKey(value);
                onNetworkChanged && onNetworkChanged(value);
              });
            } else {
              setActiveNetworkKey(value);
              onNetworkChanged && onNetworkChanged(value);
            }
          },
        });
      },
    },
    netKey.toUpperCase()
  );

  return el('header', { class: 'dmh-topbar' }, [
    el('div', { class: 'dmh-topbar-title' }, [el('span', { class: 'dot' }), "Dead Man's Hand"]),
    badge,
  ]);
}

/**
 * Mainnet safety confirmation — required per Security Section 7 before any
 * live-network transaction/network switch to mainnet.
 */
export function showMainnetConfirmation(onConfirm) {
  const overlay = el('div', { class: 'dmh-sheet-overlay open' });
  const sheet = el('div', { class: 'dmh-sheet open' }, [
    el('div', { class: 'dmh-sheet-handle' }),
    el('div', { class: 'dmh-main', style: 'padding-bottom: 24px;' }, [
      el('div', { class: 'dmh-warning-banner danger' }, [
        el('div', {}, [
          el('strong', {}, '⚠ You are about to interact with MAINNET.'),
          el('p', { style: 'margin: 8px 0 0;' }, 'This uses real BOT Chain funds. Transactions cannot be undone. Only continue if you understand the risk.'),
        ]),
      ]),
      el('div', { style: 'display:flex; gap: 12px; margin-top: 16px;' }, [
        el('button', {
          class: 'dmh-btn dmh-btn-secondary',
          onClick: () => document.body.removeChild(overlay),
        }, 'Cancel'),
        el('button', {
          class: 'dmh-btn dmh-btn-danger',
          onClick: () => {
            document.body.removeChild(overlay);
            onConfirm();
          },
        }, 'I understand, continue'),
      ]),
    ]),
  ]);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------
// Back button (Section 5 — persistent, ≥44x44px, never rely on device back)
// ---------------------------------------------------------------------
export function renderBackBar(onBack, stepLabel) {
  const bar = el('div', { style: 'display:flex; align-items:center; gap: 12px; padding: 8px 16px 0;' }, [
    el('button', { class: 'dmh-back-btn', 'aria-label': 'Back', onClick: onBack }, '←'),
  ]);
  if (stepLabel) {
    bar.appendChild(el('div', { class: 'mono', style: 'font-size: 12px; color: var(--dmh-text-secondary);' }, stepLabel));
  }
  return bar;
}

// ---------------------------------------------------------------------
// Step indicator ("Step 2 of 5" + dots)
// ---------------------------------------------------------------------
export function renderStepIndicator(current, total) {
  const dots = el('div', { class: 'dmh-step-dots' });
  for (let i = 1; i <= total; i++) {
    let cls = 'dmh-step-dot';
    if (i < current) cls += ' done';
    if (i === current) cls += ' active';
    dots.appendChild(el('span', { class: cls }));
  }
  return el('div', { class: 'dmh-step-indicator' }, [`Step ${current} of ${total}`, dots]);
}

// ---------------------------------------------------------------------
// Sticky primary CTA bar (Section 5 — always reachable w/ keyboard open)
// ---------------------------------------------------------------------
export function renderStickyCta(buttonEl) {
  return el('div', { class: 'dmh-sticky-cta' }, [buttonEl]);
}

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------
let toastContainer = null;
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = el('div', { class: 'dmh-toast-container' });
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message, type = 'info', durationMs = 4500) {
  const container = ensureToastContainer();
  const toast = el('div', { class: `dmh-toast ${type}` }, message);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.opacity = '0';
    setTimeout(() => container.removeChild(toast), 300);
  }, durationMs);
}

// ---------------------------------------------------------------------
// Copy-to-clipboard — explicit, user-initiated ONLY. Never wire this to the
// secret field (Security Section 7).
// ---------------------------------------------------------------------
export function renderCopyableValue(value, label) {
  const copyBtn = el('button', { class: 'dmh-copy-btn' }, 'Copy');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      copyBtn.textContent = 'Copied!';
      showToast(`${label || 'Value'} copied to clipboard.`, 'success', 2000);
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    } catch (_e) {
      showToast('Copy failed — select and copy manually.', 'error');
    }
  });
  return el('div', { class: 'dmh-copy-row' }, [el('span', { class: 'value' }, value), copyBtn]);
}

export function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (seconds <= 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

export function formatAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
