// Deploys DeadMansHand to the network specified via --network (botTestnet |
// botMainnet). Requires DEPLOYER_PRIVATE_KEY env var set.
//
// The fee token, fixed base fee, and recipient are deployment configuration.
const hre = require('hardhat');

async function main() {
  const network = hre.network.name;
  console.log(`Deploying DeadMansHand to ${network}...`);

  const feeTokenAddress = process.env.FEE_TOKEN_ADDRESS;
  if (!feeTokenAddress) {
    throw new Error(
      'FEE_TOKEN_ADDRESS env var is required (the USDT contract address on this network). ' +
      'Testnet USDT is UNVERIFIED — do not fabricate an address, confirm one first (see config/network.js comments).'
    );
  }

  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  if (!feeRecipient) {
    throw new Error(
      'FEE_RECIPIENT_ADDRESS env var is required (the address that will receive every collected unlock fee). ' +
      'Do not fabricate this — it must be an address the product owner explicitly confirmed.'
    );
  }

  const baseFee = process.env.BASE_FEE;
  if (!baseFee || !/^\d+$/.test(baseFee) || BigInt(baseFee) === 0n) {
    throw new Error('BASE_FEE is required and must be a positive integer in the fee token\'s smallest unit.');
  }

  if (!hre.ethers.isAddress(feeTokenAddress) || feeTokenAddress === hre.ethers.ZeroAddress) {
    throw new Error('FEE_TOKEN_ADDRESS must be a valid nonzero address.');
  }
  if (!hre.ethers.isAddress(feeRecipient) || feeRecipient === hre.ethers.ZeroAddress) {
    throw new Error('FEE_RECIPIENT_ADDRESS must be a valid nonzero address.');
  }

  const feeTokenCode = await hre.ethers.provider.getCode(feeTokenAddress);
  if (feeTokenCode === '0x') throw new Error('FEE_TOKEN_ADDRESS has no contract code on this network.');

  const feeToken = new hre.ethers.Contract(
    feeTokenAddress,
    ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
    hre.ethers.provider
  );
  const [symbol, decimals, chain] = await Promise.all([
    feeToken.symbol(),
    feeToken.decimals(),
    hre.ethers.provider.getNetwork(),
  ]);

  console.log('Chain ID:', chain.chainId.toString());
  console.log('Fee token:', feeTokenAddress, symbol, `(${decimals} decimals)`);
  console.log('Base fee:', baseFee);
  console.log('Fee recipient:', feeRecipient);
  console.log('Protocol: EIP-712 DeadMansHand v2, KDF version 1');

  const DeadMansHand = await hre.ethers.getContractFactory('DeadMansHand');
  const dmh = await DeadMansHand.deploy(
    feeTokenAddress,
    baseFee,
    feeRecipient
  );
  await dmh.waitForDeployment();
  const address = await dmh.getAddress();

  const [deployedFeeToken, deployedBaseFee, deployedRecipient] = await Promise.all([
    dmh.feeToken(),
    dmh.baseFee(),
    dmh.feeRecipient(),
  ]);
  if (
    deployedFeeToken.toLowerCase() !== feeTokenAddress.toLowerCase()
    || deployedBaseFee !== BigInt(baseFee)
    || deployedRecipient.toLowerCase() !== feeRecipient.toLowerCase()
  ) {
    throw new Error('Post-deployment immutable verification failed. Do not publish this address.');
  }

  console.log('DeadMansHand deployed to:', address);
  console.log('Now paste this address into public/static/js/config/network.js as dmhContractAddress for', network);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
