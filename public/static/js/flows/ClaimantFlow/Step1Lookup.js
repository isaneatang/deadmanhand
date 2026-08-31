// flows/ClaimantFlow/Step1Lookup.js — Step 1: Lookup — address field primary, vaultId secondary/advanced
import { el, renderStepIndicator, renderStickyCta, formatDuration } from '../../components/theme/ui.js';
import { ethers } from '../../lib/ethers.js';
import { lookupVaultsByAddress, getVaultOwner, getVaultStatus, getVaultMetadata } from '../../lib/contract.js';
import { DmhNotDeployedError } from '../../lib/contract.js';

export function renderStep1Lookup(container, state, onFound) {
  const formId = 'claimant-vault-lookup-form';
  const addressInput = el('input', { id: 'claimant-owner-address', class: 'dmh-input mono', type: 'text', placeholder: '0x… former owner address', autocapitalize: 'off', spellcheck: 'false' });
  const vaultIdInput = el('input', { id: 'claimant-vault-id', class: 'dmh-input mono', type: 'text', placeholder: '0x… vault ID (64 hex chars)', autocapitalize: 'off', spellcheck: 'false' });
  const errorEl = el('div', { class: 'dmh-error-text', role: 'alert', 'aria-live': 'assertive' });
  const choicesEl = el('div', { 'aria-live': 'polite' });

  let advancedOpen = false;
  const advancedToggle = el('button', { class: 'dmh-btn dmh-btn-secondary', type: 'button', style: 'margin-top: 4px;', 'aria-expanded': 'false', 'aria-controls': 'claimant-vault-id-section' }, 'Use vault ID instead (advanced)');
  const advancedSection = el('div', { id: 'claimant-vault-id-section', class: 'dmh-field', style: 'display:none;' }, [
    el('label', { class: 'dmh-label', for: 'claimant-vault-id' }, 'Vault ID (exact lookup)'),
    vaultIdInput,
    el('div', { class: 'dmh-hint' }, 'Use this if an address maps to multiple vaults, or if address lookup found nothing.'),
  ]);
  advancedToggle.addEventListener('click', () => {
    advancedOpen = !advancedOpen;
    advancedSection.style.display = advancedOpen ? 'flex' : 'none';
    advancedToggle.setAttribute('aria-expanded', String(advancedOpen));
    advancedToggle.textContent = advancedOpen ? 'Hide vault ID lookup' : 'Use vault ID instead (advanced)';
    if (advancedOpen) vaultIdInput.focus();
  });

  const searchBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'submit', form: formId }, 'Look up →');

  async function submitLookup(event) {
    event.preventDefault();
    errorEl.textContent = '';
    choicesEl.replaceChildren();
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching…';
    try {
      const vaultIdRaw = advancedOpen ? vaultIdInput.value.trim() : '';
      const addressRaw = addressInput.value.trim();

      if (vaultIdRaw) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(vaultIdRaw)) {
          throw new Error('Vault ID must be a 0x-prefixed 64-hex-character value.');
        }
        const owner = await getVaultOwner(vaultIdRaw);
        if (!owner || owner === ethers.ZeroAddress) {
          throw new Error('No vault found with that ID.');
        }
        const status = await getVaultStatus(vaultIdRaw);
        state.vault = await getVaultMetadata(vaultIdRaw);
        state.vaultId = vaultIdRaw;
        state.ownerAddress = owner;
        state.status = status;
        onFound();
        return;
      }

      if (!addressRaw) {
        throw new Error('Enter an address or a vault ID.');
      }
      if (!ethers.isAddress(addressRaw)) {
        throw new Error('Not a valid address.');
      }
      const checksummed = ethers.getAddress(addressRaw);
      const vaults = await lookupVaultsByAddress(checksummed);
      if (vaults.length === 0) {
        throw new Error('No vaults found for this address. Try the exact vault ID instead if you have it.');
      }
      if (vaults.length === 1) {
        state.vaultId = vaults[0].vaultId;
        state.ownerAddress = checksummed;
        state.status = vaults[0];
        state.vault = await getVaultMetadata(vaults[0].vaultId);
        onFound();
        return;
      }

      const choiceButtons = vaults.map((vault, index) => {
         let statusText = 'Claimable';
         if (vault.claimed) statusText = 'Already claimed';
         else if (!vault.active) statusText = 'Deactivated';
         else if (!vault.expired) statusText = `Available in ${formatDuration(vault.timeRemaining)}`;

        const button = el('button', {
          class: 'dmh-card',
          type: 'button',
          style: 'width:100%; text-align:left; cursor:pointer;',
          'aria-label': `Select vault ${index + 1} of ${vaults.length}. ${statusText}`,
        }, [
          el('div', { class: 'dmh-card-title' }, `Vault ${index + 1}: ${statusText}`),
          el('div', { class: 'mono', style: 'font-size:12px; color: var(--dmh-text-muted); word-break:break-all;' }, vault.vaultId),
        ]);
         button.addEventListener('click', async () => {
           state.vaultId = vault.vaultId;
           state.ownerAddress = checksummed;
           state.status = vault;
           state.vault = await getVaultMetadata(vault.vaultId);
           onFound();
         });
        return button;
      });
      choicesEl.appendChild(el('div', { class: 'dmh-field', role: 'group', 'aria-labelledby': 'claimant-vault-choices-title' }, [
        el('h2', { id: 'claimant-vault-choices-title', class: 'dmh-card-title' }, `${vaults.length} vaults found. Choose the exact vault:`),
        ...choiceButtons,
      ]));
    } catch (e) {
      if (e instanceof DmhNotDeployedError) {
        errorEl.textContent = e.message;
      } else {
        errorEl.textContent = e.message || 'Lookup failed.';
      }
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Look up →';
    }
  }

  const form = el('form', { id: formId });
  form.addEventListener('submit', submitLookup);
  form.appendChild(el('div', { class: 'dmh-main' }, [
    el('h1', { class: 'dmh-heading' }, 'Find a vault'),
    el('p', { class: 'dmh-subheading' }, "Enter the former owner's wallet address to check if a vault is claimable."),
    el('div', { class: 'dmh-field' }, [
      el('label', { class: 'dmh-label', for: 'claimant-owner-address' }, "Owner's address"),
      addressInput,
    ]),
    advancedToggle,
    advancedSection,
    errorEl,
    choicesEl,
  ]));

  container.appendChild(renderStepIndicator(1, 4));
  container.appendChild(form);
  container.appendChild(renderStickyCta(searchBtn));
}
