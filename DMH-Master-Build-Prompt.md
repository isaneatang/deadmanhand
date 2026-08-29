# Dead Man's Hand (DMH) — Master Build Prompt
## BOT Chain Builder Challenge — Full Spec for Handoff to Build AI

**Read this entire document before writing any code.** This is a spec-grade
prompt — every decision below has already been made; do not re-litigate them
or substitute your own judgment on architecture, fee model, or lookup design.
Where a value is marked `UNVERIFIED`, use a clearly labeled placeholder and
flag it in the README — do not fabricate contract addresses, RPC endpoints,
or API paths.

---

## 1. Project Summary

Dead Man's Hand is a decentralized crypto inheritance / emergency-access
protocol on BOT Chain. An owner sets up a vault tied to a secret pass-phrase
(never stored in plaintext) and an inactivity period. If the owner goes
inactive past that period, anyone who knows the secret can submit it, pay a
small retrieval fee, and — if it matches — receive the tokens/NFTs the owner
pre-approved for release. The owner's assets never move or get locked up
during normal use; they stay in the owner's own wallet the entire time.

**Target:** BOT Chain Builder Challenge (RWA / identity track), same
submission category as DevicePassport.

---

## 2. Architecture — Final Decision

**Per-token approval model, EOA-based. Not a Safe/smart-account module.**

This was decided after weighing both options directly:

- A Safe-module approach would give "true" universal coverage (any asset,
  including ones acquired after setup) but requires the owner to migrate
  off their normal wallet into a Safe, fund it separately for gas, and
  accept a split balance view across MetaMask/OKX vs. the Safe app. Real
  adoption friction for a "set up once, forget about it" product — and Safe's
  deployment on BOT Chain is unconfirmed regardless.
- Per-token approval works with the owner's existing wallet (MetaMask, OKX,
  etc.), nothing migrates, nothing about their day-to-day balance view
  changes. The tradeoff: DMH only covers what was explicitly approved —
  assets acquired after setup need a follow-up approval, they aren't
  automatically covered. This is the accepted tradeoff for v1.
- The Safe-module approach is parked as a future idea (a dedicated wallet
  app built around a Safe by default, with DMH wired in automatically) — do
  not build it now.

**Mechanically:** at setup, the owner signs a standard `approve()` (ERC-20)
or `setApprovalForAll()` (per NFT collection — this covers the whole
collection including future mints in one signature) naming the DMH contract
as spender, for each asset they want covered. DMH stores nothing about the
assets themselves beyond a per-vault registry of which contracts it's
allowed to pull from. At claim time, DMH loops that registry and calls
`transferFrom` on each one.

---

## 3. UNVERIFIED — Confirm Before Build

Do not guess these. Use a labeled placeholder and flag in the README if
unconfirmed at build time.

1. **BOT Chain testnet parameters** — chain ID 968, RPC `https://rpc.bohr.life`,
   faucet `https://faucet.botchain.ai/basic` — already used on DevicePassport,
   carry forward, but re-verify still live before deploying.
2. **BOT Chain mainnet parameters** — chain ID 677, RPC `https://rpc.botchain.ai`.
3. **Testnet USDT contract address** — mainnet bridged USDT is
   `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`; the testnet equivalent is
   unconfirmed. Check `scan.bohr.life/tokens` before build. If unavailable,
   the app must degrade gracefully (see Section 7), not show a broken balance.
4. **Blockscout API exact path** for "all tokens held by address" — BOT
   Chain's explorer (`scan.botchain.ai` / `scan.bohr.life`) runs on
   Blockscout, which documents a REST/JSON API with a token-holdings
   endpoint, but the exact path and any rate limits need confirming against
   BOT Chain's specific instance at build time (`{explorerApiBase}/addresses/{address}/tokens`
   is the expected shape but is not yet confirmed).
5. **BOT/USD price reference** — not needed. Fee is a flat 1 USDT (see
   Section 5), which sidesteps needing a price oracle entirely.

---

## 4. Core Mechanics

### 4.1 Vault creation (owner-only)
- Owner connects a normal EOA wallet (MetaMask, OKX, etc. — no Safe, no
  migration).
- Owner picks a secret pass-phrase, alphanumeric code, or emoji string, plus
  an inactivity period (UI should offer a sensible range, e.g. 6 months–5
  years).
- Front end enforces a **minimum-entropy check** on the secret before
  allowing submission (reject dictionary words, short strings, common
  patterns) — this matters because the on-chain hash is public forever and
  can be brute-forced offline at zero cost; entropy is the only real defense
  against that, the fee only deters *on-chain* guessing.
- Contract call: `createVault(vaultId, secretHash, inactivityPeriod)`.
  - `vaultId` is an opaque, owner-generated random `bytes32` — not derived
    from the owner's address, so it isn't guessable on its own.
  - `secretHash = keccak256(abi.encodePacked(secretPlaintext, msg.sender, vaultId))`.
    Salting with both the owner's address and the vaultId prevents
    precomputed dictionary attacks from transferring across vaults.
  - The plaintext secret is hashed **client-side only** (Section 7) and
    never touches a transaction payload, event log, or network request in
    plaintext form.
- Vault is created empty of asset registrations — asset selection is the
  next step, not part of vault creation itself.

### 4.2 Asset selection & batch approval
- UI scans the connected wallet's current token/NFT holdings (via the
  Blockscout API, Section 3.4) and presents a checklist.
- User selects what to protect, confirms, and the UI queues approval
  transactions back-to-back — one signature per ERC-20 token, one per NFT
  *collection* (since `setApprovalForAll` covers a whole collection,
  including future mints from it, in a single signature).
- Each successfully approved asset is registered against the `vaultId` via
  `addToken(vaultId, tokenAddress)` — a separate lightweight call, since DMH
  cannot auto-discover which tokens have approved it; it needs an explicit
  registry per vault.
- Manual-paste fallback: if the Blockscout scan fails or times out, let the
  user paste in contract addresses directly rather than blocking setup.
- **Adding a new asset later requires no new secret or re-setup** — just
  approve the new token/collection to DMH (normal signature, no password),
  then call `addToken(vaultId, tokenAddress)`. Same vault, same secret.

### 4.3 Heartbeat (owner-only)
- `ping(vaultId)` resets `lastActive` to the current block timestamp.
- **Self-ping only** — a contract cannot observe an owner's general wallet
  activity elsewhere on-chain without a keeper/oracle service, which adds a
  trust dependency out of scope for v1. The UI should nag the owner as
  expiry approaches (e.g. a visible warning banner once inside the final
  25% of the inactivity period) since there's no other reminder mechanism
  in v1.

### 4.4 Deactivation (owner-only) — confirmed feature
- Owner can deactivate a vault entirely via a standard wallet signature (not
  gated by the secret — the secret's job is to gate the claimant's unlock,
  not routine owner admin actions).
- Deactivating a vault does not automatically revoke individual token
  approvals — note this clearly in the UI so the owner understands they may
  want to separately revoke approvals if they want a full clean break.

### 4.5 Lookup — primary by owner's EVM address
- **Primary lookup field: the former owner's EVM address.** This was the
  final decision, accepting the tradeoff that address-based lookup makes
  "this wallet's vault is expired/claimable" visible to anyone — weighed
  against vaultId-only lookup being too easy for a legitimate claimant to
  lose or forget.
- **Secondary/advanced field: vaultId**, kept available below the address
  field for exact lookup (useful if one address maps to multiple vaults, or
  as a fallback).
- `getStatus(vaultId) → (expired: bool, timeRemaining: uint256)` remains the
  underlying contract call either way; address-based lookup resolves to a
  `vaultId` (or list of them) client-side/via an indexer before calling
  `getStatus`.

### 4.6 Claim / unlock (anyone, fee required)
- Claimant enters the secret; front end hashes it client-side and submits
  `attemptUnlock(vaultId, secretPlaintext)` along with a **flat 1 USDT
  fee** (Section 5), paying their own gas in BOT.
- Reverts if `block.timestamp < lastActive + inactivityPeriod`.
- Reverts if the vault is in a lockout cooldown (see below).
- Contract recomputes `keccak256(abi.encodePacked(secretPlaintext, owner, vaultId))`
  and compares to the stored hash.
- **On match:** loops through the vault's registered token list and executes
  `transferFrom`/NFT transfer for each one to the claimant. Fee is taken
  either way, to cover gas and deter spam.
  - **Partial-claim handling — skip-and-continue (confirmed).** If one
    token's transfer fails (e.g. the owner already moved it elsewhere after
    approving, so the approval is stale), DMH logs that single failure via
    an event and continues to the next token, rather than reverting the
    whole claim. One stale approval should never block recovery of
    everything else that's still available.
- **On mismatch:** fee is retained (not refunded), a failed-attempt counter
  increments. After N consecutive failures (e.g. 5), the vault enters a
  **timed cooldown** (e.g. 24h) — never a permanent lock, since a permanent
  lock after N failures would let an attacker deliberately lock out the real
  claimant (a denial-of-service vector). Fee escalates on repeat attempts
  within a lockout cycle (e.g. doubles) so on-chain brute-forcing gets
  progressively more expensive — while noting this only deters *on-chain*
  guessing; offline guessing against the public hash is bounded only by the
  secret's entropy, which is why the UI-level entropy check (Section 4.1)
  is doing real security work, not just UX polish.

---

## 5. Fee

Flat **1 USDT** per unlock attempt (match or mismatch). No price oracle
needed since it's a flat stablecoin amount, not a BOT-equivalent conversion.
Claimant needs 1 USDT (approved/held in their own wallet) plus gas in BOT.
See Section 3.3 for the testnet USDT address caveat.

---

## 6. Explicit Prohibitions (build AI must follow)

- No fabricated BOT Chain contract addresses, RPC endpoints, or API paths —
  label unconfirmed values exactly as shown in Section 3.
- No plaintext secret ever touches a transaction, event log, console log,
  localStorage/sessionStorage, or analytics/error-reporting payload —
  hashing happens client-side only, before submission.
- No permanent-lockout logic on repeated failed unlock attempts (DoS risk)
  — cooldown only.
- No Safe/smart-account module — this build is the per-token EOA model
  only (Section 2).
- No native `<select>` dropdowns anywhere (Section 8.2) — they fail to open
  reliably inside several mobile wallet in-app browsers.
- No new crypto/hashing library beyond the browser's native
  `crypto.subtle` or whatever is already pinned elsewhere in the stack.
- No `eval`, `Function()` constructor, or `innerHTML`/
  `dangerouslySetInnerHTML` assignment of anything derived from user or API
  input.

---

## 7. Security Requirements

- **Secret input field** uses `type="password"` (masked by default) with a
  visible show/hide toggle.
- Hash the secret client-side, immediately on submit, using
  `crypto.subtle.digest` (native, no new dependency) or keccak256 via
  whatever ethers/viem-equivalent library is already used elsewhere in this
  stack — do not add a new package solely for this.
- Clear the secret from component state immediately after hashing.
- No auto-copy-to-clipboard on the secret field, ever. Vault ID may be
  made copyable (explicit, user-initiated); the secret must not be.
- **Dependency hygiene:** only use packages already established in prior
  BOT Chain builds (ethers.js/viem/wagmi, Reown AppKit) or explicitly
  flagged before adding anything new. If using ESM CDN imports (as in
  DevicePassport), pin exact versions and use well-known CDNs (jsDelivr,
  esm.sh, unpkg) only.
- Validate and checksum all user-entered addresses and vault IDs before use
  in any contract call or API request.
- Mainnet-mode actions require an explicit "you are about to interact with
  MAINNET, real funds" confirmation step before any live-network
  transaction (ties into the network badge in Section 8.3).

---

## 8. UI/UX Specification

### 8.1 Visual theme — dark, black-and-green hacker aesthetic, not terminal
A normal interactive web app (cards, real navigation, real buttons) that
*feels* like a hacker/security tool rather than a simulated command line.

- Background: near-black, `#05070A`–`#0A0D0F` range (not pure `#000000`).
- Primary accent: dark-to-mid green gradient, `#0F5132`–`#16A34A`, for
  active/success states.
- Highlight accent (sparingly): phosphor green `#22C55E`/`#39FF88` for
  status dots, active countdowns, success toasts — never a full background.
- Borders: low-opacity green (`rgba(34,197,94,0.15–0.25)`).
- Danger stays true red (`#EF4444`) — do not tint errors green.
- Monospace font (JetBrains Mono / IBM Plex Mono) for numbers, addresses,
  hashes, and countdowns only; normal sans-serif for body copy and buttons.
  Mixing the two is what reads as "hacker tool," not monospace everywhere.
- Optional subtle effects: soft green glow on focused inputs/primary
  buttons, faint background grid/scanline texture at ≤4% opacity. Decorative
  only — never applied to real balances, addresses, or secrets.
- Card-based layout with small border radius (6–10px), standard top/bottom
  nav. No boxed ASCII panels, no simulated command feed.

### 8.2 No native dropdowns (hard requirement)
Native `<select>` elements render inconsistently or fail to open inside
several mobile wallet in-app WebViews (MetaMask mobile, Trust Wallet,
Rainbow, Coinbase Wallet), even though they work fine in standard
Chrome/Safari. For every "choose one of several" interaction:

- Build custom `div`-based dropdowns (never a wrapper around native
  `<select>`), or
- Preferred for primary flows (setup wizard, claim flow): a bottom-sheet
  picker — tap a field, a panel slides up with tappable rows, tap to
  select.
- For short lists (2–4 options, e.g. testnet/mainnet, skip-vs-revert), a
  row of styled chip/radio buttons is fine — no dropdown component needed.
- Manually test every custom dropdown/bottom-sheet inside at least one real
  mobile wallet in-app browser (MetaMask mobile is the minimum bar) before
  considering the build done.

### 8.3 Network switching — single config, one-line switch
All network parameters live in one exported config, nothing else in the
codebase hardcodes a chain ID, RPC URL, explorer URL, or token address.

```js
// config/network.js
const NETWORKS = {
  testnet: {
    chainId: 968,
    chainName: "BOT Chain Testnet",
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
    explorerApiBase: "https://scan.bohr.life/api/v2",
    usdtAddress: null, // UNVERIFIED — confirm before build
    faucetUrl: "https://faucet.botchain.ai/basic",
  },
  mainnet: {
    chainId: 677,
    chainName: "BOT Chain",
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
    explorerApiBase: "https://scan.botchain.ai/api/v2",
    usdtAddress: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
    faucetUrl: null,
  },
};

const ACTIVE_NETWORK = "testnet"; // "testnet" | "mainnet" — the ONLY switch

export const getNetworkConfig = () => NETWORKS[ACTIVE_NETWORK];
```

Every component/contract call/asset-scan request uses `getNetworkConfig()`
rather than importing constants directly. A visible header badge
("TESTNET" amber / "MAINNET" green) driven by the same config makes the
active network unambiguous at all times — a safety feature, not just a dev
convenience.

### 8.4 Asset display panel
Both the setup flow and the vault dashboard show real holdings, not a mock
list:

- Native BOT balance (`eth_getBalance`).
- USDT balance (`balanceOf` on the active network's `usdtAddress`) — hide
  this row cleanly rather than showing a broken `0` if testnet USDT is
  unconfirmed.
- All other ERC-20/ERC-721 holdings via the Blockscout API (Section 3.4),
  each row showing icon (generic fallback if none provided — never fetch
  icons from an unlisted third-party source), symbol, balance, and an
  "include in vault" toggle during setup.
- Manual-paste fallback if the scan fails or times out.

### 8.5 Mobile & wallet-browser navigation
Design mobile-in-wallet-browser-first, desktop second.

- Persistent, large (44×44px minimum) back button on every screen after the
  first — never rely on the device/browser back button alone, since wallet
  in-app browsers often suppress or mishandle it.
- Step indicator ("Step 2 of 5" or dots) on multi-step flows.
- No hover-only interactions — every hover-reveal needs a tap-equivalent.
- Bottom sheets over full modals where possible.
- Single-column layout below ~600px — no side-by-side panels at any width
  where it doesn't clearly help.
- Sticky primary action button at the bottom of the viewport on form-heavy
  screens, so the main CTA stays reachable with the mobile keyboard open.
- Explicitly test the secret-entry screen with the mobile keyboard open —
  confirm the input and submit button are never hidden behind it.

### 8.6 Flows to build (screen list)
**Owner setup wizard:**
1. Connect wallet
2. Set inactivity period + secret (with entropy check)
3. Scan & select assets to protect
4. Batch-approve queue (sequential wallet prompts)
5. Vault live — dashboard with countdown, copyable vault ID, deactivation
   option, "add asset later" entry point

**Claimant flow:**
1. Lookup — address field primary, vaultId secondary/advanced (Section 4.5)
2. Status view (not-yet-expired countdown, or expired + claim entry)
3. Secret entry (masked, with show/hide) + fee confirmation
4. Result — success (assets received, itemized) or failure (fee lost,
   attempts remaining before cooldown shown)

---

## 9. File/Component Structure

Split the frontend into separate files/components — do not ship a single
large page file, since a monolith becomes unauditable for security review
and unmaintainable once both flows have real state.

```
/config/network.js          — the one network switch (Section 8.3)
/lib/hashing.js              — client-side secret hashing (Section 7)
/lib/blockscout.js           — asset-scan API calls + manual-paste fallback
/components/theme/           — shared design tokens, colors, buttons, inputs
/components/DropdownSheet/   — custom bottom-sheet/dropdown component (8.2)
/components/AssetPanel/      — Section 8.4
/flows/OwnerSetup/           — one file per wizard step
/flows/ClaimantFlow/         — one file per step
/flows/Dashboard/            — active vault view, countdown, deactivation
/contracts/DeadMansHand.sol  — vault registry, ping, claim, lockout logic
/pages or /routes            — top-level routing only, no business logic
```

---

## 10. Suggested Build Order

1. Confirm all `UNVERIFIED` items in Section 3.
2. `DeadMansHand.sol` — createVault, ping, addToken, getStatus,
   attemptUnlock, deactivateVault — with unit tests specifically on the
   lockout/fee-escalation logic and the skip-and-continue partial-claim
   loop, since those are the parts most likely to have an off-by-one or
   bypass bug.
3. `config/network.js` and `lib/hashing.js` first, since everything else
   depends on them.
4. Owner setup wizard, then claimant flow, then dashboard.
5. Wire in the Blockscout asset scan; ship the manual-paste fallback in the
   same PR, not as a follow-up.
6. Testnet deployment once Section 3 items are confirmed.
7. Manual test pass inside a real mobile wallet in-app browser (Section
   8.2/8.5) before calling it done.

---

## 11. Open Product Questions (still Isane's call, not the build AI's)

- Exact inactivity-period range to offer in the UI (suggested 6mo–5yr,
  confirm final bounds).
- Exact lockout cooldown duration and failure-count threshold (suggested
  5 failures / 24h cooldown, confirm final numbers).
- Fee-escalation multiplier within a lockout cycle (suggested doubling,
  confirm).
