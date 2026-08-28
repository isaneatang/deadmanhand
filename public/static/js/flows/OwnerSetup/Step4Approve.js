// flows/OwnerSetup/Step4Approve.js — Step 4: Batch-approve queue (sequential wallet prompts)
//
// Order of on-chain operations (matches Master Build Prompt Section 4.1/4.2):
//   1. createVault(vaultId, secretHash, inactivityPeriod)
//   2. For each selected asset: approve()/setApprovalForAll() directly on the
//      token/collection contract (naming DMH as spender), THEN addToken(vaultId, tokenAddress)
//      to register it in the vault's registry.
import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast, formatAddress } from '../../components/theme/ui.js';
import { createVault, addTokenToVault, getErc20WriteContract, getErc721WriteContract } from '../../lib/contract.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';

export function renderStep4Approve(container, state, onNext, onBack) {
  const net = getNetworkConfig();
  const listEl = el('div', { class: 'dmh-card' });
  const continueBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Waiting to start…');
  continueBtn.disabled = true;

  const rows = [];

  function addRow(label) {
    const statusEl = el('span', { class: 'dmh-badge' }, 'Pending');
    const row = el('div', { class: 'dmh-asset-row' }, [
      el('div', { class: 'dmh-asset-info' }, [el('div', { class: 'dmh-asset-symbol' }, label)]),
      statusEl,
    ]);
    listEl.appendChild(row);
    rows.push({ row, statusEl });
    return statusEl;
  }

  function setStatus(statusEl, status) {
    statusEl.className = 'dmh-badge';
    if (status === 'success') {
      statusEl.classList.add('dmh-badge-success');
      statusEl.textContent = '✓ Done';
    } else if (status === 'error') {
      statusEl.classList.add('dmh-badge-danger');
      statusEl.textContent = '✗ Failed';
    } else if (status === 'active') {
      statusEl.textContent = 'Confirm in wallet…';
    } else {
      statusEl.textContent = 'Pending';
    }
  }

  async function runQueue() {
    let hadError = false;

    // Step A: createVault
    const vaultStatus = addRow('Create vault');
    setStatus(vaultStatus, 'active');
    try {
      await createVault(state.vaultId, state.secretHash, state.inactivityPeriodSeconds);
      setStatus(vaultStatus, 'success');
    } catch (e) {
      setStatus(vaultStatus, 'error');
      showToast(`Vault creation failed: ${e.shortMessage || e.message}`, 'error');
      continueBtn.disabled = false;
      continueBtn.textContent = 'Retry';
      continueBtn.onclick = () => location.reload();
      return;
    }

    // Step B: for each asset, approve then register.
    for (const asset of state.selectedAssets) {
      const isErc721 = asset.type === 'ERC-721' || asset.type === 'ERC721';
      const label = `${asset.symbol} (${formatAddress(asset.address)}) — ${isErc721 ? 'approve collection' : 'approve token'}`;
      const approveStatus = addRow(label);
      setStatus(approveStatus, 'active');
      try {
        if (isErc721) {
          const nft = getErc721WriteContract(asset.address);
          const tx = await nft.setApprovalForAll(net.dmhContractAddress, true);
          await tx.wait();
        } else {
          const token = getErc20WriteContract(asset.address);
          const tx = await token.approve(net.dmhContractAddress, ethers.MaxUint256);
          await tx.wait();
        }
        setStatus(approveStatus, 'success');
      } catch (e) {
        setStatus(approveStatus, 'error');
        showToast(`Approval failed for ${asset.symbol}: ${e.shortMessage || e.message}`, 'error');
        hadError = true;
        continue; // skip registering this one but keep going with the rest
      }

      const registerStatus = addRow(`${asset.symbol} — register with vault`);
      setStatus(registerStatus, 'active');
      try {
        await addTokenToVault(state.vaultId, asset.address, isErc721);
        setStatus(registerStatus, 'success');
      } catch (e) {
        setStatus(registerStatus, 'error');
        showToast(`Registering ${asset.symbol} failed: ${e.shortMessage || e.message}`, 'error');
        hadError = true;
      }
    }

    continueBtn.disabled = false;
    continueBtn.textContent = hadError ? 'Continue anyway →' : 'Vault is live →';
    continueBtn.onclick = () => onNext();
  }

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(4, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('h1', { class: 'dmh-heading' }, 'Confirm in your wallet'),
      el('p', { class: 'dmh-subheading' }, state.selectedAssets.length > 0
        ? `You'll be asked to confirm ${1 + state.selectedAssets.length * 2} transactions: creating the vault, then one approval + one registration per asset.`
        : 'You\'ll be asked to confirm 1 transaction to create your vault (no assets selected yet — you can add some later).'),
      listEl,
    ])
  );
  container.appendChild(renderStickyCta(continueBtn));

  runQueue();
}
