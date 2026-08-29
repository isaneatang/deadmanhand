// flows/OwnerSetup/Step3Assets.js — Step 3: Scan & select assets to protect
import { el, renderBackBar, renderStepIndicator, renderStickyCta } from '../../components/theme/ui.js';
import { renderAssetPanel } from '../../components/AssetPanel/AssetPanel.js';

export function renderStep3Assets(container, state, onNext, onBack) {
  const selectionStatus = el('p', { class: 'dmh-hint', id: 'owner-asset-selection-status', role: 'status', 'aria-live': 'polite' }, 'No assets selected.');
  const panel = renderAssetPanel({
    address: state.address,
    selectable: true,
    onSelectionChange: (assets) => {
      state.selectedAssets = assets;
      selectionStatus.textContent = assets.length > 0 ? `${assets.length} asset${assets.length === 1 ? '' : 's'} selected.` : 'No assets selected.';
      continueBtn.textContent = assets.length > 0 ? `Continue with ${assets.length} asset${assets.length === 1 ? '' : 's'} →` : 'Skip — protect nothing yet';
    },
  });

  const continueBtn = el('button', { class: 'dmh-btn dmh-btn-primary', type: 'button', 'aria-describedby': 'owner-asset-selection-status' }, 'Skip — protect nothing yet');
  continueBtn.addEventListener('click', () => onNext());

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(3, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('h1', { class: 'dmh-heading' }, 'Choose what to protect'),
      el('p', { class: 'dmh-subheading' }, 'Select ERC-20 tokens or supported ERC-721 NFT collections. You can add more later without creating a new secret.'),
      el('div', { class: 'dmh-warning-banner' }, 'Native BOT is not supported for vault protection. A vault supports up to 50 registered token or collection contracts. NFT recovery requires ERC721Enumerable and transfers at most 20 NFTs from each registered collection per claim; non-enumerable ERC-721 collections cannot be recovered by this contract.'),
      selectionStatus,
      panel.node,
    ])
  );
  container.appendChild(renderStickyCta(continueBtn));
}
