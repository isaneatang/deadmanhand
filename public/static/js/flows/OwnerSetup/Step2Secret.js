// flows/OwnerSetup/Step2Secret.js — Step 2: Set inactivity period + secret (with entropy check)
import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast, formatDuration } from '../../components/theme/ui.js';
import { renderChipGroup } from '../../components/DropdownSheet/DropdownSheet.js';
import { checkSecretEntropy, deriveAuthorizationSigner, generateKdfSalt, generateRecoverySecret, generateVaultId } from '../../lib/hashing.js';
import { getNetworkConfig } from '../../config/network.js';

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
  let backupConfirmed = false;

  const countInput = el('input', {
    id: 'owner-inactivity-count',
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
  unitGroup.node.setAttribute('role', 'group');
  unitGroup.node.setAttribute('aria-label', 'Inactivity period unit');

  const periodError = el('div', { class: 'dmh-error-text', id: 'owner-period-error', role: 'alert', 'aria-live': 'assertive' });
  const periodHint = el('div', { class: 'dmh-hint', id: 'owner-period-hint', role: 'status', 'aria-live': 'polite' });
  countInput.setAttribute('aria-describedby', 'owner-period-hint owner-period-error');

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
  presetRow.setAttribute('role', 'group');
  presetRow.setAttribute('aria-label', 'Quick inactivity period choices');
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
    id: 'owner-secret',
    class: 'dmh-input mono',
    type: 'password',
    autocomplete: 'new-password',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Enter your own strong word or phrase',
  });
  const confirmInput = el('input', {
    id: 'owner-secret-confirm',
    class: 'dmh-input mono',
    type: 'password',
    autocomplete: 'new-password',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Re-enter the same secret',
  });

  const entropyFeedback = el('div', { class: 'dmh-hint', id: 'owner-secret-strength', role: 'status', 'aria-live': 'polite' }, 'Choose a strong secret or generate one for convenience.');
  const matchFeedback = el('div', { class: 'dmh-error-text', id: 'owner-secret-match', role: 'alert', 'aria-live': 'assertive' });
  secretInput.setAttribute('aria-describedby', 'owner-secret-strength');
  confirmInput.setAttribute('aria-describedby', 'owner-secret-match');

  const toggleShowBtn = el('button', {
    class: 'dmh-input-icon-btn',
    type: 'button',
    'aria-label': 'Show secret phrases',
    'aria-controls': 'owner-secret owner-secret-confirm',
    'aria-pressed': 'false',
  }, 'Show');
  toggleShowBtn.addEventListener('click', () => {
    showSecret = !showSecret;
    secretInput.type = showSecret ? 'text' : 'password';
    confirmInput.type = showSecret ? 'text' : 'password';
    toggleShowBtn.textContent = showSecret ? 'Hide' : 'Show';
    toggleShowBtn.setAttribute('aria-label', showSecret ? 'Hide secret phrases' : 'Show secret phrases');
    toggleShowBtn.setAttribute('aria-pressed', String(showSecret));
  });

  const generateBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, 'Generate one for me');
  const backupCheckbox = el('input', { type: 'checkbox', id: 'owner-secret-backed-up' });
  backupCheckbox.addEventListener('change', () => {
    backupConfirmed = backupCheckbox.checked;
    updateContinueState();
  });
  const backupConfirmation = el('label', { class: 'dmh-card', for: 'owner-secret-backed-up' }, [
    backupCheckbox,
    el('span', {}, 'I recorded this exact recovery secret offline. DMH cannot recover or display it after this screen.'),
  ]);
  generateBtn.addEventListener('click', () => {
    secretValue = generateRecoverySecret();
    confirmValue = '';
    secretInput.value = secretValue;
    confirmInput.value = '';
    backupConfirmed = false;
    backupCheckbox.checked = false;
    showSecret = true;
    secretInput.type = 'text';
    confirmInput.type = 'text';
    toggleShowBtn.textContent = 'Hide';
    toggleShowBtn.setAttribute('aria-pressed', 'true');
    updateEntropyFeedback();
    updateMatchFeedback();
    confirmInput.focus();
  });

  function updateEntropyFeedback() {
    entropyResult = checkSecretEntropy(secretValue);
    entropyFeedback.innerHTML = '';
    if (secretValue.length === 0) {
      entropyFeedback.textContent = 'Choose a strong secret or generate one for convenience.';
      entropyFeedback.className = 'dmh-hint';
      return;
    }
    if (entropyResult.ok) {
      entropyFeedback.textContent = `Strong secret (~${entropyResult.entropyBits.toFixed(0)} bits estimated entropy).`;
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

  const continueBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'button' }, 'Continue');

  function updateContinueState() {
    const periodOk = periodValue >= MIN_SECONDS && periodValue <= MAX_SECONDS;
    const canContinue = periodOk && entropyResult.ok && confirmValue === secretValue && secretValue.length > 0 && backupConfirmed;
    continueBtn.disabled = !canContinue;
  }
  updateContinueState();
  recomputePeriod();

  continueBtn.addEventListener('click', async () => {
    if (continueBtn.disabled) return;
    try {
      continueBtn.disabled = true;
      continueBtn.textContent = 'Deriving authorization key…';
      const net = getNetworkConfig();
      const vaultId = generateVaultId();
      const kdfSalt = generateKdfSalt();
      const derived = await deriveAuthorizationSigner(secretValue, {
        chainId: net.chainId, contractAddress: net.dmhContractAddress, ownerAddress: state.address, vaultId, kdfSalt,
      });

      state.vaultId = vaultId;
      state.kdfSalt = kdfSalt;
      state.authorizationSigner = derived.address;
      state.kdfVersion = derived.kdfVersion;
      state.derivationChainId = net.chainId;
      state.derivationContractAddress = net.dmhContractAddress;
      state.derivationOwnerAddress = state.address;
      derived.privateKey.fill(0);
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
      continueBtn.disabled = false;
      continueBtn.textContent = 'Continue';
    }
  });

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(2, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
       el('h1', { class: 'dmh-heading' }, 'Set your secret & inactivity period'),
       el('p', { class: 'dmh-subheading' }, 'Choose your own strong word or phrase, or let this device generate one. It derives an authorization signer locally and never enters a transaction or browser storage. Anyone with the secret can authorize a claim after this vault becomes inactive.'),

      el('div', { class: 'dmh-field' }, [
        el('label', { class: 'dmh-label', for: 'owner-inactivity-count' }, 'Inactivity period — choose any duration'),
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
        el('label', { class: 'dmh-label', for: 'owner-secret' }, 'Secret phrase'),
        el('div', { class: 'dmh-input-wrap' }, [secretInput, toggleShowBtn]),
        entropyFeedback,
        generateBtn,
      ]),

      el('div', { class: 'dmh-field' }, [
        el('label', { class: 'dmh-label', for: 'owner-secret-confirm' }, 'Confirm secret'),
        confirmInput,
        matchFeedback,
      ]),

      backupConfirmation,

       el('div', { class: 'dmh-warning-banner' }, 'The phrase is used only on this device to derive the authorization signer. Keep it private and back it up securely. A claimant signs a structured authorization locally; the phrase is never included in claim calldata.'),
    ])
  );
  container.appendChild(renderStickyCta(continueBtn));
}
