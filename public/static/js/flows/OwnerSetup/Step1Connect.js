// flows/OwnerSetup/Step1Connect.js — Step 1: Connect wallet
import { el, renderStepIndicator, renderStickyCta, showToast } from '../../components/theme/ui.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable } from '../../lib/wallet.js';
import { getNetworkConfig } from '../../config/network.js';

export function renderStep1Connect(container, state, onNext) {
  const net = getNetworkConfig();
  const walletAvailable = isWalletAvailable();
  const statusEl = el('div', {
    class: 'dmh-card',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  }, [
    el('div', { class: 'dmh-card-title' }, 'Connection status'),
    el('p', { class: 'dmh-hint', id: 'owner-connect-status' }, walletAvailable
      ? `Ready to connect. Your wallet will then be checked for ${net.chainName}.`
      : 'No compatible wallet was detected.'),
  ]);
  const statusText = statusEl.querySelector('#owner-connect-status');

  const connectBtn = el(
    'button',
    { class: 'dmh-btn dmh-btn-primary', type: 'button', 'aria-describedby': 'owner-connect-status' },
    walletAvailable ? 'Connect wallet' : 'No wallet detected'
  );
  connectBtn.disabled = !walletAvailable;

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    statusText.textContent = 'Step 1 of 2: waiting for wallet connection approval.';
    try {
      const address = await connectWallet();
      statusText.textContent = `Step 2 of 2: wallet connected. Checking ${net.chainName} network.`;
      await ensureCorrectNetwork();
      state.address = address;
      statusText.textContent = `Connected and ready on ${net.chainName}.`;
      showToast('Wallet connected.', 'success', 2000);
      onNext();
    } catch (e) {
      const message = e.message || 'Connection failed.';
      statusText.textContent = `Connection not completed: ${message}`;
      showToast(message, 'error');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect wallet';
    }
  });

  container.appendChild(renderStepIndicator(1, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('h1', { class: 'dmh-heading' }, 'Connect your wallet'),
      el('p', { class: 'dmh-subheading' }, `Connect the wallet that owns the assets you want to protect. This app targets ${net.chainName} — a normal EOA wallet (MetaMask, OKX, etc.), no Safe or account migration required.`),

      !isWalletAvailable()
        ? el('div', { class: 'dmh-warning-banner' }, "No wallet extension/in-app browser detected. Open this page inside a wallet app (MetaMask, OKX, Trust Wallet, etc.) or install a browser wallet extension.")
        : null,

      statusEl,

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, 'Why per-token approval?'),
        el('p', { class: 'dmh-hint' }, "Your assets never move or get locked during normal use — they stay in your own wallet the entire time. You'll approve specific tokens/collections for Dead Man's Hand to pull from ONLY if your secret is ever submitted after you go inactive."),
      ]),
    ])
  );
  container.appendChild(renderStickyCta(connectBtn));
}
