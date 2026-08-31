import { ethers } from './ethers.js';

const ITERATIONS = 600000;
const KDF_VERSION = 1;
const PREFIX = new TextEncoder().encode('DMH phrase key v1\0');
const SECP256K1_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

function bytes(value) { return new TextEncoder().encode(value); }

function utf8Phrase(phrase) {
  if (typeof phrase !== 'string') throw new Error('Secret phrase must be text.');
  for (let i = 0; i < phrase.length; i++) {
    const c = phrase.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= phrase.length || phrase.charCodeAt(i + 1) < 0xdc00 || phrase.charCodeAt(i + 1) > 0xdfff) throw new Error('Secret phrase contains an unpaired surrogate.');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('Secret phrase contains an unpaired surrogate.');
  }
  const normalized = phrase.normalize('NFC');
  const encoded = bytes(normalized);
  if (encoded.length > 1024) throw new Error('Secret phrase must be at most 1024 UTF-8 bytes.');
  if (encoded.length === 0) throw new Error('Secret phrase must not be empty.');
  return { normalized, encoded };
}

function uintBE(value, size) {
  let n = BigInt(value);
  const out = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  if (n !== 0n) throw new Error('Integer does not fit the requested encoding.');
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function addressBytes(address) { return ethers.getBytes(ethers.getAddress(address)); }

export function generateVaultId() { return ethers.hexlify(crypto.getRandomValues(new Uint8Array(32))); }
export function generateKdfSalt() { return ethers.hexlify(crypto.getRandomValues(new Uint8Array(32))); }
export function generateRecoverySecret() {
  const hex = ethers.hexlify(crypto.getRandomValues(new Uint8Array(32))).slice(2);
  return hex.match(/.{1,8}/g).join('-');
}

export async function deriveAuthorizationKey(phrase, { chainId, contractAddress, ownerAddress, vaultId, kdfSalt, counter = 0 }) {
  const { encoded } = utf8Phrase(phrase);
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) throw new Error('Invalid derivation counter.');
  const salt = concat(PREFIX, uintBE(chainId, 32), addressBytes(contractAddress), addressBytes(ownerAddress), ethers.getBytes(vaultId), ethers.getBytes(kdfSalt), uintBE(counter, 4));
  try {
    const baseKey = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, baseKey, 256);
    const privateKey = new Uint8Array(bits);
    const scalar = BigInt(`0x${ethers.hexlify(privateKey).slice(2)}`);
    if (scalar === 0n || scalar >= SECP256K1_ORDER) {
      privateKey.fill(0);
      return null;
    }
    const wallet = new ethers.Wallet(ethers.hexlify(privateKey));
    return { privateKey, address: wallet.address, counter, kdfVersion: KDF_VERSION };
  } finally {
    encoded.fill(0);
    salt.fill(0);
  }
}

export async function deriveAuthorizationSigner(phrase, context) {
  for (let counter = 0; counter <= 0xffffffff; counter++) {
    const result = await deriveAuthorizationKey(phrase, { ...context, counter });
    if (result) return result;
  }
  throw new Error('Could not derive a valid secp256k1 key.');
}

export async function signClaimWithKey(key, claim, domain) {
  try {
    const signature = await new ethers.Wallet(key.privateKey).signTypedData(domain, {
      Claim: [
        { name: 'vaultId', type: 'bytes32' }, { name: 'recipient', type: 'address' },
        { name: 'feePayer', type: 'address' }, { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }, { name: 'maxFee', type: 'uint256' },
      ],
    }, claim);
    return { signature, signer: key.address, counter: key.counter, kdfVersion: key.kdfVersion };
  } finally { key.privateKey.fill(0); }
}

export async function signClaim(phrase, context, claim, domain) {
  return signClaimWithKey(await deriveAuthorizationSigner(phrase, context), claim, domain);
}

const COMMON_WORDS = ['password','letmein','qwerty','admin','welcome','monkey','dragon','secret','iloveyou','trustno1','sunshine','master','football','baseball','superman','batman','shadow','michael','jennifer','starwars','princess','abc123','passw0rd','summer','winter','autumn','spring','freedom','liberty','america','money','ninja'];
const SEQUENTIAL_PATTERNS = ['123456','654321','abcdef','qwertyuiop','aaaaaa','000000','111111'];
export function checkSecretEntropy(secret) {
  const value = secret ?? '', reasons = [];
  if (value.length < 12) reasons.push('Must be at least 12 characters long.');
  const lower = value.toLowerCase();
  if (COMMON_WORDS.some((word) => lower.includes(word))) reasons.push('Contains a common dictionary word and is too easy to guess offline.');
  if (SEQUENTIAL_PATTERNS.some((pattern) => lower.includes(pattern))) reasons.push('Contains an obvious sequential or repeated pattern.');
  if (value && new Set(value).size <= 2 && value.length >= 4) reasons.push('Too repetitive: use more distinct characters.');
  let pool = 0; if (/[a-z]/.test(value)) pool += 26; if (/[A-Z]/.test(value)) pool += 26; if (/[0-9]/.test(value)) pool += 10; if (/[^a-zA-Z0-9]/.test(value)) pool += 33;
  const entropyBits = pool ? Math.log2(pool) * value.length : 0;
  if (entropyBits < 60) reasons.push(`Estimated entropy too low (${entropyBits.toFixed(0)} bits, need 60).`);
  return { ok: reasons.length === 0, reasons, entropyBits };
}
