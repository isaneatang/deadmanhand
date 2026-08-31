// lib/ethers.js
//
// Single pinned import point for ethers.js. The package is bundled locally so
// phrase derivation and signing never depend on third-party runtime scripts.
//
// Every other module imports ethers from HERE (never a second, separately
// pinned copy elsewhere) so there is exactly one version loaded, in one
// place, auditable in one line.
export { ethers } from 'ethers';
