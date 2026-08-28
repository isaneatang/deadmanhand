// components/DropdownSheet/DropdownSheet.js
//
// Custom bottom-sheet picker. Per UI Addendum v2 Section 2 (hard
// requirement): NEVER a native <select>/<option>, and never a component
// library wrapper around one — several mobile wallet in-app WebViews
// (MetaMask mobile, Trust Wallet, Rainbow, Coinbase Wallet) fail to open
// native pickers reliably. This is a plain div-based overlay + sheet built
// entirely with DOM APIs, with tap-friendly rows (≥44px tall).
//
// Usage:
//   openBottomSheet({
//     title: 'Choose network',
//     options: [{ value: 'testnet', label: 'BOT Chain Testnet', description: '...' }, ...],
//     selectedValue: 'testnet',
//     onSelect: (value) => { ... },
//   });
//
// For rendering a labeled trigger button that opens the sheet (used in
// forms), see renderSelectField() below.

import { el } from '../theme/ui.js';

export function openBottomSheet({ title, options, selectedValue, onSelect }) {
  const overlay = el('div', { class: 'dmh-sheet-overlay' });
  const rows = options.map((opt) => {
    const isSelected = opt.value === selectedValue;
    const row = el('div', { class: `dmh-sheet-row${isSelected ? ' selected' : ''}` }, [
      el('div', {}, [
        el('div', {}, opt.label),
        opt.description ? el('div', { class: 'dmh-sheet-row-desc' }, opt.description) : null,
      ]),
      isSelected ? el('span', {}, '✓') : null,
    ]);
    row.addEventListener('click', () => {
      close();
      onSelect(opt.value);
    });
    return row;
  });

  const sheet = el('div', { class: 'dmh-sheet' }, [
    el('div', { class: 'dmh-sheet-handle' }),
    title ? el('div', { class: 'dmh-sheet-title' }, title) : null,
    ...rows,
  ]);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Force reflow then animate in.
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    sheet.classList.add('open');
  });

  function close() {
    overlay.classList.remove('open');
    sheet.classList.remove('open');
    setTimeout(() => {
      if (overlay.parentNode) document.body.removeChild(overlay);
    }, 250);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return close;
}

/**
 * A labeled form field that looks like a select but opens the bottom sheet
 * on tap. Returns { node, getValue, setValue }.
 */
export function renderSelectField({ label, options, initialValue, onChange, hint }) {
  let currentValue = initialValue;
  const trigger = el('div', { class: 'dmh-select-trigger' }, [
    el('span', { class: 'trigger-label' }, resolveLabel(options, currentValue)),
    el('span', { class: 'chevron' }, '▾'),
  ]);

  trigger.addEventListener('click', () => {
    openBottomSheet({
      title: label,
      options,
      selectedValue: currentValue,
      onSelect: (value) => {
        currentValue = value;
        trigger.querySelector('.trigger-label').textContent = resolveLabel(options, currentValue);
        onChange && onChange(value);
      },
    });
  });

  const wrapper = el('div', { class: 'dmh-field' }, [
    label ? el('label', { class: 'dmh-label' }, label) : null,
    trigger,
    hint ? el('div', { class: 'dmh-hint' }, hint) : null,
  ]);

  return {
    node: wrapper,
    getValue: () => currentValue,
    setValue: (value) => {
      currentValue = value;
      trigger.querySelector('.trigger-label').textContent = resolveLabel(options, currentValue);
    },
  };
}

function resolveLabel(options, value) {
  const match = options.find((o) => o.value === value);
  return match ? match.label : 'Select…';
}

/**
 * Short-list chip/radio row (2–4 options) — per Addendum v2 Section 2, a
 * styled button row is fine for short choices, no dropdown needed at all.
 * Returns { node, getValue, setValue }.
 */
export function renderChipGroup({ options, initialValue, onChange }) {
  let currentValue = initialValue;
  const buttons = [];

  const row = el('div', { class: 'dmh-chip-row' });
  for (const opt of options) {
    const btn = el(
      'button',
      { class: `dmh-chip${opt.value === currentValue ? ' selected' : ''}`, type: 'button' },
      opt.label
    );
    btn.addEventListener('click', () => {
      currentValue = opt.value;
      for (const b of buttons) b.classList.remove('selected');
      btn.classList.add('selected');
      onChange && onChange(currentValue);
    });
    buttons.push(btn);
    row.appendChild(btn);
  }

  return {
    node: row,
    getValue: () => currentValue,
    setValue: (value) => {
      currentValue = value;
      buttons.forEach((b, i) => b.classList.toggle('selected', options[i].value === value));
    },
  };
}
