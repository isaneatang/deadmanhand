// lib/ethers.js
//
// Single pinned import point for ethers.js. Per Security section (both
// Master Build Prompt Section 7 and UI Addendum v2 Section 7): only use
// packages already established in prior BOT Chain builds (ethers.js is
// explicitly named), pin an exact version, and only import from well-known
// CDNs (jsDelivr, esm.sh, unpkg).
//
// Every other module imports ethers from HERE (never a second, separately
// pinned copy elsewhere) so there is exactly one version loaded, in one
// place, auditable in one line.
export { ethers } from 'https://esm.sh/ethers@6.13.4';
