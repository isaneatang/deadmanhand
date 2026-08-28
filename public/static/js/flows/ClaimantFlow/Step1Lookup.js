// flows/ClaimantFlow/Step1Lookup.js — Step 1: Lookup — address field primary, vaultId secondary/advanced
import { el, renderStepIndicator, renderStickyCta, showToast } from '../../components/theme/ui.js';
import { ethers } from '../../lib/ethers.js';
import { lookupVaultsByAddress, getVaultOwner, getVaultStatus } from '../../lib/contract.js';
import { DmhNotDeployedError } from '../../lib/contract.js';

export function renderStep1Lookup(container, state, onFound) {
  const addressInput = el('input', { class: 'dmh-input mono', type: 'text', placeholder: '0x… former owner address', autocapitalize: 'off', spellcheck: 'false' });
  const vaultIdInput = el('input', { class: 'dmh-input mono', type: 'text', placeholder: '0x… vault ID (64 hex chars)', autocapitalize: 'off', spellcheck: 'false' });
  const errorEl = el('div', { class: 'dmh-error-text' });

  let advancedOpen = false;
  const advancedToggle = el('button', { class: 'dmh-btn dmh-btn-secondary', style: 'margin-top: 4px;' }, 'Use vault ID instead (advanced)');
  const advancedSection = el('div', { class: 'dmh-field', style: 'display:none;' }, [
    el('label', { class: 'dmh-label' }, 'Vault ID (exact lookup)'),
    vaultIdInput,
    el('div', { class: 'dmh-hint' }, 'Use this if an address maps to multiple vaults, or if address lookup found nothing.'),
  ]);
  advancedToggle.addEventListener('click', () => {
    advancedOpen = !advancedOpen;
    advancedSection.style.display = advancedOpen ? 'flex' : 'none';
    advancedToggle.textContent = advancedOpen ? 'Hide vault ID lookup' : 'Use vault ID instead (advanced)';
  });

  const searchBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Look up →');

  searchBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching…';
    try {
      const vaultIdRaw = vaultIdInput.value.trim();
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
      // If exactly one, go straight to status. If multiple, let the user
      // pick via a bottom-sheet-style list (kept simple: pick the first
      // that is expired/claimable, else the first overall).
      const claimable = vaults.find((v) => v.expired && v.active) || vaults[0];
      state.vaultId = claimable.vaultId;
      state.ownerAddress = checksummed;
      state.status = claimable;
      onFound(vaults.length > 1 ? vaults : null);
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
  });

  container.appendChild(renderStepIndicator(1, 4));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('h1', { class: 'dmh-heading' }, 'Find a vault'),
      el('p', { class: 'dmh-subheading' }, "Enter the former owner's wallet address to check if a vault is claimable."),

      el('div', { class: 'dmh-field' }, [
        el('label', { class: 'dmh-label' }, "Owner's address"),
        addressInput,
      ]),

      advancedToggle,
      advancedSection,
      errorEl,
    ])
  );
  container.appendChild(renderStickyCta(searchBtn));
}
