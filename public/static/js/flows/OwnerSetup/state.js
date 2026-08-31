// flows/OwnerSetup/state.js — shared wizard state for the 5-step owner setup flow.
export function createSetupState() {
  return {
    step: 1,
    address: null,
    vaultId: null,
    authorizationSigner: null,
    kdfSalt: null,
    kdfVersion: 1,
    derivationChainId: null,
    derivationContractAddress: null,
    derivationOwnerAddress: null,
    inactivityPeriodSeconds: 180 * 24 * 60 * 60, // default 6 months
    selectedAssets: [], // [{address, symbol, decimals, type}]
    approvalResults: [], // [{asset, status: 'pending'|'success'|'error', error}]
  };
}
