import { strict as assert } from 'node:assert';
import test from 'node:test';

const { deriveAuthorizationSigner } = await import('../public/static/js/lib/hashing.js');

const CONTEXT = {
  chainId: 31337,
  contractAddress: '0x1111111111111111111111111111111111111111',
  ownerAddress: '0x2222222222222222222222222222222222222222',
  vaultId: `0x${'33'.repeat(32)}`,
  kdfSalt: `0x${'44'.repeat(32)}`,
};

test('KDF v1 has a stable vector and applies NFC', { timeout: 120000 }, async () => {
  const composed = await deriveAuthorizationSigner('caf\u00e9 recovery phrase 2026!', CONTEXT);
  const decomposed = await deriveAuthorizationSigner('cafe\u0301 recovery phrase 2026!', CONTEXT);
  try {
    assert.equal(composed.address, decomposed.address);
    assert.equal(composed.address, '0x989ff2b8F120Cc0De5a6d0a90f865Abada9B906b');
  } finally {
    composed.privateKey.fill(0);
    decomposed.privateKey.fill(0);
  }
});

test('KDF v1 separates every public context field', { timeout: 180000 }, async () => {
  const baseline = await deriveAuthorizationSigner('domain separation recovery phrase 2026!', CONTEXT);
  const variants = [
    { ...CONTEXT, chainId: 31338 },
    { ...CONTEXT, contractAddress: '0x1111111111111111111111111111111111111112' },
    { ...CONTEXT, ownerAddress: '0x2222222222222222222222222222222222222223' },
    { ...CONTEXT, vaultId: `0x${'34'.repeat(32)}` },
    { ...CONTEXT, kdfSalt: `0x${'45'.repeat(32)}` },
  ];
  try {
    for (const context of variants) {
      const derived = await deriveAuthorizationSigner('domain separation recovery phrase 2026!', context);
      try { assert.notEqual(derived.address, baseline.address); }
      finally { derived.privateKey.fill(0); }
    }
  } finally {
    baseline.privateKey.fill(0);
  }
});

test('KDF v1 rejects malformed Unicode and oversized phrases', async () => {
  await assert.rejects(() => deriveAuthorizationSigner('\ud800', CONTEXT), /unpaired surrogate/);
  await assert.rejects(() => deriveAuthorizationSigner('a'.repeat(1025), CONTEXT), /at most 1024/);
});
