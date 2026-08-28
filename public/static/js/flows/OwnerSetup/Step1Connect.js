// flows/OwnerSetup/Step1Connect.js — Step 1: Connect wallet
import { el, renderStepIndicator, renderStickyCta, showToast } from '../../components/theme/ui.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable } from '../../lib/wallet.js';
import { getNetworkConfig } from '../../config/network.js';

export function renderStep1Connect(container, state, onNext) {
  const net = getNetworkConfig();

  const connectBtn = el(
    'button',
    { class: 'dmh-btn dmh-btn-primary' },
    isWalletAvailable() ? 'Connect wallet' : 'No wallet detected'
  );
  connectBtn.disabled = !isWalletAvailable();

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    try {
      const address = await connectWallet();
      await ensureCorrectNetwork();
      state.address = address;
      showToast('Wallet connected.', 'success', 2000);
      onNext();
    } catch (e) {
      showToast(e.message || 'Connection failed.', 'error');
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

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, 'Why per-token approval?'),
        el('p', { class: 'dmh-hint' }, "Your assets never move or get locked during normal use — they stay in your own wallet the entire time. You'll approve specific tokens/collections for Dead Man's Hand to pull from ONLY if your secret is ever submitted after you go inactive."),
      ]),
    ])
  );
  container.appendChild(renderStickyCta(connectBtn));
}
