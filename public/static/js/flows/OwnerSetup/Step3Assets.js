// flows/OwnerSetup/Step3Assets.js — Step 3: Scan & select assets to protect
import { el, renderBackBar, renderStepIndicator, renderStickyCta } from '../../components/theme/ui.js';
import { renderAssetPanel } from '../../components/AssetPanel/AssetPanel.js';

export function renderStep3Assets(container, state, onNext, onBack) {
  const panel = renderAssetPanel({
    address: state.address,
    selectable: true,
    onSelectionChange: (assets) => {
      state.selectedAssets = assets;
      continueBtn.textContent = assets.length > 0 ? `Continue with ${assets.length} asset${assets.length === 1 ? '' : 's'} →` : 'Skip — protect nothing yet';
    },
  });

  const continueBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Skip — protect nothing yet');
  continueBtn.addEventListener('click', () => onNext());

  container.appendChild(renderBackBar(onBack));
  container.appendChild(renderStepIndicator(3, 5));
  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('h1', { class: 'dmh-heading' }, 'Choose what to protect'),
      el('p', { class: 'dmh-subheading' }, 'Toggle on the tokens/NFT collections you want Dead Man\'s Hand to be able to recover on your behalf. You can always add more later — no new secret needed.'),
      panel.node,
    ])
  );
  container.appendChild(renderStickyCta(continueBtn));
}
