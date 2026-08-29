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
  const previousFocus = document.activeElement;
  const titleId = `dmh-sheet-title-${Date.now()}`;
  const overlay = el('div', { class: 'dmh-sheet-overlay' });
  const rows = options.map((opt) => {
    const isSelected = opt.value === selectedValue;
    const row = el('button', { class: `dmh-sheet-row${isSelected ? ' selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(isSelected) }, [
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

  const closeBtn = el('button', { class: 'dmh-sheet-close', type: 'button', 'aria-label': 'Close picker' }, 'Close');
  const sheet = el('div', { class: 'dmh-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
    el('div', { class: 'dmh-sheet-handle' }),
    el('div', { class: 'dmh-sheet-header' }, [
      title ? el('div', { id: titleId, class: 'dmh-sheet-title' }, title) : el('div', { id: titleId, class: 'dmh-sheet-title' }, 'Choose an option'),
      closeBtn,
    ]),
    el('div', { role: 'listbox', 'aria-labelledby': titleId }, rows),
  ]);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Force reflow then animate in.
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    sheet.classList.add('open');
    (rows.find((row) => row.getAttribute('aria-selected') === 'true') || rows[0] || closeBtn).focus();
  });

  function close() {
    overlay.classList.remove('open');
    sheet.classList.remove('open');
    setTimeout(() => {
      if (overlay.parentNode) document.body.removeChild(overlay);
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }, 250);
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const focusable = Array.from(sheet.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown);

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
  const trigger = el('button', { class: 'dmh-select-trigger', type: 'button', 'aria-haspopup': 'dialog' }, [
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
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button === btn)));
      onChange && onChange(currentValue);
    });
    buttons.push(btn);
    btn.setAttribute('aria-pressed', String(opt.value === currentValue));
    row.appendChild(btn);
  }

  return {
    node: row,
    getValue: () => currentValue,
    setValue: (value) => {
      currentValue = value;
      buttons.forEach((b, i) => {
        const selected = options[i].value === value;
        b.classList.toggle('selected', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
    },
  };
}
