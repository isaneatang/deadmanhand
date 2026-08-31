// lib/ethers.js
//
// Single pinned import point for ethers.js. The browser import map in the
// server-rendered shell resolves this package name to the pinned browser ESM
// build, while Node tests resolve it from the local dependency.
//
// Every other module imports ethers from HERE (never a second, separately
// pinned copy elsewhere) so there is exactly one version loaded, in one
// place, auditable in one line.
export { ethers } from 'ethers';
