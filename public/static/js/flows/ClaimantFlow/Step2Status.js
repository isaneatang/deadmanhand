// flows/ClaimantFlow/Step2Status.js — Step 2: Status view (not-yet-expired countdown, or expired + claim entry)
import { el, renderBackBar, renderStepIndicator, renderStickyCta, formatDuration, formatAddress } from '../../components/theme/ui.js';
import { getVaultStatus } from '../../lib/contract.js';

export function renderStep2Status(container, state, onNext, onBack) {
  const body = [];

  body.push(
    el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-card-title' }, 'Vault'),
      el('div', { class: 'mono', style: 'font-size:13px; color: var(--dmh-text-secondary);' }, `Owner: ${formatAddress(state.ownerAddress)}`),
      el('div', { class: 'mono', style: 'font-size:12px; color: var(--dmh-text-muted); word-break: break-all;' }, `Vault ID: ${state.vaultId}`),
    ])
  );

  const statusRegion = el('div');
  const actionRegion = el('div');
  body.push(statusRegion);

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(2, 4));
  container.appendChild(el('div', { class: 'dmh-main' }, body));
  container.appendChild(actionRegion);

  let disposed = false;
  let transitionTimer = null;
  let deadline = 0;
  let deadlineKind = null;

  async function refreshStatus() {
    if (!container.isConnected) {
      cleanup();
      return;
    }
    try {
      const status = await getVaultStatus(state.vaultId);
      if (disposed) return;
      state.status = status;
      renderStatus(status);
    } catch (error) {
      if (!disposed) {
        const retryBtn = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button', onClick: refreshStatus }, 'Retry status check');
        statusRegion.replaceChildren(el('div', { class: 'dmh-card' }, [
          el('div', { class: 'dmh-error-text', role: 'alert' }, `Could not refresh status: ${error.message}`),
          retryBtn,
        ]));
      }
    }
  }

  function renderStatus(status) {
    if (transitionTimer) clearInterval(transitionTimer);
    transitionTimer = null;
    actionRegion.replaceChildren();

    if (!status.active) {
      statusRegion.replaceChildren(el('div', { class: 'dmh-warning-banner danger' }, 'This vault was deactivated by its owner and can never be claimed.'));
      return;
    }

    if (status.locked || !status.expired) {
      const isCooldown = status.locked;
      const seconds = Number(isCooldown ? status.cooldownRemaining : status.timeRemaining);
      deadline = Date.now() + Math.max(0, seconds) * 1000;
      deadlineKind = isCooldown ? 'cooldown' : 'expiry';
      const countdown = el('div', { class: 'dmh-countdown', role: 'timer' });
      statusRegion.replaceChildren(el('div', { class: 'dmh-card' }, [
        el('div', { class: `dmh-badge ${isCooldown ? 'dmh-badge-danger' : 'dmh-badge-warning'}` }, isCooldown ? 'Locked: cooldown active' : 'Not yet claimable'),
        countdown,
        el('p', { class: 'dmh-hint' }, isCooldown
          ? 'Too many failed attempts recently. Claiming is disabled until the cooldown ends.'
          : 'This vault becomes claimable once the inactivity period ends.'),
      ]));

      const tick = () => {
        if (!container.isConnected) {
          cleanup();
          return;
        }
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        countdown.textContent = formatDuration(remaining);
        countdown.setAttribute('aria-label', `${deadlineKind === 'cooldown' ? 'Cooldown' : 'Claim availability'} remaining: ${formatDuration(remaining)}`);
        if (remaining === 0) {
          clearInterval(transitionTimer);
          countdown.textContent = 'Refreshing status…';
          transitionTimer = setTimeout(refreshStatus, 1000);
        }
      };
      tick();
      if (deadline > Date.now()) transitionTimer = setInterval(tick, 1000);
      return;
    }

    statusRegion.replaceChildren(el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-badge dmh-badge-success' }, 'Claimable'),
      el('p', { class: 'dmh-hint' }, 'The inactivity period has elapsed. If you know the secret, you can attempt to claim now. A fee applies whether the secret matches or not.'),
    ]));
    const claimBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'button' }, 'Enter secret to claim →');
    claimBtn.addEventListener('click', async () => {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Checking status…';
      try {
        const latest = await getVaultStatus(state.vaultId);
        if (disposed) return;
        state.status = latest;
        if (latest.active && latest.expired && !latest.locked) onNext();
        else renderStatus(latest);
      } catch (error) {
        if (!disposed) {
          statusRegion.replaceChildren(el('div', { class: 'dmh-error-text', role: 'alert' }, `Could not confirm claim status: ${error.message}`));
          claimBtn.disabled = false;
          claimBtn.textContent = 'Retry status check';
        }
      }
    });
    actionRegion.appendChild(renderStickyCta(claimBtn));
  }

  renderStatus(state.status);
  function cleanup() {
    disposed = true;
    if (transitionTimer) clearInterval(transitionTimer);
  }
  return cleanup;
}
