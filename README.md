# Dead Man's Hand (DMH)

A decentralized crypto inheritance / emergency-access protocol on BOT Chain.
An owner registers assets they already hold (no assets move or get locked up
front — a per-token `approve`/`setApprovalForAll` from the owner's own EOA is
all that's granted). If the owner goes inactive past a chosen period, anyone
who knows the secret can claim the registered assets, paying a flat fee that
escalates (temporarily) on repeated wrong guesses.

## Current Status: Contract Deployed to Testnet, Frontend Not Yet Deployed

This is an honest status report, not a "done" claim. See the checklist below.

| Area | Status |
|---|---|
| Smart contract (`contracts/DeadMansHand.sol`) | Written; test suite included |
| Contract deployed to testnet | Deployed at `0x6bAc4F39e81955FD1Be3C890bd158aF0D08701af` on BOT Chain Testnet (chain ID 968) |
| Contract deployed to mainnet | Not deployed; mainnet transactions are unavailable |
| Frontend (Hono/Vite SPA, all flows) | Rebuilt and source-checked; production build must run on supported Node 20-24 |
| Production deploy | Not deployed |
| Real mobile-wallet in-app-browser test | Not completed; MetaMask Mobile remains the minimum acceptance test |

### Open decisions blocking full completion

1. **Deployment target.** The current package is configured for Vercel. Confirm
   the production account/project before running `npm run deploy`.
2. **Real mobile wallet test.** The spec explicitly requires testing inside a
   real mobile wallet's in-app browser (MetaMask mobile at minimum) before
   this can be considered spec-complete. That can only happen once the app
   is actually deployed to a reachable URL — it can't be done meaningfully
   against the sandbox-only dev preview.

---

## Architecture

- **Contract**: `contracts/DeadMansHand.sol` (Solidity 0.8.24, OpenZeppelin
  5.6.1, `evmVersion: cancun`). Per-token EOA approval model — the contract
  never custodies assets during normal operation; it only calls
  `transferFrom` / `safeTransferFrom` at successful-claim time, using
  allowances the owner granted directly from their own wallet.
- **Frontend**: Hono + Vite, configured for Vercel and serving a
  hash-routed (`#/...`) vanilla-JS SPA from `public/static/js/`. No frontend
  framework — plain DOM manipulation, `ethers.js` v6.13.4 pinned via
  `esm.sh` CDN as the sole wallet/hashing/contract library.
- **No off-chain database.** All vault state lives on-chain in the contract.
  The web application only serves the app shell and static assets; it holds no server-side
  persistence (no D1/KV/R2 needed for this app).

### Contract data model

```solidity
struct Vault {
  address owner;
  bytes32 secretHash;       // keccak256(secretPlaintext, ownerAddress, vaultId)
  uint256 inactivityPeriod; // seconds
  uint256 lastPing;         // last heartbeat timestamp
  bool active;              // owner can deactivate permanently
  uint16 failedAttempts;    // resets on cooldown expiry or successful unlock
  uint256 cooldownUntil;    // 0 = no active cooldown
  bool exists;
}
```

- The vault creator chooses **any** inactivity duration between 1 minute and
  10 years (`MIN_INACTIVITY_PERIOD` / `MAX_INACTIVITY_PERIOD` in the
  contract) — there is no forced multi-month floor. The UI's Step 2 lets you
  type a number + pick a unit (minutes/hours/days/weeks/months/years), with
  quick-fill presets as convenience shortcuts only.
- Each vault has a list of registered token entries (ERC-20 or ERC-721
  collection address + a flag). Max 50 per vault.
- Every collected unlock-attempt fee is forwarded **directly** to a fixed
  `feeRecipient` address set at deploy time — the contract never holds fees
  itself, so there is nothing to withdraw and nothing that can get stuck.
- Secret hash is salted by **both** owner address and vaultId
  (`keccak256(abi.encodePacked(secretPlaintext, ownerAddress, vaultId))`) so
  the same plaintext secret never produces the same hash across vaults —
  precomputed dictionary attacks against one vault don't transfer to another.
- Claim ("unlock attempt") always charges the current fee in the configured
  fee token, win or lose. On a wrong guess, `failedAttempts` increments and
  the fee **doubles**, capped at `maxEscalationDoublings`, with a temporary
  cooldown (`cooldownDuration`) — cooldown always expires on its own
  (`previewFee`/`getStatus` account for elapsed-but-untouched cooldowns), so
  there is no permanent lockout / no DoS vector.
- On a correct guess, the contract sweeps every registered token to the
  claimant with **skip-and-continue**: if one token's `transferFrom` reverts
  (stale approval, revoked allowance, non-enumerable NFT collection, etc.)
  that single token is skipped and logged (`TokenTransferFailed` event) while
  the rest of the claim proceeds — one bad token never reverts the whole
  claim.
- **Known limitation**: ERC-721 collections are registered as a whole
  (mirroring `setApprovalForAll`), so the contract needs `ERC721Enumerable`
  to discover which tokenIds the owner currently holds at claim time. A
  registered collection that is not enumerable is skipped gracefully and
  logged rather than causing a revert — this is a real constraint of an
  on-chain-only (no indexer) design, not an oversight.

## Functional entry points (frontend routes)

All routes are hash-based (`#/...`) for reliability inside mobile wallet
in-app WebViews (they don't rely on `pushState`/server routing).

| Route | Purpose |
|---|---|
| `#/` | Landing page — choose "set up a vault" or "claim a vault" |
| `#/setup` | 5-step owner wizard: connect wallet → choose inactivity period + secret → select assets → approve + register → done |
| `#/claim` | 4-step claimant flow: look up vault by owner address (or paste vaultId directly) → view status/countdown → enter secret (with live fee preview) → result |
| `#/dashboard/:vaultId` | Owner dashboard for an existing vault: countdown, near-expiry warning, protected-assets list, ping/add-asset/deactivate controls (gated to the connected wallet matching the vault owner) |

## Contract entry points (on-chain)

| Function | Who calls it | Effect |
|---|---|---|
| `createVault(vaultId, secretHash, inactivityPeriod)` | Owner | Registers a new vault |
| `addToken(vaultId, tokenAddress, isERC721)` | Owner | Registers an asset (owner must separately `approve`/`setApprovalForAll` from their own wallet) |
| `ping(vaultId)` | Owner | Heartbeat — resets the inactivity timer |
| `deactivateVault(vaultId)` | Owner | Permanently disables the vault (no more claims possible) |
| `attemptUnlock(vaultId, secretPlaintext)` | Claimant | Pays the current fee; on match, sweeps registered assets (skip-and-continue) |
| `getStatus(vaultId)` | Anyone (view) | `(expired, timeRemaining, active, locked, cooldownRemaining)` |
| `previewFee(vaultId)` | Anyone (view) | Current fee a claim attempt would cost right now |
| `getVaultTokens(vaultId)` / `getOwnerVaults(owner)` / `getFailedAttempts(vaultId)` | Anyone (view) | Read helpers |

## Security Notes

- During vault creation, the secret is hashed locally and only the salted hash
  is submitted. During a claim, the deployed contract requires
  `attemptUnlock(vaultId, secretPlaintext)`, so the plaintext secret is public
  transaction calldata and becomes permanently visible on-chain. Fixing this
  requires a redesigned claim protocol and a new contract deployment; it
  cannot be solved by a frontend-only hash.
- No native `<select>` element is used anywhere in the UI (spec requirement);
  all "choose one of several" UI uses custom bottom-sheet/chip-group
  components (`components/DropdownSheet/`).
- The testnet fee-token and DMH addresses are configured. The mainnet DMH
  address remains explicitly `null`, so mainnet vault operations fail closed.
  `scripts/deploy.cjs` throws rather than guessing deployment values.

## Networks

Single-file network switch: `public/static/js/config/network.js`.

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 968 | 677 |
| RPC | `https://rpc.bohr.life` | `https://rpc.botchain.ai` |
| Explorer (Blockscout) | `https://scan.bohr.life` | `https://scan.botchain.ai` |
| USDT / fee token | ✅ `0x75edC9335175Fc0552D51D48439F229c10420fe3` | ✅ `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` |
| DMH contract address | ✅ `0x6bAc4F39e81955FD1Be3C890bd158aF0D08701af` | ❌ not deployed |
| Fee recipient | `0xCC5d74709117c08B803a32C51E108262ed66B4BD` | (same, once deployed) |
| Deploy params | baseFee=1 USDT, failureThreshold=5, cooldown=24h, maxEscalationDoublings=4 | (not yet set) |

## Development

```bash
npm install
npm run build
npm run dev
```

Contract tests:

```bash
npm run test:contracts
```

Contract deploy (requires env vars — will throw if `FEE_TOKEN_ADDRESS` or
`FEE_RECIPIENT_ADDRESS` is missing, by design):

```bash
DEPLOYER_PRIVATE_KEY=0x... FEE_TOKEN_ADDRESS=0x... FEE_RECIPIENT_ADDRESS=0x... npx hardhat run scripts/deploy.cjs --network botTestnet
```

Testnet has already been deployed this way — see the Networks table above
for the live address. To redeploy (e.g. after a contract change), rerun the
command above and paste the new address into `network.js`.

## Not yet implemented / not yet done

- Contract not deployed to mainnet (only testnet so far).
- Production frontend deployment not done.
- Real mobile-wallet in-app-browser manual test pass not done (see Open
  Decisions #2) — this is a spec-mandated bar, not optional polish.

## Recommended next steps

1. Confirm the production Vercel project and account.
2. Deploy the frontend.
3. Test the whole flow inside MetaMask mobile's in-app browser on a real
   phone, on testnet, before considering this production-ready.
4. Deploy to mainnet once testnet is fully verified end-to-end.
