// flows/ClaimantFlow/state.js — shared state for the claimant flow.
export function createClaimState() {
  return {
    step: 1,
    lookupAddress: null,
    vaultId: null, // resolved from address, or entered directly via advanced lookup
    ownerAddress: null, // needed client-side to recompute the secret hash
    status: null, // {expired, timeRemaining, active, locked, cooldownRemaining}
    claimantAddress: null,
    result: null, // {matched, succeeded, failed, feePaid}
  };
}
