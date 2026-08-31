// flows/ClaimantFlow/state.js — shared state for the claimant flow.
export function createClaimState() {
  return {
    step: 1,
    lookupAddress: null,
    vaultId: null, // resolved from address, or entered directly via advanced lookup
    ownerAddress: null,
    vault: null,
    status: null,
    feePayerAddress: null,
    result: null,
  };
}
