// flows/OwnerSetup/Step5Live.js — Step 5: Vault live confirmation, hand off to Dashboard
import { el, renderStepIndicator, renderCopyableValue, renderStickyCta } from '../../components/theme/ui.js';
import { navigate } from '../../app.js';

export function renderStep5Live(container, state) {
  container.appendChild(renderStepIndicator(5, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('div', { style: 'text-align:center; padding: 12px 0;' }, [
        el('div', { style: 'font-size: 48px;' }, '✅'),
        el('h1', { class: 'dmh-heading' }, 'Vault is live'),
        el('p', { class: 'dmh-subheading' }, "Your assets stay in your own wallet. If you don't check in before the inactivity period elapses, whoever knows your secret can claim what you've protected."),
      ]),

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, 'Vault ID'),
        el('p', { class: 'dmh-hint' }, 'This is not secret — it\'s a lookup key. You can share it, but the real security comes from your secret phrase, which you should NEVER paste into a copy field.'),
        renderCopyableValue(state.vaultId, 'Vault ID'),
      ]),

      el('div', { class: 'dmh-warning-banner' }, "Remember to come back and check in (\"ping\") before your inactivity period runs out — there is no other reminder in this version."),
    ])
  );
  const goBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Go to dashboard →');
  goBtn.addEventListener('click', () => navigate(`dashboard/${state.vaultId}`));
  container.appendChild(renderStickyCta(goBtn));
}
