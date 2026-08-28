// flows/ClaimantFlow/Step2Status.js — Step 2: Status view (not-yet-expired countdown, or expired + claim entry)
import { el, renderBackBar, renderStepIndicator, renderStickyCta, formatDuration, formatAddress } from '../../components/theme/ui.js';

export function renderStep2Status(container, state, onNext, onBack) {
  const s = state.status;
  const isClaimable = s.expired && s.active;

  const body = [];

  body.push(
    el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-card-title' }, 'Vault'),
      el('div', { class: 'mono', style: 'font-size:13px; color: var(--dmh-text-secondary);' }, `Owner: ${formatAddress(state.ownerAddress)}`),
      el('div', { class: 'mono', style: 'font-size:12px; color: var(--dmh-text-muted); word-break: break-all;' }, `Vault ID: ${state.vaultId}`),
    ])
  );

  if (!s.active) {
    body.push(
      el('div', { class: 'dmh-warning-banner danger' }, 'This vault was deactivated by its owner and can never be claimed.')
    );
  } else if (s.locked) {
    body.push(
      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-badge dmh-badge-danger' }, 'Locked — cooldown active'),
        el('p', { class: 'dmh-hint' }, `Too many failed attempts recently. Try again in ${formatDuration(s.cooldownRemaining)}.`),
      ])
    );
  } else if (!s.expired) {
    body.push(
      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-badge dmh-badge-warning' }, 'Not yet claimable'),
        el('div', { class: 'dmh-countdown' }, formatDuration(s.timeRemaining)),
        el('p', { class: 'dmh-hint' }, 'This vault becomes claimable once the owner has been inactive for their chosen period. Check back later.'),
      ])
    );
  } else {
    body.push(
      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-badge dmh-badge-success' }, '✓ Claimable'),
        el('p', { class: 'dmh-hint' }, 'The inactivity period has elapsed. If you know the secret, you can attempt to claim now. A fee applies whether the secret matches or not.'),
      ])
    );
  }

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(2, 4));
  container.appendChild(el('div', { class: 'dmh-main' }, body));

  if (isClaimable) {
    const claimBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Enter secret to claim →');
    claimBtn.addEventListener('click', onNext);
    container.appendChild(renderStickyCta(claimBtn));
  }
}
