import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast } from '../../components/theme/ui.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable, getReadOnlyProvider } from '../../lib/wallet.js';
import { previewFee, submitClaim } from '../../lib/contract.js';
import { deriveAuthorizationSigner, signClaimWithKey } from '../../lib/hashing.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';

export function renderStep3SecretEntry(container, state, onResult, onBack) {
  const net = getNetworkConfig();
  let phrase = '', feePayer = state.feePayerAddress, fee = null;
  const feeDisplay = el('div', { class: 'dmh-hint', role: 'status', 'aria-live': 'polite' }, 'Loading current fee…');
  const payerDisplay = el('div', { class: 'mono', style: 'font-size:12px; word-break:break-all;' }, feePayer || 'Connect a separate wallet to pay the fee.');
  const recipientInput = el('input', { class: 'dmh-input mono', type: 'text', placeholder: 'Connect the receiving wallet', autocomplete: 'off', spellcheck: 'false' });
  const connectBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, isWalletAvailable() ? 'Connect fee payer wallet' : 'No wallet detected');
  connectBtn.disabled = !isWalletAvailable();

  async function refreshFee() {
    fee = await previewFee(state.vaultId);
    feeDisplay.textContent = `Current maximum fee: ${ethers.formatUnits(fee, net.usdtDecimals || 6)} USDT. The signed claim is bound to this amount and expires in 15 minutes.`;
    return fee;
  }
  refreshFee().catch((e) => { feeDisplay.textContent = `Could not load current fee: ${e.message}`; });
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true; connectBtn.textContent = 'Connecting…';
    try { feePayer = await connectWallet(); await ensureCorrectNetwork(); state.feePayerAddress = feePayer; recipientInput.value = feePayer; payerDisplay.textContent = feePayer; connectBtn.textContent = `Fee payer: ${feePayer.slice(0, 6)}…${feePayer.slice(-4)}`; updateSubmitState(); }
    catch (e) { showToast(e.message, 'error'); connectBtn.disabled = false; connectBtn.textContent = 'Connect fee payer wallet'; }
  });

  const phraseInput = el('input', { class: 'dmh-input mono', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Enter the secret phrase', id: 'claimant-secret' });
  const submitBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'submit', form: 'claimant-secret-form' }, 'Sign locally and submit claim');
  submitBtn.disabled = true;
  phraseInput.addEventListener('input', (e) => { phrase = e.target.value; updateSubmitState(); });
  recipientInput.addEventListener('input', updateSubmitState);
  function updateSubmitState() { submitBtn.disabled = !feePayer || !phrase || (recipientInput.value.trim() && !ethers.isAddress(recipientInput.value.trim())) || fee == null; }

  async function submit(event) {
    event.preventDefault(); if (submitBtn.disabled) return;
    submitBtn.disabled = true; submitBtn.textContent = 'Deriving and signing locally…';
    document.body.dataset.dmhTransactionLock = 'true';
    let localPhrase = phrase; phrase = ''; phraseInput.value = '';
    try {
      const latest = await getReadOnlyProvider().getBlock('latest');
      const deadline = BigInt(latest.timestamp) + 900n;
      const context = { chainId: net.chainId, contractAddress: net.dmhContractAddress, ownerAddress: state.ownerAddress, vaultId: state.vaultId, kdfSalt: state.vault.kdfSalt ?? state.vault[2] };
      const derived = await deriveAuthorizationSigner(localPhrase, context);
      const recipient = ethers.getAddress(recipientInput.value.trim());
      const claim = { vaultId: state.vaultId, recipient, feePayer, nonce: state.vault.claimNonce ?? state.vault[9], deadline, maxFee: fee };
      if (derived.address.toLowerCase() !== String(state.vault.authorizationSigner ?? state.vault[1]).toLowerCase()) {
        derived.privateKey.fill(0);
        throw new Error('The phrase does not derive the authorization signer registered for this vault.');
      }
      const signed = await signClaimWithKey(derived, claim, { name: 'DeadMansHand', version: '2', chainId: net.chainId, verifyingContract: net.dmhContractAddress });
      localPhrase = '';
      submitBtn.textContent = 'Approve fee, then confirm claim…';
      state.result = await submitClaim(claim, signed.signature); onResult();
    } catch (e) { localPhrase = ''; showToast(e.shortMessage || e.message || 'Claim failed.', 'error'); submitBtn.textContent = 'Sign locally and submit claim'; updateSubmitState(); }
    finally { delete document.body.dataset.dmhTransactionLock; }
  }
  const form = el('form', { id: 'claimant-secret-form' }); form.addEventListener('submit', submit);
  form.appendChild(el('div', { class: 'dmh-main' }, [
    el('h1', { class: 'dmh-heading' }, 'Authorize the claim'),
    el('p', { class: 'dmh-subheading' }, 'Enter the phrase to derive and verify the vault signer locally. Only the EIP-712 signature is submitted; the phrase is never transaction data.'),
    el('div', { class: 'dmh-field' }, [el('label', { class: 'dmh-label', for: 'claimant-secret' }, 'Secret phrase'), phraseInput]),
    el('div', { class: 'dmh-field' }, [el('label', { class: 'dmh-label' }, 'Recipient address'), recipientInput, el('div', { class: 'dmh-hint' }, 'Defaults to the connected fee-paying wallet. Verify this address carefully; the signature makes it irreversible.')]),
    el('div', { class: 'dmh-card' }, [el('div', { class: 'dmh-card-title' }, 'Fee payer'), payerDisplay, connectBtn, feeDisplay]),
    el('div', { class: 'dmh-warning-banner' }, 'This is a one-time claim. The vault closes even if an approval is stale, a token rejects transfer, or an NFT collection exceeds the 20-item processing cap. Verify owner approvals and the recipient before continuing. The signature binds this vault, recipient, fee payer, nonce, deadline, and maximum fee.'),
  ]));
  container.appendChild(renderBackBar(onBack)); container.appendChild(renderStepIndicator(3, 4)); container.appendChild(form); container.appendChild(renderStickyCta(submitBtn));
}
