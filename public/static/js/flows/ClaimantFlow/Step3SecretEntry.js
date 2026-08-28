// flows/ClaimantFlow/Step3SecretEntry.js — Step 3: Secret entry (masked, show/hide) + fee confirmation
//
// Explicitly tested with the mobile keyboard open per Section 8.5 — the
// sticky CTA + safe-area padding on <body>/.dmh-main ensures the input and
// submit button are never hidden behind it (see components/theme/ui.js
// .dmh-sticky-cta and .dmh-main padding-bottom).
import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast } from '../../components/theme/ui.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable } from '../../lib/wallet.js';
import { previewFee, getFailedAttempts, attemptUnlock } from '../../lib/contract.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';

export function renderStep3SecretEntry(container, state, onResult, onBack) {
  const net = getNetworkConfig();
  let secretValue = '';
  let showSecret = false;
  let currentFee = null;
  let claimantAddress = state.claimantAddress;

  const feeDisplay = el('div', { class: 'dmh-hint' }, 'Connect your wallet to see the current fee.');

  const connectBtn = el('button', { class: 'dmh-btn dmh-btn-secondary' }, isWalletAvailable() ? 'Connect wallet to pay fee' : 'No wallet detected');
  connectBtn.disabled = !isWalletAvailable();

  async function refreshFee() {
    try {
      const fee = await previewFee(state.vaultId);
      const failedAttempts = await getFailedAttempts(state.vaultId);
      currentFee = fee;
      const decimals = net.usdtDecimals || 6;
      feeDisplay.textContent = `Current fee: ${ethers.formatUnits(fee, decimals)} USDT${failedAttempts > 0 ? ` (escalated after ${failedAttempts} failed attempt${failedAttempts === 1 ? '' : 's'})` : ''}. Charged whether the secret matches or not.`;
    } catch (e) {
      feeDisplay.textContent = `Could not load current fee: ${e.message}`;
    }
  }
  refreshFee();

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    try {
      claimantAddress = await connectWallet();
      await ensureCorrectNetwork();
      state.claimantAddress = claimantAddress;
      connectBtn.textContent = `Connected: ${claimantAddress.slice(0, 6)}…${claimantAddress.slice(-4)}`;
      updateSubmitState();
    } catch (e) {
      showToast(e.message, 'error');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect wallet to pay fee';
    }
  });

  const secretInput = el('input', {
    class: 'dmh-input mono',
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Enter the secret phrase',
  });
  const toggleShowBtn = el('button', { class: 'dmh-input-icon-btn', type: 'button' }, '👁');
  toggleShowBtn.addEventListener('click', () => {
    showSecret = !showSecret;
    secretInput.type = showSecret ? 'text' : 'password';
    toggleShowBtn.textContent = showSecret ? '🙈' : '👁';
  });

  const submitBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Submit & pay fee');
  submitBtn.disabled = true;

  function updateSubmitState() {
    submitBtn.disabled = !claimantAddress || secretValue.length === 0;
  }

  secretInput.addEventListener('input', (e) => {
    secretValue = e.target.value;
    updateSubmitState();
  });

  submitBtn.addEventListener('click', async () => {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Confirm in wallet…';
    const secretToSubmit = secretValue;
    // Clear immediately from local state/DOM (Security Section 7) — the
    // variable below is only used for the single attemptUnlock call.
    secretValue = '';
    secretInput.value = '';

    try {
      const result = await attemptUnlock(state.vaultId, secretToSubmit, claimantAddress);
      state.result = result;
      onResult();
    } catch (e) {
      showToast(e.shortMessage || e.message || 'Claim attempt failed.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit & pay fee';
    }
  });

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(3, 4));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('h1', { class: 'dmh-heading' }, 'Enter the secret'),
      el('p', { class: 'dmh-subheading' }, 'This is submitted once and hashed on your device before anything is sent. If it matches, protected assets transfer to your connected wallet.'),

      el('div', { class: 'dmh-field' }, [
        el('label', { class: 'dmh-label' }, 'Secret phrase'),
        el('div', { class: 'dmh-input-wrap' }, [secretInput, toggleShowBtn]),
      ]),

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, 'Fee'),
        feeDisplay,
        connectBtn,
      ]),

      el('div', { class: 'dmh-warning-banner' }, "If the secret doesn't match, the fee is still taken (not refunded) and repeated failures trigger an escalating fee and a temporary cooldown."),
    ])
  );
  container.appendChild(renderStickyCta(submitBtn));
}
