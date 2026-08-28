// Deploys DeadMansHand to the network specified via --network (botTestnet |
// botMainnet). Requires DEPLOYER_PRIVATE_KEY env var set.
//
// Fee-token / lockout parameters below are the SUGGESTED defaults from the
// Master Build Prompt (Section 11 marks the exact numbers as still an open
// product question) — override via env vars before a real deploy if the
// product owner has since confirmed different final numbers.
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

  const baseFee = process.env.BASE_FEE || '1000000'; // 1 USDT @ 6 decimals
  const failureThreshold = process.env.FAILURE_THRESHOLD || '5';
  const cooldownDuration = process.env.COOLDOWN_DURATION || String(24 * 60 * 60);
  const maxEscalationDoublings = process.env.MAX_ESCALATION_DOUBLINGS || '4';

  const DeadMansHand = await hre.ethers.getContractFactory('DeadMansHand');
  const dmh = await DeadMansHand.deploy(
    feeTokenAddress,
    baseFee,
    failureThreshold,
    cooldownDuration,
    maxEscalationDoublings
  );
  await dmh.waitForDeployment();
  const address = await dmh.getAddress();

  console.log('DeadMansHand deployed to:', address);
  console.log('Now paste this address into public/static/js/config/network.js as dmhContractAddress for', network);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
