// flows/Profile.js — owner wallet profile and vault management shortcuts.
import { el, formatAddress, formatDuration, showToast } from '../components/theme/ui.js';
import { navigate } from '../app.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable, onAccountsChanged, onChainChanged } from '../lib/wallet.js';
import { getDmhReadContract, getVaultStatus, lookupVaultsByAddress, pingVault } from '../lib/contract.js';
import { getNetworkConfig } from '../config/network.js';

export function renderProfile(container) {
  const wrapper = el('div', { class: 'dmh-main dmh-profile' }, [
    el('header', {}, [
      el('div', { class: 'dmh-eyebrow mono' }, 'OWNER PROFILE'),
      el('h1', { class: 'dmh-heading' }, 'Your vaults'),
      el('p', { class: 'dmh-subheading' }, "Connect the owner wallet to find every vault registered to it, open a dashboard, or reset an active vault's inactivity timer."),
    ]),
  ]);
  container.appendChild(wrapper);

  const connectBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'button' }, isWalletAvailable() ? 'Connect owner wallet' : 'No wallet detected');
  connectBtn.disabled = !isWalletAvailable();
  const stateCard = el('section', { class: 'dmh-card' }, [
    el('h2', { class: 'dmh-card-title' }, 'Wallet access'),
    el('p', { class: 'dmh-subheading', role: 'status', 'aria-live': 'polite' }, `Vault discovery reads ${getNetworkConfig().chainName} directly. Management actions still require wallet confirmation.`),
    connectBtn,
  ]);
  const vaultRegion = el('section', { class: 'dmh-profile-vaults', 'aria-label': 'Owned vaults' });
  wrapper.appendChild(stateCard);
  wrapper.appendChild(vaultRegion);

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting wallet...';
    try {
      const address = await connectWallet();
      await ensureCorrectNetwork();
      stateCard.replaceChildren(
        el('h2', { class: 'dmh-card-title' }, 'Connected owner'),
        el('div', { class: 'dmh-profile-address mono', title: address }, address),
        el('p', { class: 'dmh-hint' }, `Showing vaults registered to ${formatAddress(address)} on ${getNetworkConfig().chainName}.`)
      );
      await loadVaults(vaultRegion, address);
      watchWallet(wrapper, address);
    } catch (error) {
      showToast(error.shortMessage || error.message || 'Wallet connection failed.', 'error');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect owner wallet';
    }
  });
}

function watchWallet(wrapper, ownerAddress) {
  let stopAccounts = () => {};
  let stopChain = () => {};
  const invalidate = () => {
    stopAccounts();
    stopChain();
    if (!wrapper.isConnected || document.body.dataset.dmhTransactionLock === 'true') return;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    showToast('Wallet account or network changed. Reconnect to refresh your profile.', 'info');
  };
  stopAccounts = onAccountsChanged((accounts) => {
    if (!accounts[0] || accounts[0].toLowerCase() !== ownerAddress.toLowerCase()) invalidate();
  });
  stopChain = onChainChanged(invalidate);
}

async function loadVaults(region, ownerAddress) {
  region.replaceChildren(el('div', { class: 'dmh-card', role: 'status' }, [
    el('span', { class: 'dmh-spinner', 'aria-hidden': 'true' }),
    el('span', {}, ' Loading your vaults...'),
  ]));
  try {
    const [vaults, dmh] = await Promise.all([lookupVaultsByAddress(ownerAddress), Promise.resolve(getDmhReadContract())]);
    if (vaults.length === 0) {
      const createBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'button', onClick: () => navigate('setup') }, 'Create your first vault');
      region.replaceChildren(el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-empty-state' }, 'No vaults are registered to this wallet on the selected network.'),
        createBtn,
      ]));
      return;
    }

    const cards = await Promise.all(vaults.map(async (vault, index) => {
      const raw = await dmh.vaults(vault.vaultId);
      const inactivityPeriod = raw.inactivityPeriod ?? raw[2];
      return renderVaultCard(vault, index, vaults.length, inactivityPeriod);
    }));
    region.replaceChildren(
      el('div', { class: 'dmh-profile-summary' }, [
        el('h2', { class: 'dmh-card-title' }, `${vaults.length} vault${vaults.length === 1 ? '' : 's'} found`),
        el('p', { class: 'dmh-hint' }, "Reset timer calls the contract's owner-only check-in function. It keeps the same vault, secret, assets, and inactivity period."),
      ]),
      ...cards
    );
  } catch (error) {
    const retryBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button', onClick: () => loadVaults(region, ownerAddress) }, 'Retry vault lookup');
    region.replaceChildren(el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-error-text', role: 'alert' }, error.message || 'Could not load vaults.'),
      retryBtn,
    ]));
  }
}

function renderVaultCard(vault, index, total, inactivityPeriod) {
  const statusText = !vault.active
    ? 'Deactivated'
    : vault.locked
      ? `Claim cooldown: ${formatDuration(vault.cooldownRemaining)}`
      : vault.expired
        ? 'Expired and claimable'
        : `${formatDuration(vault.timeRemaining)} remaining`;
  const badgeClass = vault.active && !vault.expired && !vault.locked ? 'dmh-badge-success' : 'dmh-badge-danger';
  const openBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button', onClick: () => navigate(`dashboard/${vault.vaultId}`) }, 'Open dashboard');
  const resetBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'button' }, 'Reset inactivity timer');
  resetBtn.disabled = !vault.active;
  resetBtn.addEventListener('click', async () => {
    resetBtn.disabled = true;
    resetBtn.textContent = 'Confirm reset in wallet...';
    document.body.dataset.dmhTransactionLock = 'true';
    try {
      const currentAddress = await connectWallet();
      await ensureCorrectNetwork();
      const raw = await getDmhReadContract().vaults(vault.vaultId);
      const owner = raw.owner ?? raw[0];
      if (currentAddress.toLowerCase() !== owner.toLowerCase()) {
        throw new Error('The connected wallet is not this vault owner.');
      }
      await pingVault(vault.vaultId);
      const latest = await getVaultStatus(vault.vaultId);
      Object.assign(vault, latest);
      if (latest.locked) {
        status.textContent = `Claim cooldown: ${formatDuration(latest.cooldownRemaining)}`;
        status.className = 'dmh-badge dmh-badge-danger';
      } else {
        status.textContent = `${formatDuration(latest.timeRemaining || inactivityPeriod)} remaining`;
        status.className = 'dmh-badge dmh-badge-success';
      }
      showToast('Inactivity timer reset successfully.', 'success');
    } catch (error) {
      showToast(error.shortMessage || error.message || 'Timer reset failed.', 'error');
    } finally {
      delete document.body.dataset.dmhTransactionLock;
      resetBtn.disabled = !vault.active;
      resetBtn.textContent = 'Reset inactivity timer';
    }
  });

  const status = el('span', { class: `dmh-badge ${badgeClass}` }, statusText);
  return el('article', { class: 'dmh-card dmh-profile-vault-card', 'aria-label': `Vault ${index + 1} of ${total}` }, [
    el('div', { class: 'dmh-profile-vault-heading' }, [
      el('div', {}, [
        el('div', { class: 'dmh-card-title' }, `Vault ${index + 1}`),
        el('div', { class: 'dmh-vault-id-preview mono', title: vault.vaultId }, `${vault.vaultId.slice(0, 10)}...${vault.vaultId.slice(-8)}`),
      ]),
      status,
    ]),
    el('div', { class: 'dmh-profile-actions' }, [openBtn, resetBtn]),
  ]);
}
