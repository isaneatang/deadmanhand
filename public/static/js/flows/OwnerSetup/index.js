// flows/OwnerSetup/index.js — wires together the 5-step owner setup wizard.
import { createSetupState } from './state.js';
import { renderStep1Connect } from './Step1Connect.js';
import { renderStep2Secret } from './Step2Secret.js';
import { renderStep3Assets } from './Step3Assets.js';
import { renderStep4Approve } from './Step4Approve.js';
import { renderStep5Live } from './Step5Live.js';
import { navigate } from '../../app.js';

export function renderOwnerSetup(container) {
  const state = createSetupState();

  function goToStep(step) {
    state.step = step;
    container.innerHTML = '';
    switch (step) {
      case 1:
        renderStep1Connect(container, state, () => goToStep(2));
        break;
      case 2:
        renderStep2Secret(container, state, () => goToStep(3), () => goToStep(1));
        break;
      case 3:
        renderStep3Assets(container, state, () => goToStep(4), () => goToStep(2));
        break;
      case 4:
        renderStep4Approve(container, state, () => goToStep(5), () => goToStep(3));
        break;
      case 5:
        renderStep5Live(container, state);
        break;
      default:
        navigate('');
    }
  }

  goToStep(1);
}
