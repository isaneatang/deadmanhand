// lib/hashing.js
//
// Client-side-only secret hashing. Per Master Build Prompt Section 7 / UI
// Addendum v2 Section 7: the plaintext secret must NEVER touch a network
// request, transaction payload, event log, console log, or
// localStorage/sessionStorage. It is hashed here, in-memory, immediately on
// submit, and the plaintext is discarded by the caller right after.
//
// Hash scheme (must exactly match DeadMansHand.sol):
//   secretHash = keccak256(abi.encodePacked(secretPlaintext, ownerAddress, vaultId))
// which is Solidity's packed encoding of (string, address, bytes32). We
// reproduce that exact byte layout client-side using ethers' keccak256 +
// solidityPacked (no new dependency — ethers is already the pinned wallet
// library used elsewhere in this stack, per the dependency-hygiene rule).
//
// We deliberately do NOT use the browser's native crypto.subtle.digest here:
// crypto.subtle only exposes SHA-256/SHA-384/SHA-512, not keccak256, and the
// on-chain contract's secretHash comparison is keccak256-based to match
// Solidity's native hash. Using a different hash function client-side would
// simply never match the contract. ethers.keccak256 is the correct choice
// and is already an established dependency (see lib/ethers.js).

import { ethers } from './ethers.js';

/**
 * Compute the exact on-chain secretHash for a candidate secret.
 * @param {string} secretPlaintext - raw secret, never persisted anywhere.
 * @param {string} ownerAddress - checksummed EOA address of the vault owner.
 * @param {string} vaultId - bytes32 hex string (0x + 64 hex chars).
 * @returns {string} bytes32 hex hash, ready to submit as secretHash / for
 *          local comparison in attemptUnlock's client-side call.
 */
export function computeSecretHash(secretPlaintext, ownerAddress, vaultId) {
  if (typeof secretPlaintext !== 'string' || secretPlaintext.length === 0) {
    throw new Error('secretPlaintext must be a non-empty string');
  }
  if (!ethers.isAddress(ownerAddress)) {
    throw new Error('ownerAddress is not a valid address');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(vaultId)) {
    throw new Error('vaultId must be a bytes32 hex string');
  }

  const checksummed = ethers.getAddress(ownerAddress);
  const packed = ethers.solidityPacked(['string', 'address', 'bytes32'], [secretPlaintext, checksummed, vaultId]);
  return ethers.keccak256(packed);
}

/**
 * Generate a fresh, random, opaque vaultId. Per Master Build Prompt Section
 * 4.1: vaultId must be owner-generated and random, NOT derived from the
 * owner's address, so it isn't guessable on its own.
 * @returns {string} bytes32 hex string.
 */
export function generateVaultId() {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return ethers.hexlify(randomBytes);
}

// ---------------------------------------------------------------------
// Entropy check (Master Build Prompt Section 4.1)
// ---------------------------------------------------------------------
//
// The on-chain secretHash is public forever and can be brute-forced offline
// at zero cost once someone knows/guesses the owner's address + vaultId
// (both are public). The flat unlock fee only deters ON-CHAIN guessing.
// Entropy is the only real defense against OFFLINE guessing, so this check
// is load-bearing security, not UX polish.

const COMMON_WORDS = [
  'password', 'letmein', 'qwerty', 'admin', 'welcome', 'monkey', 'dragon',
  'secret', 'iloveyou', 'trustno1', 'sunshine', 'master', 'football',
  'baseball', 'superman', 'batman', 'shadow', 'michael', 'jennifer',
  'starwars', 'princess', 'abc123', 'passw0rd', 'summer', 'winter',
  'autumn', 'spring', 'freedom', 'liberty', 'america', 'money', 'ninja',
];

const SEQUENTIAL_PATTERNS = ['123456', '654321', 'abcdef', 'qwertyuiop', 'aaaaaa', '000000', '111111'];

/**
 * Rough Shannon-entropy-style estimate in bits, using character-class pool
 * size as a proxy for per-character entropy (standard heuristic — not a
 * cryptographic guarantee, but good enough to reject genuinely weak input).
 */
function estimateEntropyBits(secret) {
  let poolSize = 0;
  if (/[a-z]/.test(secret)) poolSize += 26;
  if (/[A-Z]/.test(secret)) poolSize += 26;
  if (/[0-9]/.test(secret)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(secret)) poolSize += 33; // approx printable symbol/space pool
  if (poolSize === 0) return 0;

  const bitsPerChar = Math.log2(poolSize);
  return bitsPerChar * secret.length;
}

/**
 * Validate a candidate secret against the minimum-entropy bar.
 * @param {string} secret
 * @returns {{ ok: boolean, reasons: string[], entropyBits: number }}
 */
export function checkSecretEntropy(secret) {
  const reasons = [];
  const trimmed = secret ?? '';

  if (trimmed.length < 12) {
    reasons.push('Must be at least 12 characters long.');
  }

  const lower = trimmed.toLowerCase();
  for (const word of COMMON_WORDS) {
    if (lower.includes(word)) {
      reasons.push(`Contains a common dictionary word ("${word}") — too easy to guess offline.`);
      break;
    }
  }

  for (const pattern of SEQUENTIAL_PATTERNS) {
    if (lower.includes(pattern)) {
      reasons.push('Contains an obvious sequential/repeated pattern.');
      break;
    }
  }

  // Reject secrets that are almost entirely one repeated character/emoji.
  const uniqueChars = new Set(trimmed).size;
  if (trimmed.length > 0 && uniqueChars <= 2 && trimmed.length >= 4) {
    reasons.push('Too repetitive — needs more distinct characters.');
  }

  const entropyBits = estimateEntropyBits(trimmed);
  const MIN_ENTROPY_BITS = 60; // roughly comparable to a random 10-char mixed-case+digit+symbol string
  if (entropyBits < MIN_ENTROPY_BITS) {
    reasons.push(
      `Estimated entropy too low (${entropyBits.toFixed(0)} bits, need ≥${MIN_ENTROPY_BITS}). Mix character types and use more length.`
    );
  }

  return { ok: reasons.length === 0, reasons, entropyBits };
}
