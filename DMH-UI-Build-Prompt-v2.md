# Dead Man's Hand — Build Prompt Addendum v2
## UI/UX Overhaul, Network Switching, Asset Display, Mobile-Wallet Hardening, and Security Spec

**Read this together with the original DMH Master Build Prompt.** This document
supersedes the "terminal UI" direction from that earlier draft. Everything else
in the original master prompt (contract logic, hash scheme, claim flow, fee
logic, partial-claim handling) still stands. This addendum only changes: visual
theme, component architecture, network config, asset display, mobile-wallet
behavior, and security constraints.

**Instruction to the build AI:** Do not skip sections. Do not substitute your
own visual style for the one described below. Do not use native HTML
`<select>` dropdowns anywhere in this app. Do not fetch or import any
JavaScript package that is not explicitly whitelisted in the Security section.
If something below is ambiguous, stop and ask rather than guessing — do not
fabricate values, endpoints, or contract addresses.

---

## 1. Visual Theme — "Dark Green Hacker," Not Terminal

The earlier terminal/TUI concept (boxed ASCII panels, command-feed log) is
**dropped**. Replace it with a normal interactive web app that *feels* like a
hacker/security tool but behaves like a modern dApp — buttons, cards, real
navigation, no simulated command line.

**Palette**
- Background: near-black, `#05070A` to `#0A0D0F` range (not pure `#000000` —
  pure black looks flat on OLED and washes out green accents).
- Primary accent: dark-to-mid green, `#0F5132` → `#16A34A` gradient range for
  active/success states.
- Secondary glow/highlight: a brighter phosphor green (`#22C55E` or
  `#39FF88`) used sparingly — status dots, active countdown, success toasts.
  Never as a full background fill; it's an accent, not a base color.
- Borders/dividers: low-opacity green (`rgba(34,197,94,0.15–0.25)`), not solid
  white/gray — this is what reads as "hacker" without needing terminal chrome.
- Danger/error: keep a true red (`#EF4444`) — don't tint errors green, users
  need the danger color to break pattern from the theme.
- Font: a monospace font (e.g. `JetBrains Mono`, `IBM Plex Mono`) for numbers,
  addresses, hashes, and countdowns only — body copy and buttons use a normal
  readable sans-serif. Monospace-everywhere is what made the old direction
  read as "terminal"; mixing the two is what makes it read as "hacker tool
  UI" instead.
- Subtle effects allowed: soft green box-shadow glow on focused inputs and
  primary buttons, a faint scanline or grid texture in the page background at
  very low opacity (≤4%). Keep these decorative and non-blocking — no
  animated glitch effects on real data (addresses, balances, secrets).

**Structure**
- Card-based layout, not bordered ASCII panels. Rounded corners (small
  radius, 6–10px — sharp enough to still feel technical, not soft/consumer).
- Standard top nav or bottom nav (mobile) instead of a simulated shell prompt.
- Status/progress shown with real UI affordances: progress bars, badges,
  countdown chips — not a scrolling log pretending to be a terminal.

---

## 2. No Native Dropdowns — Cross-Wallet-Browser Requirement

**This is a hard requirement, not a preference.** Native `<select>` elements
render inconsistently or fail to open at all inside several in-app mobile
wallet browsers (MetaMask mobile, Trust Wallet, Rainbow, Coinbase Wallet) due
to how their embedded WebViews handle native OS picker overlays. Standard
Chrome/Safari have no such issue, which is why this bug is easy to miss in
normal development and only shows up on real wallet-app testing.

**Do not use:** `<select>`, `<option>`, or any component library dropdown
that wraps a native `<select>` under the hood.

**Use instead, for every "choose one of several options" interaction**
(network selection admin-side, asset type filters, claim reason codes, etc.):
- A custom-built dropdown: a button that toggles a `div`-based menu, built
  entirely in HTML/CSS/JS (or React state), never a native form control.
- Or, preferred for anything on a primary flow (setup wizard, claim flow): a
  **bottom sheet / modal picker** — tap a field, a panel slides up from the
  bottom with the full list of options as tappable rows, tap to select, sheet
  closes. This is the most reliable pattern across wallet WebViews and also
  the most natural mobile pattern.
- Radio-button-style chip groups are fine for short lists (2–4 options, e.g.
  testnet/mainnet toggle, skip-vs-revert claim mode) — just styled buttons in
  a row, no dropdown needed at all.

**Test requirement to state explicitly in the README the build AI produces:**
this app must be manually tested inside at least one real mobile wallet
in-app browser (MetaMask mobile is the minimum bar) before being considered
done, specifically clicking every custom dropdown/bottom-sheet component.

---

## 3. Network Switching — Single Config, Single Switch

All BOT Chain network parameters must live in **one file, one exported
object/function** — nothing else in the codebase should hardcode a chain ID,
RPC URL, explorer URL, or token address. Flipping from testnet to mainnet
must be a one-line change.

```js
// config/network.js
const NETWORKS = {
  testnet: {
    chainId: 968,
    chainName: "BOT Chain Testnet",
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
    explorerApiBase: "https://scan.bohr.life/api/v2",
    usdtAddress: null, // UNVERIFIED — confirm testnet USDT contract before build; do not fabricate
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

// The ONLY place this flag is set. Change this one value to switch networks.
const ACTIVE_NETWORK = "testnet"; // "testnet" | "mainnet"

export const getNetworkConfig = () => NETWORKS[ACTIVE_NETWORK];
```

Every component, contract call, and asset-scan request must call
`getNetworkConfig()` rather than importing constants directly. Add a small,
visible badge in the app header ("TESTNET" in amber, or "MAINNET" in green)
driven by the same config, so it's never ambiguous which network is live —
this is a safety feature as much as a dev convenience, since a user
accidentally interacting with mainnet while thinking they're on testnet is a
real fund-loss risk.

The testnet USDT contract address is unverified — the build AI must confirm
it against `scan.bohr.life/tokens` (or leave it explicitly null with a
visible "not available on testnet" state) rather than guessing.

---

## 4. Asset Display Panel

The setup flow (owner side) and the vault dashboard must both show the
connected wallet's holdings, not just an approval checklist. Minimum
required display:

- **Native BOT balance** — fetched via standard RPC `eth_getBalance`.
- **USDT balance** — fetched via `balanceOf` on the config's `usdtAddress`
  for the active network (skip/hide this row cleanly if testnet USDT is
  unconfirmed, don't show a broken `0` or an error state as if it's real).
- **All other ERC-20 / ERC-721 tokens held** — fetched via the Blockscout
  API (`{explorerApiBase}/addresses/{address}/tokens`, exact path to be
  confirmed against BOT Chain's live Blockscout API docs at build time; this
  was flagged unverified in the original prompt and remains so).
- Each asset row: token icon (fallback to a generic token glyph if none
  provided by the API — never fetch icons from an unlisted third-party
  source), symbol, balance, and a toggle/checkbox for "include in vault
  approval" during setup.
- Manual-paste fallback (contract address input) if the Blockscout scan
  fails or times out — same requirement as the original prompt, now made
  explicit as part of the asset panel spec, not just the setup flow.

---

## 5. Mobile & Wallet-Browser Navigation

Assume the primary usage context is a mobile wallet's in-app browser, not
desktop Chrome. Design for that first, desktop second.

- **Persistent back button** on every screen after the first, top-left,
  large enough to be a comfortable thumb target (44×44px minimum tap area).
  Never rely on the device/browser back button alone — wallet in-app
  browsers frequently suppress or mishandle it.
- **Step indicator** on multi-step flows (setup wizard, claim flow) — a
  simple "Step 2 of 5" or dot progress indicator, so users always know where
  they are and how much is left, since wallet browsers often don't show a
  URL bar or other orientation cues.
- **No hover-only interactions** — anything that reveals on `:hover` in
  desktop needs a tap-equivalent (tap to reveal, tap again to dismiss).
- **Bottom sheets over full modals** where possible — easier to dismiss
  one-handed, and avoids the "modal trapped inside a WebView with no visible
  close button" failure mode.
- **Single-column layout below ~600px width** — no side-by-side panels
  (this also fully retires the old "wizard-left, status-right" terminal
  layout, which never worked well on mobile anyway).
- **Sticky primary action button** at the bottom of the viewport on
  form-heavy screens (setup, claim) so the main CTA is always reachable
  without scrolling, especially with mobile keyboards open.
- Test the secret-phrase entry screen specifically with the mobile keyboard
  open — confirm the input field and submit button are never hidden behind
  the keyboard.

---

## 6. File/Page Structure — Do Not Ship a Single-File UI

Split the frontend into logically separate files/components rather than one
large page. Suggested structure (adjust naming to match whatever framework
is actually used, but keep the separation):

```
/config/network.js          — the one network switch (Section 3)
/lib/hashing.js             — client-side secret hashing (Section 7)
/lib/blockscout.js          — asset-scan API calls + manual-paste fallback
/components/theme/          — shared design tokens, colors, buttons, inputs
/components/DropdownSheet/  — the custom bottom-sheet/dropdown component (Section 2)
/components/AssetPanel/     — Section 4
/flows/OwnerSetup/          — multi-step wizard, one file per step
/flows/ClaimantFlow/        — lookup + secret entry + result, one file per step
/flows/Dashboard/           — active vault view, countdown, deactivation
/pages or /routes           — top-level routing only, no business logic here
```

Rationale to give the build AI explicitly: a single giant page file becomes
unauditable for security review and unmaintainable once the claimant flow,
owner flow, and dashboard all have real state — split by responsibility from
the start rather than refactoring later.

---

## 7. Security Requirements

This app handles a secret passphrase that gates real asset recovery — treat
it accordingly.

- **Secret input field** must use `type="password"` (masked by default) with
  a visible show/hide toggle — never render the raw secret in plaintext by
  default.
- The secret is hashed **client-side only**, immediately on submit, using
  the browser's native `crypto.subtle.digest` (or a single well-audited,
  pinned-version library already used elsewhere in the stack — do not add a
  new hashing package just for this). The raw secret must never be sent over
  the network, logged to the console, written to localStorage/sessionStorage,
  or included in any analytics/error-reporting payload.
- Clear the secret from component state immediately after hashing — don't
  hold it in memory longer than needed for the single hash operation.
- **No copy-to-clipboard auto-triggered on the secret field.** If a "copy"
  affordance exists anywhere secret-adjacent, it must be explicit,
  user-initiated, and never used for the raw secret itself (vault ID is fine
  to make copyable; the secret is not).
- **Dependency hygiene:** only import packages that are (a) already used
  elsewhere in this project's established stack (ethers.js/viem/wagmi,
  Reown AppKit — consistent with prior BOT Chain builds), or (b) explicitly
  approved before use. No new wallet-connection library, no new crypto
  library, no unaudited UI kit, without flagging it first. If using ESM CDN
  imports (as in the DevicePassport build), pin exact versions in the import
  URL and prefer well-known CDNs (jsDelivr, esm.sh, unpkg) — no imports from
  unfamiliar or unverifiable hosts.
- **No `eval`, no `Function()` constructor, no `dangerouslySetInnerHTML` /
  `innerHTML` assignment of anything derived from user or API input.**
- Sanitize and validate all user-entered addresses (checksum validation) and
  vault IDs before use in any contract call or API request.
- The network badge from Section 3 doubles as a safety control — mainnet
  actions should require an explicit confirmation step (e.g. a "You are
  about to interact with MAINNET, real funds" confirmation) before any
  transaction that involves the live mainnet config.

---

## 8. Vault Lookup — Primary by Owner's EVM Address

Per your decision: **vault lookup is primarily by the former owner's EVM
address**, not vault ID. Update the claimant-flow entry screen so address
lookup is the default/first field, with vault ID kept as a secondary
"advanced/exact lookup" option below it (in case an address ever maps to
multiple vaults, or as a fallback if the address-based search returns
nothing). This keeps the front-running/visibility tradeoff noted earlier
in the project — worth remembering that this is a deliberate UX choice, not
an oversight, if it comes up during security review.

The owner-initiator and claimant flow screens themselves (fields, order of
steps, wizard-style guided prompts) stay as previously agreed — only the
visual theme (Section 1), dropdown implementation (Section 2), and lookup
default (this section) change.

---

## 9. Summary of What Changed vs. Original Master Prompt

| Area | Original | This addendum |
|---|---|---|
| Visual theme | Terminal/TUI, boxed ASCII panels | Normal interactive UI, black + dark green hacker theme |
| Layout | Multi-pane (wizard left / status right) | Card-based, single-column on mobile |
| Dropdowns | Not specified | Custom bottom-sheet/div components only, no native `<select>` |
| Network config | Not specified | Single config file, one-line testnet↔mainnet switch |
| Asset display | Mocked list | Live BOT + USDT + Blockscout-scanned holdings, manual fallback |
| Mobile nav | Not specified | Persistent back button, step indicator, sticky CTA, no hover-only UI |
| File structure | Implied single build | Explicit multi-file/component split |
| Security | General mentions | Explicit password-field, client-side-only hashing, dependency whitelist, no eval/innerHTML |
| Vault lookup | VaultId-only → then address-searchable | Address is primary, vaultId is secondary/advanced |

**Instruction to build AI:** if any value marked UNVERIFIED above (testnet
USDT address, exact Blockscout API path) cannot be confirmed, ship with a
clearly labeled placeholder and a visible in-app warning rather than a
silent guess — consistent with how DevicePassport handled unconfirmed
testnet parameters.
