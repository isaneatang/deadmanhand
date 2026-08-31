# Dead Man's Hand (DMH)

Dead Man's Hand is an experimental BOT Chain dApp for owner-controlled emergency transfer of explicitly approved ERC-20 tokens and ERC-721 collections after an inactivity period. The owner keeps custody during normal operation. At recovery time, the contract uses the owner's recorded approvals and sends recoverable assets to the recipient authorized by a locally produced EIP-712 signature.

This README documents the **implemented v2 behavior**. `DMH-Master-Build-Prompt.md` contains the original historical build specification and `DMH-UI-Build-Prompt-v2.md` contains the UI addendum; sections that conflict with v2 are explicitly marked superseded there.

## Status

| Area | Current status |
|---|---|
| Solidity contract | v2 implementation in `contracts/DeadMansHand.sol`; local contract tests are present |
| Frontend | v2 Hono/Vite vanilla-JS SPA is implemented in `public/static/`; build verification is required |
| Testnet v2 deployment | Deployed and configured at `0xFa77ceE06328F2D748879e1DB480Ad51Ba856E06` on chain ID 968 |
| Old testnet deployment | The old v1 address `0x6bAc4F39e81955FD1Be3C890bd158aF0D08701af` is disabled and must not be used |
| Mainnet deployment | Not deployed; `dmhContractAddress` is `null` |
| Mobile wallet testing | Real MetaMask Mobile or other wallet in-app-browser testing has not been completed |
| Production frontend | Not deployed |
| Audit / production safety | No audit is claimed. This is not represented as production-safe software |

The testnet v2 deployment was independently read back after deployment: bytecode is present, `feeToken`, `baseFee`, `feeRecipient`, KDF version, and EIP-712 domain match this repository. Blockscout source verification has not yet been completed.

## Architecture

- The contract is Solidity 0.8.24 with OpenZeppelin 5.6.1 and EIP-712 domain name `DeadMansHand`, version `2`.
- The frontend is a hash-routed Hono/Vite SPA using vanilla JavaScript and a locally bundled, exact ethers.js v6.17.0 dependency.
- There is no off-chain database. Vault state and asset-registration events are on-chain; the frontend is a static app shell and client-side transaction/query code.
- The owner grants the deployed v2 contract per-token ERC-20 allowances or ERC-721 `setApprovalForAll` approvals. DMH does not custody assets during setup and does not automatically cover unrelated assets acquired later unless the relevant approval/registration covers them.
- A vault may register at most 50 distinct token contract addresses.

## v2 Data Model

The on-chain `Vault` struct is exactly:

```solidity
struct Vault {
    address owner;
    address authorizationSigner;
    bytes32 kdfSalt;
    uint8 kdfVersion;
    uint256 inactivityPeriod;
    uint256 lastActive;
    bool active;
    bool claimed;
    bool exists;
    uint256 claimNonce;
}
```

`createVault(vaultId, authorizationSigner, kdfSalt, kdfVersion, inactivityPeriod)` stores this record. `vaultId` is a random `bytes32`; `kdfSalt` must be nonzero; the only supported KDF version is `1`; and the inactivity period is between 60 seconds and 10 years inclusive. `claimNonce` starts at zero. Owner vault IDs and token entries are indexed separately.

Registered token entries are `TokenEntry { address tokenAddress; bool isERC721; }`. For ERC-20 entries, recovery attempts to transfer the lesser of the owner's current balance and the current allowance. For ERC-721 entries, recovery requires `IERC721Enumerable` to discover token IDs and transfers at most `MAX_NFTS_PER_TOKEN = 20` NFTs per collection.

There is no `secretHash`, plaintext secret field, failed-attempt counter, cooldown timestamp, failure threshold, fee escalation, or lockout state in v2. `getStatus` retains compatibility-shaped `locked` and `cooldownRemaining` return values, but the implementation always returns `false` and `0`.

## KDF v1 And Secret Handling

The browser derives the authorization signer from the secret phrase. The exact implemented KDF is:

- Normalize the phrase to Unicode NFC, encode it as UTF-8, reject empty values, unpaired surrogates, and values over 1024 UTF-8 bytes.
- Run PBKDF2-HMAC-SHA256 with **600,000 iterations** and a 256-bit output.
- Generate a fresh random `bytes32` salt with `crypto.getRandomValues`; store that salt in the vault.
- The PBKDF2 salt is the byte concatenation of the ASCII context prefix `DMH phrase key v1\0`, the 32-byte big-endian chain ID, the 20-byte checksummed contract address, the 20-byte owner address, the 32-byte vault ID, the 32-byte KDF salt, and the 4-byte big-endian derivation counter.
- The counter starts at zero and increments until the 32-byte output is a valid nonzero secp256k1 scalar. The resulting private key is used only locally to derive/sign, then temporary key material is cleared where the frontend controls it.

The owner stores the resulting signer address in the vault. A claimant repeats the derivation using the on-chain context and must produce the same signer. The phrase is not submitted as transaction data, put in a transaction event, or stored by the app.

**Offline brute-force caveat:** PBKDF2 raises the cost of each guess but does not make a weak phrase safe. The salt, chain, contract, owner, vault ID, and signer authorization context are public or recoverable from chain data, so an attacker can test guesses offline without paying the contract fee. Use a long, unique, high-entropy phrase. The UI's entropy check is a warning/control, not proof of security.

**Browser-memory/XSS caveat:** the phrase and derived key necessarily exist briefly in browser memory while deriving and signing. Clearing input/state and private-key buffers reduces exposure but cannot guarantee erasure from JavaScript engines, browser internals, extensions, compromised wallet browsers, or memory snapshots. Any XSS or malicious dependency running in the page may capture the phrase. Do not treat masking, local clearing, or the static frontend as a guarantee against a compromised browser.

## EIP-712 Claim Authorization

The exact signed struct is:

```solidity
struct Claim {
    bytes32 vaultId;
    address recipient;
    address feePayer;
    uint256 nonce;
    uint256 deadline;
    uint256 maxFee;
}
```

The type string is `Claim(bytes32 vaultId,address recipient,address feePayer,uint256 nonce,uint256 deadline,uint256 maxFee)`.

The domain is `name = DeadMansHand`, `version = 2`, the active BOT Chain `chainId`, and the deployed v2 `verifyingContract` address. The signature is produced locally by the KDF-derived authorization signer.

`recipient` and `feePayer` are separate signed fields. `recipient` receives successfully swept assets and may differ from the signer and fee payer. `feePayer` must equal `msg.sender`; that caller pays the fixed fee-token charge and gas. The contract verifies the vault, active state, exact current nonce, nonzero recipient, deadline, expiry, maximum fee, EIP-712 signature, and fee-payer identity before charging. The frontend currently creates a 15-minute deadline and signs the current fee as `maxFee`.

## One-Time Consume And Asset Consequences

After all authorization checks pass, v2 increments `claimNonce`, sets `active = false`, sets `claimed = true`, collects the fee, and emits `VaultClaimed`. The vault is consumed exactly once. A later claim, including one intended to recover assets skipped during the first sweep, cannot succeed. A fee-transfer failure reverts the transaction and rolls back consumption.

Asset sweeping is **skip-and-continue** after consumption. An ERC-20 query/transfer failure, stale or revoked approval, non-enumerable NFT collection, or failed NFT transfer emits `TokenTransferFailed` and does not prevent later registered entries from being attempted. Successful transfers emit `TokenTransferSucceeded`.

If an enumerable NFT collection contains more than 20 NFTs, only 20 are attempted and the cap is logged. The remaining NFTs cannot be recovered by replaying the claim because the vault is already inactive and consumed. A registered non-enumerable collection is skipped, not treated as recoverable.

The fixed fee is `baseFee`, paid in the immutable deployment `feeToken` to the immutable `feeRecipient`. The testnet deployment uses `1 USDT` at 6 decimals (`1000000`), but the deployed contract's constructor values are authoritative. `maxFee` must be at least the contract's `baseFee`.

## Frontend And Networks

Routes are `#/`, `#/setup`, `#/claim`, and `#/dashboard/:vaultId`. The hash router is intended for wallet in-app-browser compatibility. Network, contract, and fee-token values are read from `public/static/js/config/network.js`; a missing DMH address fails closed rather than guessing.

| | BOT Chain Testnet | BOT Chain Mainnet |
|---|---|---|
| Chain ID | 968 | 677 |
| RPC | `https://rpc.bohr.life` | `https://rpc.botchain.ai` |
| Explorer | `https://scan.bohr.life` | `https://scan.botchain.ai` |
| Fee token | `0x75edC9335175Fc0552D51D48439F229c10420fe3` | `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` |
| v2 DMH address | `0xFa77ceE06328F2D748879e1DB480Ad51Ba856E06` | `null` |

The old testnet deployment at `0x6bAc4F39e81955FD1Be3C890bd158aF0D08701af` is a v1 plaintext-secret contract and is intentionally disabled. It is incompatible with the v2 ABI/KDF/EIP-712 flow.

Deployment migration requires a **new contract address**. Existing v1 vaults do not migrate automatically. Existing v1 approvals and signatures must not be assumed valid for v2; owners must create fresh v2 vaults and grant fresh approvals to the new v2 address. Treat any old address as unusable for current frontend operations.

```bash
DEPLOYER_PRIVATE_KEY=0x... FEE_TOKEN_ADDRESS=0x... FEE_RECIPIENT_ADDRESS=0x... BASE_FEE=1000000 npx hardhat run scripts/deploy.cjs --network botTestnet
```

`BASE_FEE` is required and is expressed in the fee token's smallest unit. Never put private keys in documentation, source control, or frontend configuration.

### BOT Chain Testnet v2 Deployment

- Contract: `0xFa77ceE06328F2D748879e1DB480Ad51Ba856E06`
- Creation transaction: `0x55c17884303ded1bbacdaf28a91470e7c2b277c6705a42ecf688108339c3a74b`
- Fee token: `0x75edC9335175Fc0552D51D48439F229c10420fe3` (`USDT`, 6 decimals)
- Base fee: `1000000` (1 USDT)
- Fee recipient: `0x3d53CB82BffA53bdA7217aD3F8a640fE7c052a6e`
- EIP-712 domain: `DeadMansHand`, version `2`, chain ID `968`, verifying contract equal to the address above
- KDF version: `1`
- Blockscout indexing: present
- Blockscout source verification: not completed

## Development And Security Verification

```bash
npm install
npm run build
npm run test:contracts
npm run check
npm run dev
npm run preview
```

`npm run check` runs the production build followed by the Hardhat contract suite. The tests cover v2 storage/validation, owner controls, expiry, EIP-712 binding and replay protection, fee rollback, skip-and-continue, NFT enumeration/cap, and reentrancy resistance.

Before any deployment or production claim, inspect deployed bytecode and constructor values; confirm chain ID, EIP-712 verifying address, fee token, and fee recipient; confirm config does not point at the disabled v1 address; run build and contract tests successfully on Node 20-24; exercise the complete disposable testnet flow; inspect sweep success/failure events; test stale approvals, non-enumerable NFTs, and more than 20 NFTs; validate input/network/deadline behavior; and verify that secrets are not logged or stored.

The UI must also be manually tested, including every custom picker and the keyboard-visible secret-entry screen, inside a real mobile wallet in-app browser. MetaMask Mobile is the minimum target. This test has not passed for this repository. These checks are engineering verification, not an audit. No audit, formal verification, or production safety guarantee is claimed.
