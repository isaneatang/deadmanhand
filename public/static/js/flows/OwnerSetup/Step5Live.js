// flows/OwnerSetup/Step5Live.js — Step 5: Vault live confirmation, hand off to Dashboard
import { el, renderStepIndicator, renderCopyableValue, renderStickyCta, formatDuration } from '../../components/theme/ui.js';
import { navigate } from '../../app.js';

export function renderStep5Live(container, state) {
  container.appendChild(renderStepIndicator(5, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('div', { style: 'text-align:center; padding: 12px 0;' }, [
        el('div', { class: 'dmh-badge dmh-badge-success', role: 'status' }, 'Setup complete'),
        el('h1', { class: 'dmh-heading' }, 'Vault is live'),
        el('p', { class: 'dmh-subheading' }, "Your assets stay in your own wallet. If you don't check in before the inactivity period elapses, whoever knows your secret can claim what you've protected."),
      ]),

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, 'Vault ID'),
        el('p', { class: 'dmh-hint' }, 'This is not secret — it\'s a lookup key. You can share it, but the real security comes from your secret phrase, which you should NEVER paste into a copy field.'),
        renderCopyableValue(state.vaultId, 'Vault ID'),
      ]),

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, 'Secure handoff checklist'),
        el('p', { class: 'dmh-hint' }, 'Before relying on this vault:'),
        el('ul', {}, [
          el('li', {}, 'Give the intended recipient the exact secret through a secure channel; do not include it in the same message or document as the Vault ID.'),
          el('li', {}, 'Give them the public Vault ID and instructions for finding the claim page separately.'),
          el('li', {}, 'Ask them to verify that they can locate the vault without entering or exposing the secret.'),
          el('li', {}, 'Warn them that submitting a claim reveals the secret publicly on-chain. They should submit it only when ready to claim, and the secret must not be reused anywhere else.'),
          el('li', {}, 'Keep your own offline backup and tell a trusted person where to find the handoff instructions.'),
        ]),
      ]),
      el('div', { class: 'dmh-warning-banner' }, `Check in before the ${formatDuration(state.inactivityPeriodSeconds)} inactivity period expires. This app does not send reminders. Add a recurring calendar reminder well before the deadline, with a second backup reminder, and update both after changing the inactivity period.`),
    ])
  );
  const goBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Go to dashboard →');
  goBtn.addEventListener('click', () => navigate(`dashboard/${state.vaultId}`));
  container.appendChild(renderStickyCta(goBtn));
}
