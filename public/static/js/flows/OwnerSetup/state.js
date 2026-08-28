// flows/OwnerSetup/state.js — shared wizard state for the 5-step owner setup flow.
export function createSetupState() {
  return {
    step: 1,
    address: null,
    vaultId: null,
    secretHash: null, // computed client-side, plaintext never stored here
    inactivityPeriodSeconds: 180 * 24 * 60 * 60, // default 6 months
    selectedAssets: [], // [{address, symbol, decimals, type}]
    approvalResults: [], // [{asset, status: 'pending'|'success'|'error', error}]
  };
}
