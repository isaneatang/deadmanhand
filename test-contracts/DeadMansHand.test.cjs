const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

// Deploy defaults matching the suggested values in Master Prompt Section 11
// (open product questions — these are the suggested defaults, confirm final
// numbers with product before mainnet deploy).
const BASE_FEE = ethers.parseUnits('1', 6); // 1 USDT @ 6 decimals
const FAILURE_THRESHOLD = 5;
const COOLDOWN_DURATION = 24 * 60 * 60; // 24h
const MAX_ESCALATION_DOUBLINGS = 4; // cap growth at 16x base fee
const INACTIVITY_PERIOD = 30 * 24 * 60 * 60; // 30 days, within min/max bounds

function computeVaultId(seedString) {
  return ethers.keccak256(ethers.toUtf8Bytes(seedString));
}

function computeSecretHash(secretPlaintext, ownerAddress, vaultId) {
  return ethers.keccak256(
    ethers.solidityPacked(['string', 'address', 'bytes32'], [secretPlaintext, ownerAddress, vaultId])
  );
}

async function deployFixture() {
  const [deployer, owner, claimant, other] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const usdt = await MockERC20.deploy('Tether USD', 'USDT', 6);
  await usdt.waitForDeployment();

  const DeadMansHand = await ethers.getContractFactory('DeadMansHand');
  const dmh = await DeadMansHand.deploy(
    await usdt.getAddress(),
    BASE_FEE,
    FAILURE_THRESHOLD,
    COOLDOWN_DURATION,
    MAX_ESCALATION_DOUBLINGS
  );
  await dmh.waitForDeployment();

  // Fund claimant with plenty of USDT for many fee-escalated attempts, and
  // approve the DMH contract to pull fees.
  await usdt.mint(claimant.address, ethers.parseUnits('1000000', 6));
  await usdt.connect(claimant).approve(await dmh.getAddress(), ethers.MaxUint256);

  await usdt.mint(other.address, ethers.parseUnits('1000000', 6));
  await usdt.connect(other).approve(await dmh.getAddress(), ethers.MaxUint256);

  return { deployer, owner, claimant, other, usdt, dmh };
}

describe('DeadMansHand', function () {
  describe('createVault', function () {
    it('creates a vault with correct fields and emits VaultCreated', async function () {
      const { owner, dmh } = await deployFixture();
      const vaultId = computeVaultId('vault-1');
      const secretHash = computeSecretHash('correct horse battery staple 42!', owner.address, vaultId);

      await expect(dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD))
        .to.emit(dmh, 'VaultCreated')
        .withArgs(vaultId, owner.address, INACTIVITY_PERIOD);

      const vaultIds = await dmh.getOwnerVaults(owner.address);
      expect(vaultIds).to.deep.equal([vaultId]);
    });

    it('reverts on duplicate vaultId', async function () {
      const { owner, dmh } = await deployFixture();
      const vaultId = computeVaultId('dup');
      const secretHash = computeSecretHash('secret-one', owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      await expect(
        dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD)
      ).to.be.revertedWithCustomError(dmh, 'VaultAlreadyExists');
    });

    it('rejects inactivity period outside allowed bounds', async function () {
      const { owner, dmh } = await deployFixture();
      const vaultId = computeVaultId('bounds');
      const secretHash = computeSecretHash('x', owner.address, vaultId);

      await expect(
        dmh.connect(owner).createVault(vaultId, secretHash, 0)
      ).to.be.revertedWithCustomError(dmh, 'InvalidInactivityPeriod');

      await expect(
        dmh.connect(owner).createVault(vaultId, secretHash, 100 * 365 * 24 * 60 * 60)
      ).to.be.revertedWithCustomError(dmh, 'InvalidInactivityPeriod');
    });
  });

  describe('addToken / ping / deactivateVault access control', function () {
    it('only the vault owner can add tokens, ping, or deactivate', async function () {
      const { owner, other, dmh, usdt } = await deployFixture();
      const vaultId = computeVaultId('access');
      const secretHash = computeSecretHash('s', owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      await expect(
        dmh.connect(other).addToken(vaultId, await usdt.getAddress(), false)
      ).to.be.revertedWithCustomError(dmh, 'NotVaultOwner');

      await expect(dmh.connect(other).ping(vaultId)).to.be.revertedWithCustomError(dmh, 'NotVaultOwner');

      await expect(dmh.connect(other).deactivateVault(vaultId)).to.be.revertedWithCustomError(
        dmh,
        'NotVaultOwner'
      );

      // Owner succeeds
      await expect(dmh.connect(owner).addToken(vaultId, await usdt.getAddress(), false)).to.emit(
        dmh,
        'TokenAdded'
      );
      await expect(dmh.connect(owner).ping(vaultId)).to.emit(dmh, 'Pinged');
    });

    it('rejects duplicate token registration and enforces MAX_TOKENS_PER_VAULT', async function () {
      const { owner, dmh, usdt } = await deployFixture();
      const vaultId = computeVaultId('dup-token');
      const secretHash = computeSecretHash('s', owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      await dmh.connect(owner).addToken(vaultId, await usdt.getAddress(), false);
      await expect(
        dmh.connect(owner).addToken(vaultId, await usdt.getAddress(), false)
      ).to.be.revertedWithCustomError(dmh, 'TokenAlreadyRegistered');
    });

    it('deactivateVault gates only owner-admin, not the secret; deactivated vault cannot be claimed', async function () {
      const { owner, claimant, dmh, usdt } = await deployFixture();
      const secret = 'super-entropy-secret-999!!';
      const vaultId = computeVaultId('deactivate');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await dmh.connect(owner).deactivateVault(vaultId);

      await time.increase(INACTIVITY_PERIOD + 1);

      await expect(
        dmh.connect(claimant).attemptUnlock(vaultId, secret)
      ).to.be.revertedWithCustomError(dmh, 'VaultInactive');
    });
  });

  describe('getStatus', function () {
    it('reports not expired before inactivity period elapses, expired after', async function () {
      const { owner, dmh } = await deployFixture();
      const vaultId = computeVaultId('status');
      const secretHash = computeSecretHash('s', owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      let status = await dmh.getStatus(vaultId);
      expect(status.expired).to.equal(false);
      expect(status.timeRemaining).to.be.closeTo(BigInt(INACTIVITY_PERIOD), 5n);

      await time.increase(INACTIVITY_PERIOD + 1);
      status = await dmh.getStatus(vaultId);
      expect(status.expired).to.equal(true);
      expect(status.timeRemaining).to.equal(0n);
    });

    it('ping resets the inactivity clock', async function () {
      const { owner, dmh } = await deployFixture();
      const vaultId = computeVaultId('ping-reset');
      const secretHash = computeSecretHash('s', owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      await time.increase(INACTIVITY_PERIOD - 100);
      await dmh.connect(owner).ping(vaultId);

      const status = await dmh.getStatus(vaultId);
      expect(status.expired).to.equal(false);
      expect(status.timeRemaining).to.be.closeTo(BigInt(INACTIVITY_PERIOD), 5n);
    });
  });

  describe('attemptUnlock — expiry gating', function () {
    it('reverts NotExpiredYet if attempted before the inactivity deadline', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('too-early');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      await expect(
        dmh.connect(claimant).attemptUnlock(vaultId, secret)
      ).to.be.revertedWithCustomError(dmh, 'NotExpiredYet');
    });
  });

  describe('attemptUnlock — fee collection', function () {
    it('charges the base fee on the first attempt regardless of match/mismatch', async function () {
      const { owner, claimant, dmh, usdt } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('fee-mismatch');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await time.increase(INACTIVITY_PERIOD + 1);

      const balBefore = await usdt.balanceOf(claimant.address);
      await dmh.connect(claimant).attemptUnlock(vaultId, 'wrong-guess');
      const balAfter = await usdt.balanceOf(claimant.address);

      expect(balBefore - balAfter).to.equal(BASE_FEE);
    });

    it('reverts FeeTransferFailed if claimant has insufficient allowance', async function () {
      const { owner, claimant, dmh, usdt } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('fee-fail');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await time.increase(INACTIVITY_PERIOD + 1);

      // Revoke claimant's allowance.
      await usdt.connect(claimant).approve(await dmh.getAddress(), 0);

      await expect(dmh.connect(claimant).attemptUnlock(vaultId, 'wrong-guess')).to.be.reverted;
    });
  });

  describe('attemptUnlock — mismatch / lockout / fee escalation (core security logic)', function () {
    it('increments failedAttempts on each mismatch and never touches secretHash', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('mismatch-count');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await time.increase(INACTIVITY_PERIOD + 1);

      expect(await dmh.getFailedAttempts(vaultId)).to.equal(0);
      await dmh.connect(claimant).attemptUnlock(vaultId, 'nope-1');
      expect(await dmh.getFailedAttempts(vaultId)).to.equal(1);
      await dmh.connect(claimant).attemptUnlock(vaultId, 'nope-2');
      expect(await dmh.getFailedAttempts(vaultId)).to.equal(2);
    });

    it('escalates the fee by doubling on each successive mismatch up to the cap', async function () {
      const { owner, claimant, dmh, usdt } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('fee-escalation');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await time.increase(INACTIVITY_PERIOD + 1);

      // previewFee should read 1x, 2x, 4x, 8x, 16x (cap at 2^MAX_ESCALATION_DOUBLINGS=4)
      const expectedMultipliers = [1, 2, 4, 8, 16];
      for (let i = 0; i < expectedMultipliers.length; i++) {
        const expectedFee = BASE_FEE * BigInt(expectedMultipliers[i]);
        expect(await dmh.previewFee(vaultId)).to.equal(expectedFee);

        const balBefore = await usdt.balanceOf(claimant.address);
        await dmh.connect(claimant).attemptUnlock(vaultId, `wrong-${i}`);
        const balAfter = await usdt.balanceOf(claimant.address);
        expect(balBefore - balAfter).to.equal(expectedFee);
      }

      // Vault should now be locked (5 failures reached threshold); the fee
      // stays capped at 16x for any further preview even though this call
      // itself will revert once locked.
      expect(await dmh.previewFee(vaultId)).to.equal(BASE_FEE * 16n);
    });

    it('enters cooldown exactly at failureThreshold and rejects further attempts until it elapses', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('cooldown');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await time.increase(INACTIVITY_PERIOD + 1);

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await dmh.connect(claimant).attemptUnlock(vaultId, `wrong-${i}`);
      }

      let status = await dmh.getStatus(vaultId);
      expect(status.locked).to.equal(true);
      expect(status.cooldownRemaining).to.be.closeTo(BigInt(COOLDOWN_DURATION), 5n);

      // Any further attempt during cooldown reverts with VaultLockedError,
      // and crucially does NOT consume/charge a fee.
      await expect(dmh.connect(claimant).attemptUnlock(vaultId, secret)).to.be.revertedWithCustomError(
        dmh,
        'VaultLockedError'
      );

      // Fast-forward past cooldown — attempts should work again and the
      // failure counter + fee multiplier reset.
      await time.increase(COOLDOWN_DURATION + 1);
      status = await dmh.getStatus(vaultId);
      expect(status.locked).to.equal(false);

      expect(await dmh.previewFee(vaultId)).to.equal(BASE_FEE); // back to 1x
    });

    it('NEVER permanently locks a vault — cooldown always eventually expires (no DoS vector)', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('no-permalock');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await time.increase(INACTIVITY_PERIOD + 1);

      // Trigger several lockout cycles in a row with wrong guesses.
      for (let cycle = 0; cycle < 3; cycle++) {
        for (let i = 0; i < FAILURE_THRESHOLD; i++) {
          await dmh.connect(claimant).attemptUnlock(vaultId, `wrong-cycle${cycle}-${i}`);
        }
        let status = await dmh.getStatus(vaultId);
        expect(status.locked).to.equal(true);
        await time.increase(COOLDOWN_DURATION + 1);
        status = await dmh.getStatus(vaultId);
        expect(status.locked).to.equal(false);
      }

      // The legitimate claimant can still succeed with the correct secret
      // after all that — proving no permanent lock is possible.
      const success = await dmh.connect(claimant).attemptUnlock(vaultId, secret);
      await expect(success).to.emit(dmh, 'UnlockAttempted').withArgs(vaultId, claimant.address, true);
    });

    it('a successful unlock resets failedAttempts and any cooldown', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('reset-on-success');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);
      await time.increase(INACTIVITY_PERIOD + 1);

      await dmh.connect(claimant).attemptUnlock(vaultId, 'wrong-1');
      await dmh.connect(claimant).attemptUnlock(vaultId, 'wrong-2');
      expect(await dmh.getFailedAttempts(vaultId)).to.equal(2);

      await dmh.connect(claimant).attemptUnlock(vaultId, secret);
      expect(await dmh.getFailedAttempts(vaultId)).to.equal(0);
      expect(await dmh.previewFee(vaultId)).to.equal(BASE_FEE);
    });
  });

  describe('attemptUnlock — skip-and-continue partial claim (core security logic)', function () {
    it('sweeps a normal ERC20 to the claimant on match', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('sweep-erc20');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const rewardToken = await MockERC20.deploy('Reward', 'RWD', 18);
      await rewardToken.waitForDeployment();
      await rewardToken.mint(owner.address, ethers.parseEther('500'));
      await rewardToken.connect(owner).approve(await dmh.getAddress(), ethers.MaxUint256);
      await dmh.connect(owner).addToken(vaultId, await rewardToken.getAddress(), false);

      await time.increase(INACTIVITY_PERIOD + 1);
      await dmh.connect(claimant).attemptUnlock(vaultId, secret);

      expect(await rewardToken.balanceOf(claimant.address)).to.equal(ethers.parseEther('500'));
      expect(await rewardToken.balanceOf(owner.address)).to.equal(0);
    });

    it('skips a token with a stale/failing approval and still sweeps the rest — one failure does not revert the claim', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('skip-and-continue');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const goodToken = await MockERC20.deploy('Good', 'GOOD', 18);
      await goodToken.waitForDeployment();
      await goodToken.mint(owner.address, ethers.parseEther('100'));
      await goodToken.connect(owner).approve(await dmh.getAddress(), ethers.MaxUint256);

      const MockFailingERC20 = await ethers.getContractFactory('MockFailingERC20');
      const failToken = await MockFailingERC20.deploy();
      await failToken.waitForDeployment();
      await failToken.mint(owner.address, ethers.parseEther('999'));
      await failToken.connect(owner).approve(await dmh.getAddress(), ethers.MaxUint256);
      await failToken.setShouldFail(true); // simulate stale approval: owner moved funds elsewhere

      // Register the failing token FIRST to prove it doesn't block the good one after it.
      await dmh.connect(owner).addToken(vaultId, await failToken.getAddress(), false);
      await dmh.connect(owner).addToken(vaultId, await goodToken.getAddress(), false);

      await time.increase(INACTIVITY_PERIOD + 1);

      const tx = await dmh.connect(claimant).attemptUnlock(vaultId, secret);
      await expect(tx).to.emit(dmh, 'TokenTransferFailed');
      await expect(tx).to.emit(dmh, 'TokenTransferSucceeded');

      // The claim as a whole succeeded (not reverted) and the good token
      // was fully transferred despite the earlier failure.
      expect(await goodToken.balanceOf(claimant.address)).to.equal(ethers.parseEther('100'));
      expect(await failToken.balanceOf(owner.address)).to.equal(ethers.parseEther('999')); // untouched
    });

    it('skips a zero-allowance token registration cleanly (owner approved then revoked)', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('zero-allowance');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const token = await MockERC20.deploy('Revoked', 'REV', 18);
      await token.waitForDeployment();
      await token.mint(owner.address, ethers.parseEther('10'));
      // Never approved (or revoked) — allowance is 0.
      await dmh.connect(owner).addToken(vaultId, await token.getAddress(), false);

      await time.increase(INACTIVITY_PERIOD + 1);
      const tx = await dmh.connect(claimant).attemptUnlock(vaultId, secret);
      await expect(tx).to.emit(dmh, 'TokenTransferFailed');
      await expect(tx).to.emit(dmh, 'UnlockAttempted').withArgs(vaultId, claimant.address, true);
    });

    it('sweeps a full ERC721Enumerable collection to the claimant', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('sweep-nft');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      const MockERC721 = await ethers.getContractFactory('MockERC721');
      const nft = await MockERC721.deploy('Collection', 'COL');
      await nft.waitForDeployment();
      const id0 = await nft.mint.staticCall(owner.address);
      await nft.mint(owner.address);
      await nft.mint(owner.address);
      await nft.mint(owner.address);
      await nft.connect(owner).setApprovalForAll(await dmh.getAddress(), true);
      await dmh.connect(owner).addToken(vaultId, await nft.getAddress(), true);

      await time.increase(INACTIVITY_PERIOD + 1);
      await dmh.connect(claimant).attemptUnlock(vaultId, secret);

      expect(await nft.balanceOf(owner.address)).to.equal(0);
      expect(await nft.balanceOf(claimant.address)).to.equal(3);
    });

    it('skips a non-enumerable NFT collection gracefully instead of reverting the whole claim', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('non-enumerable');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      const MockERC721NonEnumerable = await ethers.getContractFactory('MockERC721NonEnumerable');
      const nft = await MockERC721NonEnumerable.deploy('NonEnum', 'NE');
      await nft.waitForDeployment();
      await nft.mint(owner.address);
      await nft.connect(owner).setApprovalForAll(await dmh.getAddress(), true);
      await dmh.connect(owner).addToken(vaultId, await nft.getAddress(), true);

      // Also register a normal ERC20 to prove the rest of the sweep still runs.
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const goodToken = await MockERC20.deploy('Good2', 'GOOD2', 18);
      await goodToken.waitForDeployment();
      await goodToken.mint(owner.address, ethers.parseEther('7'));
      await goodToken.connect(owner).approve(await dmh.getAddress(), ethers.MaxUint256);
      await dmh.connect(owner).addToken(vaultId, await goodToken.getAddress(), false);

      await time.increase(INACTIVITY_PERIOD + 1);
      const tx = await dmh.connect(claimant).attemptUnlock(vaultId, secret);
      await expect(tx).to.emit(dmh, 'TokenTransferFailed');

      expect(await goodToken.balanceOf(claimant.address)).to.equal(ethers.parseEther('7'));
      expect(await nft.balanceOf(owner.address)).to.equal(1); // untouched, still with owner
    });

    it('mismatch never sweeps any tokens', async function () {
      const { owner, claimant, dmh } = await deployFixture();
      const secret = 'entropy-secret-abcdEFGH123';
      const vaultId = computeVaultId('mismatch-no-sweep');
      const secretHash = computeSecretHash(secret, owner.address, vaultId);
      await dmh.connect(owner).createVault(vaultId, secretHash, INACTIVITY_PERIOD);

      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const token = await MockERC20.deploy('Safe', 'SAFE', 18);
      await token.waitForDeployment();
      await token.mint(owner.address, ethers.parseEther('42'));
      await token.connect(owner).approve(await dmh.getAddress(), ethers.MaxUint256);
      await dmh.connect(owner).addToken(vaultId, await token.getAddress(), false);

      await time.increase(INACTIVITY_PERIOD + 1);
      await dmh.connect(claimant).attemptUnlock(vaultId, 'totally-wrong-secret');

      expect(await token.balanceOf(owner.address)).to.equal(ethers.parseEther('42'));
      expect(await token.balanceOf(claimant.address)).to.equal(0);
    });
  });

  describe('hash scheme — salting behavior', function () {
    it('the same plaintext secret produces different hashes for different owners/vaultIds (no cross-vault dictionary reuse)', async function () {
      const { owner, other } = await deployFixture();
      const vaultIdA = computeVaultId('vaultA');
      const vaultIdB = computeVaultId('vaultB');
      const secret = 'shared-plaintext-guess';

      const hashOwnerA = computeSecretHash(secret, owner.address, vaultIdA);
      const hashOwnerB_sameVault = computeSecretHash(secret, other.address, vaultIdA);
      const hashOwnerA_diffVault = computeSecretHash(secret, owner.address, vaultIdB);

      expect(hashOwnerA).to.not.equal(hashOwnerB_sameVault);
      expect(hashOwnerA).to.not.equal(hashOwnerA_diffVault);
    });
  });
});
