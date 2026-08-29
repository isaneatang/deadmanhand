// flows/ClaimantFlow/index.js — wires together the 4-step claimant flow.
import { createClaimState } from './state.js';
import { renderStep1Lookup } from './Step1Lookup.js';
import { renderStep2Status } from './Step2Status.js';
import { renderStep3SecretEntry } from './Step3SecretEntry.js';
import { renderStep4Result } from './Step4Result.js';

export function renderClaimantFlow(container) {
  const state = createClaimState();
  let cleanupCurrentStep = null;

  function goToStep(step) {
    if (cleanupCurrentStep) cleanupCurrentStep();
    cleanupCurrentStep = null;
    state.step = step;
    container.innerHTML = '';
    switch (step) {
      case 1:
        renderStep1Lookup(container, state, () => goToStep(2));
        break;
      case 2:
        cleanupCurrentStep = renderStep2Status(container, state, () => goToStep(3), () => goToStep(1));
        break;
      case 3:
        renderStep3SecretEntry(container, state, () => goToStep(4), () => goToStep(2));
        break;
      case 4:
        renderStep4Result(container, state);
        break;
      default:
        goToStep(1);
    }
  }

  goToStep(1);
}
