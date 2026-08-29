// flows/ClaimantFlow/Step3SecretEntry.js — Step 3: Secret entry (masked, show/hide) + fee confirmation
import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast } from '../../components/theme/ui.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable } from '../../lib/wallet.js';
import { previewFee, getFailedAttempts, attemptUnlock } from '../../lib/contract.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';

export function renderStep3SecretEntry(container, state, onResult, onBack) {
  const net = getNetworkConfig();
  let secretValue = '';
  let showSecret = false;
  let claimantAddress = state.claimantAddress;

  const feeDisplay = el('div', { class: 'dmh-hint', role: 'status', 'aria-live': 'polite' }, 'Loading current fee…');
  const recipientDisplay = el('div', { class: 'mono', style: 'font-size:12px; word-break:break-all;' }, claimantAddress || 'Connect a wallet to set the recipient.');

  const connectBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, isWalletAvailable() ? 'Connect wallet to pay fee' : 'No wallet detected');
  connectBtn.disabled = !isWalletAvailable();

  async function refreshFee() {
    feeDisplay.textContent = 'Loading current fee…';
    try {
      const [fee, failedAttempts] = await Promise.all([previewFee(state.vaultId), getFailedAttempts(state.vaultId)]);
      const decimals = net.usdtDecimals || 6;
      feeDisplay.textContent = `Current fee: ${ethers.formatUnits(fee, decimals)} USDT${failedAttempts > 0n ? ` (escalated after ${failedAttempts} failed attempt${failedAttempts === 1n ? '' : 's'})` : ''}. Charged whether the secret matches or not.`;
      return fee;
    } catch (e) {
      feeDisplay.textContent = `Could not load current fee: ${e.message}`;
      throw e;
    }
  }
  refreshFee().catch(() => {});

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    try {
      claimantAddress = await connectWallet();
      await ensureCorrectNetwork();
      state.claimantAddress = claimantAddress;
      connectBtn.textContent = `Connected: ${claimantAddress.slice(0, 6)}…${claimantAddress.slice(-4)}`;
      recipientDisplay.textContent = claimantAddress;
      await refreshFee();
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
    id: 'claimant-secret',
    'aria-describedby': 'claimant-secret-disclosure',
  });
  const toggleShowBtn = el('button', { class: 'dmh-input-icon-btn', type: 'button', 'aria-label': 'Show secret', 'aria-controls': 'claimant-secret', 'aria-pressed': 'false' }, 'Show');
  toggleShowBtn.addEventListener('click', () => {
    showSecret = !showSecret;
    secretInput.type = showSecret ? 'text' : 'password';
    toggleShowBtn.textContent = showSecret ? 'Hide' : 'Show';
    toggleShowBtn.setAttribute('aria-label', showSecret ? 'Hide secret' : 'Show secret');
    toggleShowBtn.setAttribute('aria-pressed', String(showSecret));
  });

  const formId = 'claimant-secret-form';
  const submitBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'submit', form: formId }, 'Submit & pay fee');
  submitBtn.disabled = true;

  function updateSubmitState() {
    submitBtn.disabled = !claimantAddress || secretValue.length === 0;
  }

  secretInput.addEventListener('input', (e) => {
    secretValue = e.target.value;
    updateSubmitState();
  });

  async function submitSecret(event) {
    event.preventDefault();
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Refreshing fee…';
    const secretToSubmit = secretValue;

    try {
      await refreshFee();
      submitBtn.textContent = 'Confirm in wallet…';
      secretValue = '';
      secretInput.value = '';
      const result = await attemptUnlock(state.vaultId, secretToSubmit, claimantAddress);
      state.result = result;
      onResult();
    } catch (e) {
      showToast(e.shortMessage || e.message || 'Claim attempt failed.', 'error');
      submitBtn.textContent = 'Submit & pay fee';
      updateSubmitState();
    }
  }

  const refreshFeeBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, 'Refresh fee');
  refreshFeeBtn.addEventListener('click', async () => {
    refreshFeeBtn.disabled = true;
    try {
      await refreshFee();
    } catch (_e) {
      // The live fee region contains the actionable error.
    } finally {
      refreshFeeBtn.disabled = false;
    }
  });

  const form = el('form', { id: formId });
  form.addEventListener('submit', submitSecret);
  form.appendChild(el('div', { class: 'dmh-main' }, [
    el('h1', { class: 'dmh-heading' }, 'Enter the secret'),
    el('p', { id: 'claimant-secret-disclosure', class: 'dmh-subheading' }, 'Your secret is sent as plaintext transaction calldata. It is not private or hashed on your device, and will be permanently visible on the public blockchain. Only continue if you accept this limitation.'),
    el('div', { class: 'dmh-field' }, [
      el('label', { class: 'dmh-label', for: 'claimant-secret' }, 'Secret phrase'),
      el('div', { class: 'dmh-input-wrap' }, [secretInput, toggleShowBtn]),
    ]),
    el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-card-title' }, 'Recipient address'),
      recipientDisplay,
      el('p', { class: 'dmh-hint' }, 'Successfully claimed assets will be sent to this connected wallet.'),
    ]),
    el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-card-title' }, 'Fee'),
      feeDisplay,
      refreshFeeBtn,
      connectBtn,
    ]),
    el('div', { class: 'dmh-warning-banner' }, "If the secret doesn't match, the fee is still taken (not refunded) and repeated failures trigger an escalating fee and a temporary cooldown."),
  ]));

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(3, 4));
  container.appendChild(form);
  container.appendChild(renderStickyCta(submitBtn));
}
