// flows/OwnerSetup/Step2Secret.js — Step 2: Set inactivity period + secret (with entropy check)
import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast, formatDuration } from '../../components/theme/ui.js';
import { renderChipGroup } from '../../components/DropdownSheet/DropdownSheet.js';
import { checkSecretEntropy, computeSecretHash, generateVaultId } from '../../lib/hashing.js';

// Contract-enforced bounds (see MIN_INACTIVITY_PERIOD / MAX_INACTIVITY_PERIOD
// in DeadMansHand.sol). The vault creator is free to choose ANY duration in
// this range — there is no forced multi-month floor. The floor is 1 minute
// (useful for quickly testing your own recovery flow before relying on it
// for real), not months/years.
const MIN_SECONDS = 60;
const MAX_SECONDS = 10 * 365 * 24 * 60 * 60;

// Unit multipliers for the custom number+unit picker (chip group — no
// native <select>, per UI Addendum v2 Section 2).
const UNIT_OPTIONS = [
  { value: 60, label: 'Minutes' },
  { value: 60 * 60, label: 'Hours' },
  { value: 24 * 60 * 60, label: 'Days' },
  { value: 7 * 24 * 60 * 60, label: 'Weeks' },
  { value: 30 * 24 * 60 * 60, label: 'Months' },
  { value: 365 * 24 * 60 * 60, label: 'Years' },
];

// Quick-fill shortcuts — just convenience presets that populate the
// number+unit fields below; they do NOT limit what the user can enter.
const QUICK_PRESETS = [
  { label: '1 min (test)', seconds: 60 },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '6 months', seconds: 180 * 24 * 60 * 60 },
  { label: '1 year', seconds: 365 * 24 * 60 * 60 },
  { label: '5 years', seconds: 5 * 365 * 24 * 60 * 60 },
];

function secondsToCountAndUnit(totalSeconds) {
  // Pick the largest unit that divides evenly, falling back to minutes.
  for (let i = UNIT_OPTIONS.length - 1; i >= 0; i--) {
    const unit = UNIT_OPTIONS[i];
    if (totalSeconds % unit.value === 0 && totalSeconds / unit.value >= 1) {
      return { count: totalSeconds / unit.value, unitSeconds: unit.value };
    }
  }
  return { count: Math.max(1, Math.round(totalSeconds / 60)), unitSeconds: 60 };
}

export function renderStep2Secret(container, state, onNext, onBack) {
  let secretValue = '';
  let confirmValue = '';

  const initialSeconds = state.inactivityPeriodSeconds || QUICK_PRESETS[2].seconds; // default 6 months
  const initial = secondsToCountAndUnit(initialSeconds);
  let countValue = initial.count;
  let unitSeconds = initial.unitSeconds;
  let periodValue = initialSeconds;

  let entropyResult = { ok: false, reasons: [], entropyBits: 0 };
  let showSecret = false;

  const countInput = el('input', {
    class: 'dmh-input mono',
    type: 'number',
    inputmode: 'numeric',
    min: '1',
    step: '1',
    value: String(countValue),
  });

  const unitGroup = renderChipGroup({
    options: UNIT_OPTIONS,
    initialValue: unitSeconds,
    onChange: (v) => {
      unitSeconds = v;
      recomputePeriod();
    },
  });

  const periodError = el('div', { class: 'dmh-error-text' });
  const periodHint = el('div', { class: 'dmh-hint' });

  function recomputePeriod() {
    const count = parseInt(countInput.value, 10);
    if (!Number.isFinite(count) || count <= 0) {
      periodValue = 0;
      periodError.textContent = 'Enter a duration greater than zero.';
      periodHint.textContent = '';
      updateContinueState();
      return;
    }
    periodValue = count * unitSeconds;
    if (periodValue < MIN_SECONDS) {
      periodError.textContent = 'Minimum inactivity period is 1 minute.';
      periodHint.textContent = '';
    } else if (periodValue > MAX_SECONDS) {
      periodError.textContent = 'Maximum inactivity period is 10 years.';
      periodHint.textContent = '';
    } else {
      periodError.textContent = '';
      periodHint.textContent = `If you don't check in for ${formatDuration(periodValue)}, this vault becomes claimable.`;
    }
    updateContinueState();
  }

  countInput.addEventListener('input', recomputePeriod);

  const presetRow = el('div', { class: 'dmh-chip-row' });
  for (const preset of QUICK_PRESETS) {
    const btn = el('button', { class: 'dmh-chip dmh-chip-small', type: 'button' }, preset.label);
    btn.addEventListener('click', () => {
      const resolved = secondsToCountAndUnit(preset.seconds);
      countValue = resolved.count;
      unitSeconds = resolved.unitSeconds;
      countInput.value = String(countValue);
      unitGroup.setValue(unitSeconds);
      recomputePeriod();
    });
    presetRow.appendChild(btn);
  }

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
    const periodOk = periodValue >= MIN_SECONDS && periodValue <= MAX_SECONDS;
    const canContinue = periodOk && entropyResult.ok && confirmValue === secretValue && secretValue.length > 0;
    continueBtn.disabled = !canContinue;
  }
  updateContinueState();
  recomputePeriod();

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
        el('label', { class: 'dmh-label' }, 'Inactivity period — choose any duration'),
        el('div', { class: 'dmh-hint' }, 'Quick picks:'),
        presetRow,
        el('div', { class: 'dmh-inline-row' }, [
          countInput,
          unitGroup.node,
        ]),
        periodError,
        periodHint,
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
}
