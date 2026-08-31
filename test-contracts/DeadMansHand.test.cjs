const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

const BASE_FEE = ethers.parseUnits('1', 6);
const INACTIVITY_PERIOD = 60;
const KDF_VERSION = 1;
const SALT = ethers.keccak256(ethers.toUtf8Bytes('memory-hard-kdf-salt'));
const CLAIM_TYPES = {
  Claim: [
    { name: 'vaultId', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'feePayer', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
  ],
};

function vaultId(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function deployFixture() {
  const [deployer, owner, authorizationSigner, claimant, recipient, other, feeRecipient] =
    await ethers.getSigners();
  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const feeToken = await MockERC20.deploy('Fee USD', 'FUSD', 6);
  const DeadMansHand = await ethers.getContractFactory('DeadMansHand');
  const dmh = await DeadMansHand.deploy(await feeToken.getAddress(), BASE_FEE, feeRecipient.address);

  for (const payer of [claimant, other]) {
    await feeToken.mint(payer.address, BASE_FEE * 100n);
    await feeToken.connect(payer).approve(await dmh.getAddress(), ethers.MaxUint256);
  }

  return {
    deployer,
    owner,
    authorizationSigner,
    claimant,
    recipient,
    other,
    feeRecipient,
    feeToken,
    dmh,
  };
}

async function createVault(ctx, id = vaultId('default'), signer = ctx.authorizationSigner) {
  await ctx.dmh
    .connect(ctx.owner)
    .createVault(id, signer.address, SALT, KDF_VERSION, INACTIVITY_PERIOD);
  return id;
}

async function makeClaim(ctx, overrides = {}, contract = ctx.dmh) {
  const now = await time.latest();
  const authorization = {
    vaultId: overrides.vaultId ?? vaultId('default'),
    recipient: overrides.recipient ?? ctx.recipient.address,
    feePayer: overrides.feePayer ?? ctx.claimant.address,
    nonce: overrides.nonce ?? 0,
    deadline: overrides.deadline ?? now + 3600,
    maxFee: overrides.maxFee ?? BASE_FEE,
  };
  const network = await ethers.provider.getNetwork();
  const domain = {
    name: 'DeadMansHand',
    version: '2',
    chainId: network.chainId,
    verifyingContract: await contract.getAddress(),
  };
  const signature = await ctx.authorizationSigner.signTypedData(domain, CLAIM_TYPES, authorization);
  return { authorization, signature };
}

async function expire() {
  await time.increase(INACTIVITY_PERIOD + 1);
}

describe('DeadMansHand v2', function () {
  describe('creation and owner controls', function () {
    it('stores all v2 vault fields and indexes the owner', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = vaultId('fields');

      await expect(
        ctx.dmh
          .connect(ctx.owner)
          .createVault(id, ctx.authorizationSigner.address, SALT, KDF_VERSION, INACTIVITY_PERIOD)
      )
        .to.emit(ctx.dmh, 'VaultCreated')
        .withArgs(
          id,
          ctx.owner.address,
          ctx.authorizationSigner.address,
          SALT,
          KDF_VERSION,
          INACTIVITY_PERIOD
        );

      const stored = await ctx.dmh.vaults(id);
      expect(stored.owner).to.equal(ctx.owner.address);
      expect(stored.authorizationSigner).to.equal(ctx.authorizationSigner.address);
      expect(stored.kdfSalt).to.equal(SALT);
      expect(stored.kdfVersion).to.equal(KDF_VERSION);
      expect(stored.inactivityPeriod).to.equal(INACTIVITY_PERIOD);
      expect(stored.active).to.equal(true);
      expect(stored.claimed).to.equal(false);
      expect(stored.exists).to.equal(true);
      expect(stored.claimNonce).to.equal(0);
      expect(await ctx.dmh.getOwnerVaults(ctx.owner.address)).to.deep.equal([id]);
      expect(await ctx.dmh.KDF_VERSION()).to.equal(1);
    });

    it('rejects duplicate IDs, zero signer/salt, unsupported KDF, and invalid periods', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = vaultId('validation');
      const create = (signer, salt, version, period) =>
        ctx.dmh.connect(ctx.owner).createVault(id, signer, salt, version, period);
      const simulateCreate = (signer, salt, version, period) =>
        ctx.dmh.connect(ctx.owner).createVault.staticCall(id, signer, salt, version, period);

      await expect(simulateCreate(ethers.ZeroAddress, SALT, 1, 60)).to.be.revertedWithCustomError(
        ctx.dmh,
        'InvalidAuthorizationSigner'
      );
      await expect(simulateCreate(ctx.authorizationSigner.address, ethers.ZeroHash, 1, 60)).to.be.revertedWithCustomError(
        ctx.dmh,
        'InvalidKdfSalt'
      );
      await expect(simulateCreate(ctx.authorizationSigner.address, SALT, 2, 60)).to.be.revertedWithCustomError(
        ctx.dmh,
        'UnsupportedKdfVersion'
      );
      await expect(simulateCreate(ctx.authorizationSigner.address, SALT, 1, 59)).to.be.revertedWithCustomError(
        ctx.dmh,
        'InvalidInactivityPeriod'
      );
      await expect(simulateCreate(ctx.authorizationSigner.address, SALT, 1, 10 * 365 * 86400 + 1)).to.be.revertedWithCustomError(
        ctx.dmh,
        'InvalidInactivityPeriod'
      );
      await create(ctx.authorizationSigner.address, SALT, 1, 60);
      await expect(simulateCreate(ctx.authorizationSigner.address, SALT, 1, 60)).to.be.revertedWithCustomError(
        ctx.dmh,
        'VaultAlreadyExists'
      );
    });

    it('restricts administration to the owner and makes deactivation one-way', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);

      await expect(ctx.dmh.connect(ctx.other).ping.staticCall(id)).to.be.revertedWithCustomError(ctx.dmh, 'NotVaultOwner');
      await expect(
        ctx.dmh.connect(ctx.other).addToken.staticCall(id, await ctx.feeToken.getAddress(), false)
      ).to.be.revertedWithCustomError(ctx.dmh, 'NotVaultOwner');
      await expect(ctx.dmh.connect(ctx.other).deactivateVault.staticCall(id)).to.be.revertedWithCustomError(
        ctx.dmh,
        'NotVaultOwner'
      );

      await ctx.dmh.connect(ctx.owner).deactivateVault(id);
      await expect(ctx.dmh.connect(ctx.owner).ping.staticCall(id)).to.be.revertedWithCustomError(ctx.dmh, 'VaultInactive');
      await expect(
        ctx.dmh.connect(ctx.owner).addToken.staticCall(id, await ctx.feeToken.getAddress(), false)
      ).to.be.revertedWithCustomError(ctx.dmh, 'VaultInactive');
      await expect(ctx.dmh.connect(ctx.owner).deactivateVault.staticCall(id)).to.be.revertedWithCustomError(
        ctx.dmh,
        'VaultInactive'
      );
    });

    it('resets expiry on ping and keeps compatible unlocked status fields', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      await time.increase(50);
      await ctx.dmh.connect(ctx.owner).ping(id);

      let status = await ctx.dmh.getStatus(id);
      expect(status.expired).to.equal(false);
      expect(status.timeRemaining).to.be.closeTo(60n, 2n);
      expect(status.active).to.equal(true);
      expect(status.locked).to.equal(false);
      expect(status.cooldownRemaining).to.equal(0);
      expect(await ctx.dmh.previewFee(id)).to.equal(BASE_FEE);

      await expire();
      status = await ctx.dmh.getStatus(id);
      expect(status.expired).to.equal(true);
      expect(status.timeRemaining).to.equal(0);
    });
  });

  describe('EIP-712 authorization', function () {
    it('claims an expired vault, charges the distinct fee payer, and pays the signed recipient', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const asset = await MockERC20.deploy('Asset', 'AST', 18);
      await asset.mint(ctx.owner.address, 123n);
      await asset.connect(ctx.owner).approve(await ctx.dmh.getAddress(), 123n);
      await ctx.dmh.connect(ctx.owner).addToken(id, await asset.getAddress(), false);
      await expire();
      const signed = await makeClaim(ctx);

      const payerBefore = await ctx.feeToken.balanceOf(ctx.claimant.address);
      await (await ctx.dmh.connect(ctx.claimant).claim(signed.authorization, signed.signature)).wait();

      expect(await ctx.feeToken.balanceOf(ctx.claimant.address)).to.equal(payerBefore - BASE_FEE);
      expect(await ctx.feeToken.balanceOf(ctx.feeRecipient.address)).to.equal(BASE_FEE);
      expect(await asset.balanceOf(ctx.recipient.address)).to.equal(123);
      expect(await asset.balanceOf(ctx.claimant.address)).to.equal(0);
      const stored = await ctx.dmh.vaults(id);
      expect(stored.active).to.equal(false);
      expect(stored.claimed).to.equal(true);
      expect(stored.claimNonce).to.equal(1);
    });

    it('rejects pre-expiry claims without charging a fee', async function () {
      const ctx = await loadFixture(deployFixture);
      await createVault(ctx);
      const signed = await makeClaim(ctx);
      const before = await ctx.feeToken.balanceOf(ctx.claimant.address);
      await expect(ctx.dmh.connect(ctx.claimant).claim.staticCall(signed.authorization, signed.signature)).to.be.revertedWithCustomError(
        ctx.dmh,
        'NotExpiredYet'
      );
      expect(await ctx.feeToken.balanceOf(ctx.claimant.address)).to.equal(before);
    });

    it('binds recipient, fee payer, nonce, deadline, and max fee before charging', async function () {
      const ctx = await loadFixture(deployFixture);
      await createVault(ctx);
      await expire();
      const valid = await makeClaim(ctx);
      const payerBefore = await ctx.feeToken.balanceOf(ctx.claimant.address);

      await expect(
        ctx.dmh.connect(ctx.other).claim.staticCall(valid.authorization, valid.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidFeePayer');
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall({ ...valid.authorization, recipient: ethers.ZeroAddress }, valid.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidRecipient');
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall({ ...valid.authorization, recipient: ctx.other.address }, valid.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidSignature');
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall({ ...valid.authorization, nonce: 1 }, valid.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidNonce');

      const expiredAuth = await makeClaim(ctx, { deadline: (await time.latest()) - 1 });
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall(expiredAuth.authorization, expiredAuth.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'AuthorizationExpired');
      const cheapAuth = await makeClaim(ctx, { maxFee: BASE_FEE - 1n });
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall(cheapAuth.authorization, cheapAuth.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'FeeExceedsMaximum');

      const otherPayer = await makeClaim(ctx, { feePayer: ctx.other.address });
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall(otherPayer.authorization, otherPayer.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidFeePayer');
      expect(await ctx.feeToken.balanceOf(ctx.claimant.address)).to.equal(payerBefore);
    });

    it('prevents cross-vault and cross-contract replay', async function () {
      const ctx = await loadFixture(deployFixture);
      const idA = await createVault(ctx);
      const idB = vaultId('other-vault');
      await createVault(ctx, idB);
      await expire();
      const signedA = await makeClaim(ctx);

      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall({ ...signedA.authorization, vaultId: idB }, signedA.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidSignature');

      const DeadMansHand = await ethers.getContractFactory('DeadMansHand');
      const second = await DeadMansHand.deploy(
        await ctx.feeToken.getAddress(),
        BASE_FEE,
        ctx.feeRecipient.address
      );
      await second
        .connect(ctx.owner)
        .createVault(idA, ctx.authorizationSigner.address, SALT, 1, INACTIVITY_PERIOD);
      await ctx.feeToken.connect(ctx.claimant).approve(await second.getAddress(), BASE_FEE);
      await expire();
      await expect(
        second.connect(ctx.claimant).claim.staticCall(signedA.authorization, signedA.signature)
      ).to.be.revertedWithCustomError(second, 'InvalidSignature');
    });

    it('rejects malformed, wrong-signer, and high-s signatures without charging', async function () {
      const ctx = await loadFixture(deployFixture);
      await createVault(ctx);
      await expire();
      const valid = await makeClaim(ctx);
      const before = await ctx.feeToken.balanceOf(ctx.claimant.address);

      await expect(ctx.dmh.connect(ctx.claimant).claim.staticCall(valid.authorization, '0x1234')).to.be.revertedWithCustomError(
        ctx.dmh,
        'InvalidSignature'
      );
      const wrong = await makeClaim({ ...ctx, authorizationSigner: ctx.other });
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall(wrong.authorization, wrong.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidSignature');

      const parsed = ethers.Signature.from(valid.signature);
      const curveN = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
      const highS = ethers.concat([
        parsed.r,
        ethers.toBeHex(curveN - BigInt(parsed.s), 32),
        ethers.toBeHex(parsed.v === 27 ? 28 : 27, 1),
      ]);
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall(valid.authorization, highS)
      ).to.be.revertedWithCustomError(ctx.dmh, 'InvalidSignature');
      expect(await ctx.feeToken.balanceOf(ctx.claimant.address)).to.equal(before);
    });

    it('rejects replay and preserves one-time claimed state even with no assets', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      await expire();
      const signed = await makeClaim(ctx);
      await ctx.dmh.connect(ctx.claimant).claim(signed.authorization, signed.signature);

      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall(signed.authorization, signed.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'VaultInactive');
      await expect(ctx.dmh.previewFee(id)).to.be.revertedWithCustomError(ctx.dmh, 'VaultInactive');
      const stored = await ctx.dmh.vaults(id);
      expect(stored.claimed).to.equal(true);
      expect(stored.claimNonce).to.equal(1);
    });
  });

  describe('fees and skip-and-continue sweeping', function () {
    it('maps a false-returning fee transfer to FeeTransferFailed and rolls back consumption', async function () {
      const ctx = await loadFixture(deployFixture);
      const FalseToken = await ethers.getContractFactory('MockFalseERC20');
      const falseFee = await FalseToken.deploy();
      await falseFee.mint(ctx.claimant.address, BASE_FEE);
      await falseFee.connect(ctx.claimant).approve(ctx.claimant.address, BASE_FEE);
      const DeadMansHand = await ethers.getContractFactory('DeadMansHand');
      const dmh = await DeadMansHand.deploy(await falseFee.getAddress(), BASE_FEE, ctx.feeRecipient.address);
      const local = { ...ctx, dmh, feeToken: falseFee };
      await createVault(local);
      await expire();
      const signed = await makeClaim(local);

      await expect(dmh.connect(ctx.claimant).claim.staticCall(signed.authorization, signed.signature)).to.be.revertedWithCustomError(
        dmh,
        'FeeTransferFailed'
      );
      const stored = await dmh.vaults(vaultId('default'));
      expect(stored.active).to.equal(true);
      expect(stored.claimed).to.equal(false);
      expect(stored.claimNonce).to.equal(0);
    });

    it('logs failed ERC20s and continues to later assets while consuming the vault', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      const Failing = await ethers.getContractFactory('MockFailingERC20');
      const failing = await Failing.deploy();
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const good = await MockERC20.deploy('Good', 'GOOD', 18);
      await failing.mint(ctx.owner.address, 50n);
      await good.mint(ctx.owner.address, 75n);
      await failing.connect(ctx.owner).approve(await ctx.dmh.getAddress(), 50n);
      await good.connect(ctx.owner).approve(await ctx.dmh.getAddress(), 75n);
      await failing.setShouldFail(true);
      await ctx.dmh.connect(ctx.owner).addToken(id, await failing.getAddress(), false);
      await ctx.dmh.connect(ctx.owner).addToken(id, await good.getAddress(), false);
      await expire();
      const signed = await makeClaim(ctx);

      const tx = await ctx.dmh.connect(ctx.claimant).claim(signed.authorization, signed.signature);
      await tx.wait();
      expect(await failing.balanceOf(ctx.owner.address)).to.equal(50);
      expect(await good.balanceOf(ctx.recipient.address)).to.equal(75);
      expect((await ctx.dmh.vaults(id)).claimed).to.equal(true);
    });

    it('supports enumerable index-0 NFT sweeping and continues after a failed collection', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      const MockERC721 = await ethers.getContractFactory('MockERC721');
      const blocked = await MockERC721.deploy('Blocked', 'BLK');
      const good = await MockERC721.deploy('Good NFT', 'GNFT');
      await blocked.mint(ctx.owner.address);
      for (let i = 0; i < 3; i++) await good.mint(ctx.owner.address);
      await good.connect(ctx.owner).setApprovalForAll(await ctx.dmh.getAddress(), true);
      await ctx.dmh.connect(ctx.owner).addToken(id, await blocked.getAddress(), true);
      await ctx.dmh.connect(ctx.owner).addToken(id, await good.getAddress(), true);
      await expire();
      const signed = await makeClaim(ctx);

      const tx = await ctx.dmh.connect(ctx.claimant).claim(signed.authorization, signed.signature);
      await tx.wait();
      expect(await blocked.balanceOf(ctx.owner.address)).to.equal(1);
      expect(await good.balanceOf(ctx.owner.address)).to.equal(0);
      expect(await good.balanceOf(ctx.recipient.address)).to.equal(3);
    });

    it('logs and skips non-enumerable NFTs, then sweeps later ERC20s', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      const NonEnumerable = await ethers.getContractFactory('MockERC721NonEnumerable');
      const nft = await NonEnumerable.deploy('Plain NFT', 'PLAIN');
      const MockERC20 = await ethers.getContractFactory('MockERC20');
      const token = await MockERC20.deploy('Later', 'LATER', 18);
      await nft.mint(ctx.owner.address);
      await nft.connect(ctx.owner).setApprovalForAll(await ctx.dmh.getAddress(), true);
      await token.mint(ctx.owner.address, 10n);
      await token.connect(ctx.owner).approve(await ctx.dmh.getAddress(), 10n);
      await ctx.dmh.connect(ctx.owner).addToken(id, await nft.getAddress(), true);
      await ctx.dmh.connect(ctx.owner).addToken(id, await token.getAddress(), false);
      await expire();
      const signed = await makeClaim(ctx);

      const tx = await ctx.dmh.connect(ctx.claimant).claim(signed.authorization, signed.signature);
      await tx.wait();
      expect(await nft.balanceOf(ctx.owner.address)).to.equal(1);
      expect(await token.balanceOf(ctx.recipient.address)).to.equal(10);
    });

    it('moves only 20 NFTs, logs the cap, and cannot be replayed for leftovers', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      const MockERC721 = await ethers.getContractFactory('MockERC721');
      const nft = await MockERC721.deploy('Large', 'LARGE');
      for (let i = 0; i < 21; i++) await nft.mint(ctx.owner.address);
      await nft.connect(ctx.owner).setApprovalForAll(await ctx.dmh.getAddress(), true);
      await ctx.dmh.connect(ctx.owner).addToken(id, await nft.getAddress(), true);
      await expire();
      const signed = await makeClaim(ctx);

      const tx = await ctx.dmh.connect(ctx.claimant).claim(signed.authorization, signed.signature);
      await tx.wait();
      expect(await nft.balanceOf(ctx.recipient.address)).to.equal(20);
      expect(await nft.balanceOf(ctx.owner.address)).to.equal(1);
      await expect(
        ctx.dmh.connect(ctx.claimant).claim.staticCall(signed.authorization, signed.signature)
      ).to.be.revertedWithCustomError(ctx.dmh, 'VaultInactive');
    });

    it('sets effects before ERC721 callbacks and blocks reentrant claims', async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await createVault(ctx);
      const MockERC721 = await ethers.getContractFactory('MockERC721');
      const nft = await MockERC721.deploy('Callback', 'CALL');
      const Receiver = await ethers.getContractFactory('MockReentrantReceiver');
      const receiver = await Receiver.deploy();
      await nft.mint(ctx.owner.address);
      await nft.connect(ctx.owner).setApprovalForAll(await ctx.dmh.getAddress(), true);
      await ctx.dmh.connect(ctx.owner).addToken(id, await nft.getAddress(), true);
      await expire();

      const inner = await makeClaim(ctx, {
        recipient: await receiver.getAddress(),
        feePayer: await receiver.getAddress(),
      });
      await receiver.configure(
        await ctx.dmh.getAddress(),
        ctx.dmh.interface.encodeFunctionData('claim', [inner.authorization, inner.signature])
      );
      const outer = await makeClaim(ctx, { recipient: await receiver.getAddress() });
      await ctx.dmh.connect(ctx.claimant).claim(outer.authorization, outer.signature);

      expect(await receiver.attempted()).to.equal(true);
      expect(await receiver.succeeded()).to.equal(false);
      expect(await nft.balanceOf(await receiver.getAddress())).to.equal(1);
      const stored = await ctx.dmh.vaults(id);
      expect(stored.claimed).to.equal(true);
      expect(stored.claimNonce).to.equal(1);
    });
  });
});
