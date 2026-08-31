// flows/OwnerSetup/Step4Approve.js — Step 4: review, then run sequential wallet transactions
import { el, renderBackBar, renderStepIndicator, renderStickyCta, showToast, formatAddress } from '../../components/theme/ui.js';
import { createVault, addTokenToVault, getErc20WriteContract, getErc721WriteContract } from '../../lib/contract.js';
import { getActiveNetworkKey, getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';
import { getCachedSigner } from '../../lib/wallet.js';

const MAX_ASSETS = 50;

function normalizeAsset(asset) {
  const compactType = String(asset && asset.type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const type = compactType === 'ERC20' ? 'ERC-20' : compactType === 'ERC721' ? 'ERC-721' : null;
  const address = asset && asset.address;
  if (!type || !ethers.isAddress(address) || /^0x0{40}$/i.test(address)) return null;
  return {
    ...asset,
    address: ethers.getAddress(address),
    symbol: typeof asset.symbol === 'string' && asset.symbol.trim() ? asset.symbol.trim().slice(0, 100) : 'Unknown asset',
    type,
    isErc721: type === 'ERC-721',
  };
}

export function renderStep4Approve(container, state, onNext, onBack) {
  const net = getNetworkConfig();
  const networkKey = getActiveNetworkKey();
  const rawAssets = Array.isArray(state.selectedAssets) ? state.selectedAssets : [];
  const normalizedAssets = [];
  const seenAddresses = new Set();
  let validationError = '';

  if (rawAssets.length > MAX_ASSETS) {
    validationError = `This vault can register at most ${MAX_ASSETS} assets. Return and reduce your selection.`;
  } else {
    for (const asset of rawAssets) {
      const normalized = normalizeAsset(asset);
      if (!normalized) {
        validationError = 'The selection contains a native, malformed, or unsupported asset. Only ERC-20 and ERC-721 contract addresses can be registered.';
        break;
      }
      const key = normalized.address.toLowerCase();
      if (seenAddresses.has(key)) {
        validationError = `The selection contains the same contract more than once: ${formatAddress(normalized.address)}.`;
        break;
      }
      seenAddresses.add(key);
      normalizedAssets.push(normalized);
    }
  }

  const listEl = el('div', { class: 'dmh-card', 'aria-label': 'Transaction queue' });
  const queueStatus = el('p', {
    class: validationError ? 'dmh-error-text' : 'dmh-hint',
    id: 'owner-approval-status',
    role: validationError ? 'alert' : 'status',
    'aria-live': validationError ? 'assertive' : 'polite',
    'aria-atomic': 'true',
  }, validationError || 'Review the transactions below. Nothing has been submitted yet.');
  const actionBtn = el('button', {
    class: 'dmh-btn dmh-btn-primary',
    type: 'button',
    'aria-describedby': 'owner-approval-status',
  }, 'Start transactions');
  actionBtn.disabled = Boolean(validationError);

  const tasks = [];

  function addTask(label, run) {
    const statusEl = el('span', { class: 'dmh-badge', role: 'status', 'aria-live': 'polite' }, 'Not started');
    listEl.appendChild(el('div', { class: 'dmh-asset-row' }, [
      el('div', { class: 'dmh-asset-info' }, [el('div', { class: 'dmh-asset-symbol' }, label)]),
      statusEl,
    ]));
    tasks.push({ label, run, statusEl, status: 'pending' });
  }

  function setTaskStatus(task, status) {
    task.status = status;
    task.statusEl.className = 'dmh-badge';
    if (status === 'success') {
      task.statusEl.classList.add('dmh-badge-success');
      task.statusEl.textContent = 'Completed';
    } else if (status === 'error') {
      task.statusEl.classList.add('dmh-badge-danger');
      task.statusEl.textContent = 'Failed';
    } else if (status === 'active') {
      task.statusEl.textContent = 'Confirm in wallet';
    } else {
      task.statusEl.textContent = 'Not started';
    }
  }

  addTask('Create v2 vault', () => createVault(state.vaultId, state.authorizationSigner, state.kdfSalt, state.kdfVersion, state.inactivityPeriodSeconds));
  for (const asset of normalizedAssets) {
    addTask(
      `${asset.symbol} (${formatAddress(asset.address)}) — ${asset.isErc721 ? 'approve collection' : 'approve token'}`,
      async () => {
        if (asset.isErc721) {
          const nft = getErc721WriteContract(asset.address);
          const tx = await nft.setApprovalForAll(net.dmhContractAddress, true);
          await tx.wait();
        } else {
          const token = getErc20WriteContract(asset.address);
          const tx = await token.approve(net.dmhContractAddress, ethers.MaxUint256);
          await tx.wait();
        }
      }
    );
    addTask(
      `${asset.symbol} (${formatAddress(asset.address)}) — register with vault`,
      () => addTokenToVault(state.vaultId, asset.address, asset.isErc721)
    );
  }

  let nextTaskIndex = 0;
  let running = false;
  const backBar = renderBackBar(onBack);
  const backBtn = backBar.querySelector('button');

  function setQueueMessage(message, isError = false) {
    queueStatus.className = isError ? 'dmh-error-text' : 'dmh-hint';
    queueStatus.setAttribute('role', isError ? 'alert' : 'status');
    queueStatus.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    queueStatus.textContent = message;
  }

  async function assertDerivationContext() {
    const currentNet = getNetworkConfig();
    const signer = getCachedSigner();
    if (!signer) throw new Error('Reconnect the owner wallet and restart setup.');
    const [walletAddress, walletNetwork] = await Promise.all([signer.getAddress(), signer.provider.getNetwork()]);
    if (ethers.getAddress(walletAddress) !== ethers.getAddress(state.derivationOwnerAddress || state.address)) {
      throw new Error('The connected account changed after recovery-key derivation. Restart setup with the intended owner wallet.');
    }
    if (
      walletNetwork.chainId !== BigInt(state.derivationChainId)
      || currentNet.chainId !== state.derivationChainId
      || currentNet.dmhContractAddress?.toLowerCase() !== state.derivationContractAddress?.toLowerCase()
    ) {
      throw new Error('The network or DMH contract changed after recovery-key derivation. Restart setup on the intended deployment.');
    }
  }

  async function runQueue() {
    if (running || validationError) return;
    if (nextTaskIndex >= tasks.length) {
      onNext();
      return;
    }

    running = true;
    document.body.dataset.dmhTransactionLock = 'true';
    actionBtn.disabled = true;
    backBtn.disabled = true;
    backBtn.setAttribute('aria-label', 'Back unavailable after transactions start');
    try {
      await assertDerivationContext();
    } catch (error) {
      setQueueMessage(error.message, true);
      actionBtn.disabled = false;
      backBtn.disabled = false;
      running = false;
      delete document.body.dataset.dmhTransactionLock;
      return;
    }
    while (nextTaskIndex < tasks.length) {
      if (!container.isConnected || getActiveNetworkKey() !== networkKey) {
        setQueueMessage('Transaction queue stopped because the screen or selected network changed. Return to setup and verify on-chain state before continuing.', true);
        running = false;
        delete document.body.dataset.dmhTransactionLock;
        return;
      }
      const task = tasks[nextTaskIndex];
      setTaskStatus(task, 'active');
      setQueueMessage(`Transaction ${nextTaskIndex + 1} of ${tasks.length}: confirm “${task.label}” in your wallet, then wait for network confirmation.`);
      try {
        await assertDerivationContext();
        await task.run();
        setTaskStatus(task, 'success');
        nextTaskIndex += 1;
      } catch (error) {
        const message = error.shortMessage || error.message || 'Transaction failed.';
        setTaskStatus(task, 'error');
        setQueueMessage(`Transaction ${nextTaskIndex + 1} failed: ${message} No later transaction was started. Retry this transaction to resume the queue.`, true);
        showToast(`Transaction failed: ${message}`, 'error');
        actionBtn.textContent = 'Retry failed transaction';
        actionBtn.disabled = false;
        running = false;
        delete document.body.dataset.dmhTransactionLock;
        return;
      }
    }

    running = false;
    delete document.body.dataset.dmhTransactionLock;
    state.selectedAssets = normalizedAssets;
    setQueueMessage(`All ${tasks.length} transactions are confirmed. Your vault is live.`);
    actionBtn.textContent = 'Continue to secure handoff →';
    actionBtn.disabled = false;
  }

  actionBtn.addEventListener('click', runQueue);

  const transactionCount = tasks.length;
  const reviewCard = el('section', { class: 'dmh-card', 'aria-labelledby': 'owner-review-title' }, [
    el('h2', { class: 'dmh-card-title', id: 'owner-review-title' }, 'Review before starting'),
    el('p', { class: 'dmh-hint' }, normalizedAssets.length > 0
      ? `${transactionCount} transactions will run sequentially: one vault creation, then one approval and one registration for each of ${normalizedAssets.length} selected assets.`
      : 'One transaction will create the vault. No asset approvals will be requested.'),
    normalizedAssets.some((asset) => !asset.isErc721)
      ? el('p', { class: 'dmh-warning-banner' }, 'ERC-20 approvals are unlimited allowances. They let the vault contract transfer the token balance during recovery, including tokens received later, until you revoke the allowance.')
      : null,
    normalizedAssets.some((asset) => asset.isErc721)
      ? el('p', { class: 'dmh-warning-banner' }, 'ERC-721 approval applies to the entire collection, including NFTs acquired later, until revoked. Recovery requires ERC721Enumerable and can transfer at most 20 NFTs from each collection per claim.')
      : null,
  ]);

  container.appendChild(backBar);
  container.appendChild(renderStepIndicator(4, 5));
  container.appendChild(el('div', { class: 'dmh-main' }, [
    el('h1', { class: 'dmh-heading' }, 'Review and start transactions'),
    el('p', { class: 'dmh-subheading' }, `Verify this queue for ${net.chainName}. Transactions start only after you select “Start transactions,” and each wallet request waits for the previous transaction to confirm.`),
    reviewCard,
    queueStatus,
    listEl,
  ]));
  container.appendChild(renderStickyCta(actionBtn));
}
