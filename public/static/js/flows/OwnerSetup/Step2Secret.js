// flows/OwnerSetup/Step2Secret.js — Step 2: Set inactivity period + secret (with entropy check)
import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast, formatDuration } from '../../components/theme/ui.js';
import { renderChipGroup } from '../../components/DropdownSheet/DropdownSheet.js';
import { checkSecretEntropy, computeSecretHash, generateVaultId } from '../../lib/hashing.js';

// Suggested range per Master Build Prompt Section 4.1 / Section 11 (final
// bounds are explicitly marked as still Isane's call, not the build AI's —
// these are the SUGGESTED defaults from the spec, used as-is here).
const PERIOD_OPTIONS = [
  { value: 180 * 24 * 60 * 60, label: '6 months' },
  { value: 365 * 24 * 60 * 60, label: '1 year' },
  { value: 2 * 365 * 24 * 60 * 60, label: '2 years' },
  { value: 5 * 365 * 24 * 60 * 60, label: '5 years' },
];

export function renderStep2Secret(container, state, onNext, onBack) {
  let secretValue = '';
  let confirmValue = '';
  let periodValue = state.inactivityPeriodSeconds || PERIOD_OPTIONS[0].value;
  let entropyResult = { ok: false, reasons: [], entropyBits: 0 };
  let showSecret = false;

  const periodGroup = renderChipGroup({
    options: PERIOD_OPTIONS,
    initialValue: periodValue,
    onChange: (v) => { periodValue = v; },
  });

  const secretInput = el('input', {
    class: 'dmh-input mono',
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Enter a long, unique secret phrase',
  });
  const confirmInput = el('input', {
    class: 'dmh-input mono',
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Re-enter the same secret',
  });

  const entropyFeedback = el('div', { class: 'dmh-hint' }, 'Enter a secret to check its strength.');
  const matchFeedback = el('div', { class: 'dmh-error-text' });

  const toggleShowBtn = el('button', { class: 'dmh-input-icon-btn', type: 'button' }, '👁');
  toggleShowBtn.addEventListener('click', () => {
    showSecret = !showSecret;
    secretInput.type = showSecret ? 'text' : 'password';
    confirmInput.type = showSecret ? 'text' : 'password';
    toggleShowBtn.textContent = showSecret ? '🙈' : '👁';
  });

  function updateEntropyFeedback() {
    entropyResult = checkSecretEntropy(secretValue);
    entropyFeedback.innerHTML = '';
    if (secretValue.length === 0) {
      entropyFeedback.textContent = 'Enter a secret to check its strength.';
      entropyFeedback.className = 'dmh-hint';
      return;
    }
    if (entropyResult.ok) {
      entropyFeedback.textContent = `✓ Strong secret (~${entropyResult.entropyBits.toFixed(0)} bits estimated entropy).`;
      entropyFeedback.className = 'dmh-hint';
      entropyFeedback.style.color = 'var(--dmh-green-phosphor)';
    } else {
      entropyFeedback.style.color = '';
      entropyFeedback.className = 'dmh-error-text';
      entropyFeedback.textContent = entropyResult.reasons.join(' ');
    }
    updateContinueState();
  }

  function updateMatchFeedback() {
    matchFeedback.textContent = confirmValue.length > 0 && confirmValue !== secretValue ? 'Secrets do not match.' : '';
    updateContinueState();
  }

  secretInput.addEventListener('input', (e) => {
    secretValue = e.target.value;
    updateEntropyFeedback();
    updateMatchFeedback();
  });
  confirmInput.addEventListener('input', (e) => {
    confirmValue = e.target.value;
    updateMatchFeedback();
  });

  const continueBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Continue');

  function updateContinueState() {
    const canContinue = entropyResult.ok && confirmValue === secretValue && secretValue.length > 0;
    continueBtn.disabled = !canContinue;
  }
  updateContinueState();

  continueBtn.addEventListener('click', () => {
    if (continueBtn.disabled) return;
    try {
      const vaultId = state.vaultId || generateVaultId();
      const secretHash = computeSecretHash(secretValue, state.address, vaultId);

      state.vaultId = vaultId;
      state.secretHash = secretHash;
      state.inactivityPeriodSeconds = periodValue;

      // Clear the secret from local closures immediately after hashing
      // (Security Section 7) — overwrite the variables and the input DOM
      // values so nothing lingers in memory/DOM longer than necessary.
      secretValue = '';
      confirmValue = '';
      secretInput.value = '';
      confirmInput.value = '';

      onNext();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(2, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('h1', { class: 'dmh-heading' }, 'Set your secret & inactivity period'),
      el('p', { class: 'dmh-subheading' }, 'Anyone who knows this secret — after you go inactive past the period below — can claim the assets you protect. Never share it casually. Only give it to whoever should inherit access.'),

      el('div', { class: 'dmh-field' }, [
        el('label', { class: 'dmh-label' }, 'Inactivity period'),
        periodGroup.node,
        el('div', { class: 'dmh-hint' }, `If you don't check in for ${formatDuration(periodValue)}, this vault becomes claimable.`),
      ]),

      el('div', { class: 'dmh-field' }, [
        el('label', { class: 'dmh-label' }, 'Secret phrase'),
        el('div', { class: 'dmh-input-wrap' }, [secretInput, toggleShowBtn]),
        entropyFeedback,
      ]),

      el('div', { class: 'dmh-field' }, [
        el('label', { class: 'dmh-label' }, 'Confirm secret'),
        confirmInput,
        matchFeedback,
      ]),

      el('div', { class: 'dmh-warning-banner' }, "This secret is hashed on your device only and never sent anywhere in plaintext. But the hash itself is public forever on-chain — a weak secret CAN be brute-forced offline, which is why we require real entropy here."),
    ])
  );
  container.appendChild(renderStickyCta(continueBtn));

  // re-hook period chip change to also refresh the hint text
  const originalOnChange = periodGroup.getValue;
  container.querySelectorAll('.dmh-chip').forEach((chipBtn, idx) => {
    chipBtn.addEventListener('click', () => {
      periodValue = PERIOD_OPTIONS[idx].value;
      const hint = container.querySelector('.dmh-field .dmh-hint');
      if (hint) hint.textContent = `If you don't check in for ${formatDuration(periodValue)}, this vault becomes claimable.`;
    });
  });
}
