# Dead Man's Hand (DMH)

A decentralized crypto inheritance / emergency-access protocol on BOT Chain.
An owner registers assets they already hold (no assets move or get locked up
front — a per-token `approve`/`setApprovalForAll` from the owner's own EOA is
all that's granted). If the owner goes inactive past a chosen period, anyone
who knows the secret can claim the registered assets, paying a flat fee that
escalates (temporarily) on repeated wrong guesses.

## ⚠️ Current Status: Built, NOT Deployed, NOT Fully Verified

This is an honest status report, not a "done" claim. See the checklist below.

| Area | Status |
|---|---|
| Smart contract (`contracts/DeadMansHand.sol`) | ✅ Written, 23/23 Hardhat tests passing |
| Frontend (Hono/Vite SPA, all flows) | ✅ Written, builds clean, runs in sandbox dev preview, zero console errors on **desktop** Playwright check |
| Contract deployed to any network | ❌ **Not deployed** — blocked, see "Open Decisions" below |
| Cloudflare Pages production deploy | ❌ **Not deployed** — needs your decision on deploy path (see below) |
| Real mobile-wallet in-app-browser test (MetaMask mobile, spec-mandated minimum bar) | ❌ **Not done** — only desktop browser has been checked |
| Git commit of this session's work | ✅ Done as of this commit |

### Open decisions blocking full completion

1. **Testnet fee-token address.** The spec requires a flat fee denominated in
   a stablecoin (referred to as "USDT" throughout the spec). I could not find
   a canonical, unambiguous USDT-equivalent token deployed on the BOT Chain
   **testnet** (`rpc.bohr.life`, chainId 968) — several differently-named
   candidates exist and picking one would be fabricating a value the spec
   explicitly forbids guessing at. **Mainnet** USDT is confirmed
   (`0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` on chainId 677,
   `rpc.botchain.ai`). To deploy to testnet I need you to either (a) tell me
   the correct testnet fee-token address, or (b) approve deploying a
   `MockERC20` as a stand-in fee token for testnet demo/testing purposes only.
2. **Cloudflare deployment path.** Two deploy options are available for this
   sandbox: deploying to *your own* Cloudflare account (BYOK, full wrangler
   control) or a Genspark-managed hosted deploy (no token needed from you).
   I have not deployed the web app anywhere yet — tell me which you want.
3. **Real mobile wallet test.** The spec explicitly requires testing inside a
   real mobile wallet's in-app browser (MetaMask mobile at minimum) before
   this can be considered spec-complete. That can only happen once the app
   and contract are actually deployed to a reachable URL/network — it can't
   be done meaningfully against the sandbox-only dev preview.

Once you answer #1 and #2, I can finish deployment and then do #3.

---

## Architecture

- **Contract**: `contracts/DeadMansHand.sol` (Solidity 0.8.24, OpenZeppelin
  5.6.1, `evmVersion: cancun`). Per-token EOA approval model — the contract
  never custodies assets during normal operation; it only calls
  `transferFrom` / `safeTransferFrom` at successful-claim time, using
  allowances the owner granted directly from their own wallet.
- **Frontend**: Hono + Vite, deployed as a Cloudflare Pages Worker serving a
  hash-routed (`#/...`) vanilla-JS SPA from `public/static/js/`. No frontend
  framework — plain DOM manipulation, `ethers.js` v6.13.4 pinned via
  `esm.sh` CDN as the sole wallet/hashing/contract library.
- **No off-chain database.** All vault state lives on-chain in the contract.
  The Cloudflare Worker only serves static assets; it holds no server-side
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

- Each vault has a list of registered token entries (ERC-20 or ERC-721
  collection address + a flag). Max 50 per vault.
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

## Security notes

- Secret plaintext is **never** sent anywhere off-device. Hashing
  (`keccak256`) happens entirely client-side via `ethers.js`; the plaintext
  is cleared from the input field and JS closure immediately after the hash
  is computed / the unlock tx is submitted.
- No native `<select>` element is used anywhere in the UI (spec requirement);
  all "choose one of several" UI uses custom bottom-sheet/chip-group
  components (`components/DropdownSheet/`).
- All UNVERIFIED values (testnet fee-token address, unset contract addresses)
  are explicitly `null` in `public/static/js/config/network.js` with comments
  explaining why, and the UI shows an explanatory "not available" banner
  instead of a fabricated `0` balance. `scripts/deploy.cjs` throws rather than
  guessing a fee-token address if `FEE_TOKEN_ADDRESS` isn't provided.

## Networks

Single-file network switch: `public/static/js/config/network.js`.

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 968 | 677 |
| RPC | `https://rpc.bohr.life` | `https://rpc.botchain.ai` |
| Explorer (Blockscout) | `https://scan.bohr.life` | `https://scan.botchain.ai` |
| USDT / fee token | ❌ unresolved (see Open Decisions) | ✅ `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` |
| DMH contract address | ❌ not deployed | ❌ not deployed |

## Development

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs   # runs `wrangler pages dev dist --port 3000`
```

Contract tests:

```bash
npx hardhat test    # 23 passing
```

Contract deploy (requires env vars — will throw if `FEE_TOKEN_ADDRESS` is
missing, by design):

```bash
DEPLOYER_PRIVATE_KEY=0x... FEE_TOKEN_ADDRESS=0x... npx hardhat run scripts/deploy.cjs --network botTestnet
```

## Not yet implemented / not yet done

- Contract not deployed anywhere (see Open Decisions #1).
- Cloudflare Pages production deploy not done (see Open Decisions #2).
- Real mobile-wallet in-app-browser manual test pass not done (see Open
  Decisions #3) — this is a spec-mandated bar, not optional polish.
- `dmhContractAddress` in `network.js` will need to be filled in for
  whichever network(s) get deployed.

## Recommended next steps

1. Answer the two open decisions above (testnet fee token; deploy path).
2. Deploy the contract to testnet (and mainnet once you're satisfied).
3. Deploy the frontend to Cloudflare Pages.
4. Test the whole flow inside MetaMask mobile's in-app browser on a real
   phone, on testnet, before considering this production-ready.
