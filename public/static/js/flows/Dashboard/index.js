// flows/Dashboard/index.js — active vault view: countdown, copyable vault ID,
// deactivation option, "add asset later" entry point.
import { el, renderStepIndicator, renderCopyableValue, renderStickyCta, showToast, formatDuration, formatAddress } from '../../components/theme/ui.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable } from '../../lib/wallet.js';
import { getVaultStatus, getVaultOwner, getVaultTokens, pingVault, deactivateVault, addTokenToVault, getErc20WriteContract, getErc721WriteContract } from '../../lib/contract.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';
import { navigate } from '../../app.js';

export async function renderDashboard(container, vaultId) {
  if (!vaultId || !/^0x[0-9a-fA-F]{64}$/.test(vaultId)) {
    container.appendChild(el('div', { class: 'dmh-main' }, [el('div', { class: 'dmh-warning-banner' }, 'Invalid or missing vault ID.')]));
    return;
  }

  const net = getNetworkConfig();
  const wrapper = el('div', { class: 'dmh-main' }, [el('div', { style: 'display:flex; gap:8px; align-items:center; color:var(--dmh-text-muted);' }, [el('span', { class: 'dmh-spinner' }), 'Loading vault…'])]);
  container.appendChild(wrapper);

  let status, owner, tokens;
  try {
    [status, owner, tokens] = await Promise.all([getVaultStatus(vaultId), getVaultOwner(vaultId), getVaultTokens(vaultId)]);
  } catch (e) {
    wrapper.innerHTML = '';
    wrapper.appendChild(el('div', { class: 'dmh-warning-banner danger' }, `Could not load vault: ${e.message}`));
    return;
  }

  wrapper.innerHTML = '';

  wrapper.appendChild(
    el('div', {}, [
      el('h1', { class: 'dmh-heading' }, 'Vault Dashboard'),
      el('p', { class: 'dmh-subheading' }, `Owner: ${formatAddress(owner)}`),
    ])
  );

  // Status card
  const statusBadge = !status.active
    ? el('span', { class: 'dmh-badge dmh-badge-danger' }, 'Deactivated')
    : status.locked
      ? el('span', { class: 'dmh-badge dmh-badge-danger' }, 'Locked (cooldown)')
      : status.expired
        ? el('span', { class: 'dmh-badge dmh-badge-danger' }, 'Expired — claimable')
        : el('span', { class: 'dmh-badge dmh-badge-success' }, 'Active');

  const statusCard = el('div', { class: 'dmh-card' }, [
    el('div', { style: 'display:flex; justify-content: space-between; align-items:center;' }, [
      el('div', { class: 'dmh-card-title' }, 'Status'),
      statusBadge,
    ]),
    status.active && !status.expired
      ? el('div', { class: 'dmh-countdown' }, formatDuration(status.timeRemaining))
      : null,
  ]);
  wrapper.appendChild(statusCard);

  // Warning banner nagging owner as expiry approaches — final 25% of period.
  // We don't have inactivityPeriod directly from getStatus, so approximate:
  // treat "near expiry" as timeRemaining under 25% of a typical 6-month
  // period floor isn't reliable across configs; instead fetch it via the
  // public vaults() getter alongside owner in a follow-up call, kept simple
  // here by re-deriving from status only when it's unambiguous (<= 14 days
  // remaining is always worth nagging about regardless of total period).
  if (status.active && !status.expired && status.timeRemaining < 14n * 24n * 60n * 60n) {
    wrapper.appendChild(
      el('div', { class: 'dmh-warning-banner' }, `Only ${formatDuration(status.timeRemaining)} left before this vault becomes claimable. Check in now if you're still in control of this wallet.`)
    );
  }

  // Vault ID card
  wrapper.appendChild(
    el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-card-title' }, 'Vault ID'),
      renderCopyableValue(vaultId, 'Vault ID'),
    ])
  );

  // Protected assets card
  const assetsCard = el('div', { class: 'dmh-card' }, [el('div', { class: 'dmh-card-title' }, `Protected assets (${tokens.length})`)]);
  if (tokens.length === 0) {
    assetsCard.appendChild(el('div', { class: 'dmh-empty-state' }, 'No assets registered yet.'));
  } else {
    for (const t of tokens) {
      assetsCard.appendChild(
        el('div', { class: 'dmh-asset-row' }, [
          el('div', { class: 'dmh-asset-info' }, [
            el('div', { class: 'dmh-asset-symbol mono' }, formatAddress(t.tokenAddress)),
            el('div', { class: 'dmh-asset-balance' }, t.isERC721 ? 'NFT collection' : 'ERC-20 token'),
          ]),
        ])
      );
    }
  }
  wrapper.appendChild(assetsCard);

  // Owner actions — require wallet connection & being the actual owner.
  const actionsCard = el('div', { class: 'dmh-card' }, [el('div', { class: 'dmh-card-title' }, 'Owner actions')]);
  const connectBtn = el('button', { class: 'dmh-btn dmh-btn-secondary' }, isWalletAvailable() ? 'Connect wallet to manage this vault' : 'No wallet detected');
  connectBtn.disabled = !isWalletAvailable();
  actionsCard.appendChild(connectBtn);
  wrapper.appendChild(actionsCard);

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    try {
      const addr = await connectWallet();
      await ensureCorrectNetwork();
      if (addr.toLowerCase() !== owner.toLowerCase()) {
        showToast('Connected wallet is not this vault\'s owner — read-only view only.', 'info');
        connectBtn.textContent = `Connected (not owner): ${formatAddress(addr)}`;
        return;
      }
      renderOwnerControls(actionsCard, vaultId, status, net);
      connectBtn.remove();
    } catch (e) {
      showToast(e.message, 'error');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect wallet to manage this vault';
    }
  });
}

function renderOwnerControls(actionsCard, vaultId, status, net) {
  const pingBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, "Check in now (I'm still here)");
  pingBtn.disabled = !status.active;
  pingBtn.addEventListener('click', async () => {
    pingBtn.disabled = true;
    pingBtn.textContent = 'Confirm in wallet…';
    try {
      await pingVault(vaultId);
      showToast('Checked in — countdown reset.', 'success');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      showToast(e.shortMessage || e.message, 'error');
      pingBtn.disabled = false;
      pingBtn.textContent = "Check in now (I'm still here)";
    }
  });

  const addAssetBtn = el('button', { class: 'dmh-btn dmh-btn-secondary' }, '+ Add another asset');
  addAssetBtn.addEventListener('click', () => {
    renderAddAssetForm(actionsCard, vaultId, net);
  });

  const deactivateBtn = el('button', { class: 'dmh-btn dmh-btn-danger' }, 'Deactivate vault');
  deactivateBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Deactivate this vault permanently? It can never be claimed again. This does NOT revoke your existing token approvals — do that separately if you want a full clean break.'
    );
    if (!confirmed) return;
    deactivateBtn.disabled = true;
    try {
      await deactivateVault(vaultId);
      showToast('Vault deactivated.', 'success');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      showToast(e.shortMessage || e.message, 'error');
      deactivateBtn.disabled = false;
    }
  });

  actionsCard.appendChild(pingBtn);
  actionsCard.appendChild(addAssetBtn);
  actionsCard.appendChild(el('div', { class: 'dmh-divider' }));
  actionsCard.appendChild(el('p', { class: 'dmh-hint' }, "Deactivating does not automatically revoke individual token approvals — revoke them separately if you want a full clean break."));
  actionsCard.appendChild(deactivateBtn);
}

function renderAddAssetForm(actionsCard, vaultId, net) {
  const input = el('input', { class: 'dmh-input mono', placeholder: '0x… token/collection contract address' });
  const isErc721Toggle = el('div', { class: 'dmh-chip-row' });
  let isErc721 = false;
  const chipToken = el('button', { class: 'dmh-chip selected', type: 'button' }, 'ERC-20 token');
  const chipNft = el('button', { class: 'dmh-chip', type: 'button' }, 'NFT collection');
  chipToken.addEventListener('click', () => { isErc721 = false; chipToken.classList.add('selected'); chipNft.classList.remove('selected'); });
  chipNft.addEventListener('click', () => { isErc721 = true; chipNft.classList.add('selected'); chipToken.classList.remove('selected'); });
  isErc721Toggle.appendChild(chipToken);
  isErc721Toggle.appendChild(chipNft);

  const submitBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Approve & register');
  submitBtn.addEventListener('click', async () => {
    const raw = input.value.trim();
    if (!ethers.isAddress(raw)) {
      showToast('Enter a valid contract address.', 'error');
      return;
    }
    const addr = ethers.getAddress(raw);
    submitBtn.disabled = true;
    try {
      submitBtn.textContent = 'Approving…';
      if (isErc721) {
        const nft = getErc721WriteContract(addr);
        const tx = await nft.setApprovalForAll(net.dmhContractAddress, true);
        await tx.wait();
      } else {
        const token = getErc20WriteContract(addr);
        const tx = await token.approve(net.dmhContractAddress, ethers.MaxUint256);
        await tx.wait();
      }
      submitBtn.textContent = 'Registering…';
      await addTokenToVault(vaultId, addr, isErc721);
      showToast('Asset added to vault.', 'success');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      showToast(e.shortMessage || e.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Approve & register';
    }
  });

  const form = el('div', { class: 'dmh-field', style: 'margin-top: 12px;' }, [
    el('label', { class: 'dmh-label' }, 'New asset — no new secret or re-setup needed'),
    input,
    isErc721Toggle,
    submitBtn,
  ]);
  actionsCard.appendChild(form);
}
