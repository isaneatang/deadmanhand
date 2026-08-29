// flows/Dashboard/index.js — vault status, registered assets, and owner controls.
import { el, renderBackBar, renderCopyableValue, showToast, formatDuration, formatAddress } from '../../components/theme/ui.js';
import { renderAssetPanel } from '../../components/AssetPanel/AssetPanel.js';
import { connectWallet, ensureCorrectNetwork, isWalletAvailable } from '../../lib/wallet.js';
import { getDmhReadContract, getVaultStatus, getVaultTokens, pingVault, deactivateVault, addTokenToVault, getErc20WriteContract, getErc721WriteContract } from '../../lib/contract.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';
import { navigate } from '../../app.js';

const SECOND = 1000;

export async function renderDashboard(container, vaultId) {
  container.appendChild(renderBackBar(() => {
    if (document.body.dataset.dmhTransactionLock === 'true') {
      showToast('Finish or reject the current wallet transaction before leaving the dashboard.', 'info');
      return;
    }
    navigate('profile');
  }, 'Vault dashboard'));

  const wrapper = el('div', { class: 'dmh-main' });
  container.appendChild(wrapper);

  if (!vaultId || !/^0x[0-9a-fA-F]{64}$/.test(vaultId)) {
    wrapper.appendChild(el('div', { class: 'dmh-warning-banner danger', role: 'alert' }, 'Invalid or missing vault ID.'));
    return;
  }

  const loading = el('div', { class: 'dmh-card', role: 'status', 'aria-live': 'polite' }, [
    el('div', { class: 'dmh-subheading' }, [el('span', { class: 'dmh-spinner', 'aria-hidden': 'true' }), ' Loading vault...']),
  ]);
  wrapper.appendChild(loading);

  let vault;
  try {
    vault = await loadVault(vaultId);
  } catch (e) {
    wrapper.replaceChildren(el('div', { class: 'dmh-warning-banner danger', role: 'alert' }, `Could not load vault: ${e.message}`));
    return;
  }

  wrapper.replaceChildren();
  const headingId = 'dmh-dashboard-heading';
  wrapper.appendChild(el('header', {}, [
    el('h1', { id: headingId, class: 'dmh-heading' }, 'Vault Dashboard'),
    el('p', { class: 'dmh-subheading' }, `Owner ${formatAddress(vault.owner)} on ${getNetworkConfig().chainName}`),
  ]));
  wrapper.setAttribute('aria-labelledby', headingId);

  const statusRegion = el('section', { 'aria-label': 'Vault status' });
  const metadataRegion = el('section', { 'aria-label': 'Vault details' });
  const assetsRegion = el('section', { 'aria-label': 'Registered assets' });
  const actionsRegion = el('section', { 'aria-label': 'Wallet access and owner actions' });
  wrapper.appendChild(statusRegion);
  wrapper.appendChild(metadataRegion);
  wrapper.appendChild(assetsRegion);
  wrapper.appendChild(actionsRegion);

  let stopCountdown = () => {};
  const renderVaultData = () => {
    stopCountdown();
    stopCountdown = renderStatus(statusRegion, vault.status);
    renderMetadata(metadataRegion, vaultId, vault);
    renderRegisteredAssets(assetsRegion, vault.tokens);
  };
  renderVaultData();

  let ownerControls = null;
  async function refreshVault() {
    vault = await loadVault(vaultId);
    renderVaultData();
    ownerControls?.updateStatus(vault.status, vault.tokens);
  }

  renderWalletState(actionsRegion, {
    vaultId,
    getVault: () => vault,
    refreshVault,
    onOwnerControls: (controls) => { ownerControls = controls; },
  });
}

async function loadVault(vaultId) {
  const dmh = getDmhReadContract();
  const [status, tokens, raw] = await Promise.all([
    getVaultStatus(vaultId),
    getVaultTokens(vaultId),
    dmh.vaults(vaultId),
  ]);
  return {
    status,
    tokens,
    owner: raw.owner ?? raw[0],
    inactivityPeriod: raw.inactivityPeriod ?? raw[2],
    lastActive: raw.lastActive ?? raw[3],
    exists: raw.exists ?? raw[5],
    failedAttempts: raw.failedAttempts ?? raw[6],
    cooldownUntil: raw.cooldownUntil ?? raw[7],
  };
}

function renderStatus(region, status) {
  let remaining = BigInt(status.timeRemaining);
  let cooldownRemaining = BigInt(status.cooldownRemaining);
  const badge = el('span');
  const countdown = el('time', { class: 'dmh-countdown' });
  const description = el('p', { class: 'dmh-subheading' });
  const card = el('div', { class: 'dmh-card' }, [
    el('div', { class: 'dmh-card-title' }, 'Current status'),
    badge,
    countdown,
    description,
  ]);
  region.replaceChildren(card);

  function tick() {
    if (!status.active) {
      badge.className = 'dmh-badge dmh-badge-danger';
      badge.textContent = 'Deactivated';
      countdown.hidden = true;
      description.textContent = 'This vault is permanently inactive and cannot be checked in, changed, or claimed.';
      return;
    }
    const expired = remaining <= 0n;
    const locked = status.locked && cooldownRemaining > 0n;
    badge.className = expired || locked ? 'dmh-badge dmh-badge-danger' : 'dmh-badge dmh-badge-success';
    badge.textContent = locked ? 'Claim attempts locked' : expired ? 'Expired - claimable' : 'Active';
    countdown.hidden = false;
    countdown.textContent = expired ? '00:00:00' : formatDuration(remaining);
    countdown.setAttribute('datetime', `PT${expired ? 0 : remaining}S`);
    description.textContent = locked
      ? `Claim attempts are in cooldown for ${formatDuration(cooldownRemaining)}. The owner can still check in.`
      : expired
        ? 'The inactivity period has elapsed. The owner can still check in unless a claim completes first.'
        : remaining < 14n * 24n * 60n * 60n
          ? 'Time is running low. The owner should check in to reset the inactivity clock.'
          : 'Time remaining before the vault becomes claimable.';
  }

  tick();
  if (!status.active) return () => {};
  const timer = window.setInterval(() => {
    if (!region.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (remaining > 0n) remaining -= 1n;
    if (cooldownRemaining > 0n) cooldownRemaining -= 1n;
    tick();
  }, SECOND);
  return () => window.clearInterval(timer);
}

function renderMetadata(region, vaultId, vault) {
  const details = el('dl', { class: 'dmh-card' }, [
    el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Owner'), el('dd', { class: 'mono' }, vault.owner)]),
    el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Inactivity period'), el('dd', {}, formatDuration(vault.inactivityPeriod))]),
    el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Last check-in'), el('dd', {}, formatTimestamp(vault.lastActive))]),
    el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Failed claim attempts'), el('dd', {}, String(vault.failedAttempts))]),
    BigInt(vault.cooldownUntil) > 0n
      ? el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Claim cooldown until'), el('dd', {}, formatTimestamp(vault.cooldownUntil))])
      : null,
    el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Vault ID'), el('dd', {}, renderCopyableValue(vaultId, 'Vault ID'))]),
  ]);
  region.replaceChildren(details);
}

function formatTimestamp(value) {
  const milliseconds = Number(BigInt(value) * 1000n);
  if (!Number.isSafeInteger(milliseconds)) return 'Unavailable';
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

function renderRegisteredAssets(region, tokens) {
  const card = el('div', { class: 'dmh-card' }, [
    el('h2', { class: 'dmh-card-title' }, `Registered assets (${tokens.length})`),
    el('p', { class: 'dmh-hint' }, 'These contracts are registered for recovery. Registration does not prove a current balance or approval.'),
  ]);
  if (tokens.length === 0) {
    card.appendChild(el('div', { class: 'dmh-empty-state' }, 'No assets registered yet.'));
  } else {
    for (const token of tokens) {
      card.appendChild(el('div', { class: 'dmh-asset-row' }, [
        el('div', { class: 'dmh-asset-info' }, [
          el('div', { class: 'dmh-asset-symbol mono' }, formatAddress(token.tokenAddress)),
          el('div', { class: 'dmh-asset-balance' }, token.isERC721 ? 'ERC-721 collection' : 'ERC-20 token'),
        ]),
      ]));
    }
  }
  region.replaceChildren(card);
}

function renderWalletState(region, { vaultId, getVault, refreshVault, onOwnerControls }) {
  const title = el('h2', { class: 'dmh-card-title' }, 'Access');
  const state = el('p', { class: 'dmh-subheading', role: 'status', 'aria-live': 'polite' }, 'Read-only view. Connect the owner wallet to manage this vault.');
  const connectBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, isWalletAvailable() ? 'Connect wallet' : 'No wallet detected');
  connectBtn.disabled = !isWalletAvailable();
  const card = el('div', { class: 'dmh-card' }, [title, state, connectBtn]);
  region.replaceChildren(card);

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    try {
      const address = await connectWallet();
      await ensureCorrectNetwork();
      if (address.toLowerCase() !== getVault().owner.toLowerCase()) {
        state.textContent = `Non-owner wallet connected: ${formatAddress(address)}. This remains a read-only view.`;
        connectBtn.textContent = 'Connected wallet is not the owner';
        showToast('Connected wallet is not this vault\'s owner. No management actions are available.', 'info');
        return;
      }

      state.textContent = `Owner wallet connected: ${formatAddress(address)}. Management actions are available below.`;
      connectBtn.remove();
      const controls = renderOwnerControls(card, vaultId, getVault(), refreshVault);
      onOwnerControls(controls);
      const holdings = renderAssetPanel({ address, selectable: false });
      region.appendChild(el('section', { 'aria-label': 'Owner wallet holdings' }, holdings.node));
    } catch (e) {
      showToast(e.shortMessage || e.message, 'error');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect wallet';
      state.textContent = 'Read-only view. Wallet connection did not complete.';
    }
  });
}

function renderOwnerControls(card, vaultId, initialVault, refreshVault) {
  let status = initialVault.status;
  let tokens = initialVault.tokens;
  let addForm = null;
  let confirmation = null;

  const controls = el('div', { class: 'dmh-field', 'aria-label': 'Owner actions' });
  const actionStatus = el('div', { class: 'dmh-hint', role: 'status', 'aria-live': 'polite' });
  const pingBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'button' }, 'Reset inactivity timer');
  const addAssetBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, '+ Add another asset');
  const deactivateBtn = el('button', { class: 'dmh-btn dmh-btn-danger', type: 'button' }, 'Deactivate vault');

  function syncDisabledState() {
    const inactive = !status.active;
    pingBtn.disabled = inactive;
    addAssetBtn.disabled = inactive || Boolean(addForm);
    deactivateBtn.disabled = inactive || Boolean(confirmation);
    actionStatus.textContent = inactive
      ? 'Owner state: vault inactive. Check-in, asset registration, and deactivation are unavailable.'
      : 'Owner state: vault active. Transactions require wallet confirmation.';
    if (inactive) {
      addForm?.remove();
      addForm = null;
      confirmation?.remove();
      confirmation = null;
    }
  }

  async function verifyOwnerWallet() {
    const address = await connectWallet();
    await ensureCorrectNetwork();
    if (address.toLowerCase() !== initialVault.owner.toLowerCase()) {
      throw new Error('The connected wallet is not this vault owner.');
    }
  }

  pingBtn.addEventListener('click', async () => {
    pingBtn.disabled = true;
    pingBtn.textContent = 'Confirm timer reset in wallet...';
    document.body.dataset.dmhTransactionLock = 'true';
    try {
      await verifyOwnerWallet();
      await pingVault(vaultId);
      await refreshVault();
      showToast('Inactivity timer reset.', 'success');
    } catch (e) {
      showToast(e.shortMessage || e.message, 'error');
    } finally {
      delete document.body.dataset.dmhTransactionLock;
      pingBtn.textContent = 'Reset inactivity timer';
      syncDisabledState();
    }
  });

  addAssetBtn.addEventListener('click', () => {
    if (addForm || !status.active) return;
    addForm = renderAddAssetForm(vaultId, tokens, async () => {
      await refreshVault();
      addForm?.remove();
      addForm = null;
      syncDisabledState();
    }, () => {
      addForm?.remove();
      addForm = null;
      syncDisabledState();
      addAssetBtn.focus();
    });
    controls.insertBefore(addForm, controls.querySelector('.dmh-divider'));
    addAssetBtn.disabled = true;
    addForm.querySelector('input').focus();
  });

  deactivateBtn.addEventListener('click', () => {
    if (confirmation || !status.active) return;
    const headingId = 'dmh-deactivate-confirm-title';
    const cancelBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, 'Cancel');
    const confirmBtn = el('button', { class: 'dmh-btn dmh-btn-danger', type: 'button' }, 'Permanently deactivate');
    confirmation = el('div', { class: 'dmh-warning-banner danger', role: 'alertdialog', 'aria-labelledby': headingId, 'aria-describedby': 'dmh-deactivate-confirm-description' }, [
      el('strong', { id: headingId }, 'Deactivate this vault?'),
      el('p', { id: 'dmh-deactivate-confirm-description' }, 'This is permanent: the vault can never be claimed. Existing token approvals are not revoked and must be revoked separately.'),
      cancelBtn,
      confirmBtn,
    ]);
    controls.appendChild(confirmation);
    deactivateBtn.disabled = true;
    cancelBtn.addEventListener('click', () => {
      confirmation.remove();
      confirmation = null;
      syncDisabledState();
      deactivateBtn.focus();
    });
    confirmBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Confirm in wallet...';
      document.body.dataset.dmhTransactionLock = 'true';
      try {
        await verifyOwnerWallet();
        await deactivateVault(vaultId);
        await refreshVault();
        showToast('Vault deactivated.', 'success');
      } catch (e) {
        showToast(e.shortMessage || e.message, 'error');
        cancelBtn.disabled = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Permanently deactivate';
      } finally {
        delete document.body.dataset.dmhTransactionLock;
      }
    });
    confirmBtn.focus();
  });

  controls.appendChild(actionStatus);
  controls.appendChild(pingBtn);
  controls.appendChild(addAssetBtn);
  controls.appendChild(el('div', { class: 'dmh-divider' }));
  controls.appendChild(el('p', { class: 'dmh-hint' }, 'Deactivation does not revoke token approvals. Revoke approvals separately if you want to remove contract access.'));
  controls.appendChild(deactivateBtn);
  card.appendChild(controls);
  syncDisabledState();

  return {
    updateStatus(nextStatus, nextTokens) {
      status = nextStatus;
      tokens = nextTokens;
      syncDisabledState();
    },
  };
}

function renderAddAssetForm(vaultId, registeredTokens, onAdded, onCancel) {
  const net = getNetworkConfig();
  const inputId = 'dmh-dashboard-token-address';
  const input = el('input', { id: inputId, class: 'dmh-input mono', placeholder: '0x... token or collection contract', type: 'text', autocomplete: 'off' });
  const typeGroup = el('div', { class: 'dmh-chip-row', role: 'group', 'aria-label': 'Asset contract type' });
  let isErc721 = false;
  let approvalComplete = false;
  const chipToken = el('button', { class: 'dmh-chip selected', type: 'button', 'aria-pressed': 'true' }, 'ERC-20 token');
  const chipNft = el('button', { class: 'dmh-chip', type: 'button', 'aria-pressed': 'false' }, 'ERC-721 collection');
  const approvalExplanation = el('p', { class: 'dmh-hint' });

  function selectType(nft) {
    isErc721 = nft;
    chipToken.classList.toggle('selected', !nft);
    chipNft.classList.toggle('selected', nft);
    chipToken.setAttribute('aria-pressed', String(!nft));
    chipNft.setAttribute('aria-pressed', String(nft));
    approvalExplanation.textContent = nft
      ? 'Approval applies to the entire NFT collection, including NFTs acquired later. Recovery requires ERC721Enumerable and can transfer at most 20 NFTs from this collection per claim.'
      : 'Approval sets an unlimited ERC-20 allowance. This lets recovery transfer the owner\'s current token balance without another signature; revoke the allowance separately to remove access.';
  }
  chipToken.addEventListener('click', () => selectType(false));
  chipNft.addEventListener('click', () => selectType(true));
  typeGroup.appendChild(chipToken);
  typeGroup.appendChild(chipNft);
  selectType(false);

  const formStatus = el('div', { class: 'dmh-error-text', role: 'alert', 'aria-live': 'assertive' });
  const submitBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'submit' }, 'Approve and register');
  const cancelBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button' }, 'Cancel');
  const form = el('form', { class: 'dmh-card', 'aria-label': 'Add registered asset' }, [
    el('h3', { class: 'dmh-card-title' }, 'Add asset'),
    el('label', { class: 'dmh-label', for: inputId }, 'Token or collection contract address'),
    input,
    typeGroup,
    approvalExplanation,
    formStatus,
    submitBtn,
    cancelBtn,
  ]);
  cancelBtn.addEventListener('click', onCancel);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formStatus.textContent = '';
    const raw = input.value.trim();
    if (!ethers.isAddress(raw) || /^0x0{40}$/i.test(raw)) {
      formStatus.textContent = 'Enter a valid non-zero contract address.';
      return;
    }
    const address = ethers.getAddress(raw);
    if (registeredTokens.some((token) => token.tokenAddress.toLowerCase() === address.toLowerCase())) {
      formStatus.textContent = 'This asset is already registered with the vault.';
      return;
    }

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    document.body.dataset.dmhTransactionLock = 'true';
    try {
      const owner = await connectWallet();
      await ensureCorrectNetwork();
      const rawVault = await getDmhReadContract().vaults(vaultId);
      const vaultOwner = rawVault.owner ?? rawVault[0];
      if (owner.toLowerCase() !== vaultOwner.toLowerCase()) {
        throw new Error('The connected wallet is not this vault owner.');
      }
      if (!approvalComplete) {
        submitBtn.textContent = 'Confirm approval in wallet...';
        if (isErc721) {
          const collection = getErc721WriteContract(address);
          const tx = await collection.setApprovalForAll(net.dmhContractAddress, true);
          await tx.wait();
        } else {
          const token = getErc20WriteContract(address);
          const tx = await token.approve(net.dmhContractAddress, ethers.MaxUint256);
          await tx.wait();
        }
        approvalComplete = true;
      }
      submitBtn.textContent = 'Confirm registration in wallet...';
      await addTokenToVault(vaultId, address, isErc721);
      await onAdded();
      showToast('Asset approved and registered.', 'success');
    } catch (e) {
      formStatus.textContent = e.shortMessage || e.message;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      submitBtn.textContent = approvalComplete ? 'Retry registration' : 'Approve and register';
    } finally {
      delete document.body.dataset.dmhTransactionLock;
    }
  });
  return form;
}
