require('@nomicfoundation/hardhat-toolbox');

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: 'cancun',
    },
  },
  paths: {
    sources: './contracts',
    tests: './test-contracts',
    cache: './cache-hardhat',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {},
    botTestnet: {
      url: 'https://rpc.bohr.life',
      chainId: 968,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    botMainnet: {
      url: 'https://rpc.botchain.ai',
      chainId: 677,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
