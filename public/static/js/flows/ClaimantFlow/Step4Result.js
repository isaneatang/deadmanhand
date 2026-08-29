// flows/ClaimantFlow/Step4Result.js — Step 4: Result — success (itemized) or failure (attempts/cooldown info)
import { el, renderStepIndicator, renderStickyCta, formatAddress, formatDuration } from '../../components/theme/ui.js';
import { getFailedAttempts, getVaultStatus } from '../../lib/contract.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';
import { navigate } from '../../app.js';

export async function renderStep4Result(container, state) {
  const net = getNetworkConfig();
  const r = state.result;
  const decimals = net.usdtDecimals || 6;

  const body = [];

  if (r.matched) {
    body.push(
      el('div', { style: 'text-align:center; padding: 12px 0;' }, [
        el('div', { style: 'font-size: 48px;' }, '🔓'),
        el('h1', { class: 'dmh-heading' }, 'Claim successful'),
        el('p', { class: 'dmh-subheading' }, `Fee paid: ${ethers.formatUnits(r.feePaid, decimals)} USDT.`),
      ])
    );

    if (r.succeeded.length > 0) {
      body.push(
        el('div', { class: 'dmh-card' }, [
          el('div', { class: 'dmh-card-title' }, `Assets received (${r.succeeded.length})`),
          ...r.succeeded.map((s) =>
            el('div', { class: 'dmh-asset-row' }, [
              el('div', { class: 'dmh-asset-info' }, [
                el('div', { class: 'dmh-asset-symbol mono' }, formatAddress(s.token)),
                el('div', { class: 'dmh-asset-balance mono' }, `Amount/ID: ${s.amountOrId.toString()}`),
              ]),
              el('span', { class: 'dmh-badge dmh-badge-success' }, '✓'),
            ])
          ),
        ])
      );
    }

    if (r.failed.length > 0) {
      body.push(
        el('div', { class: 'dmh-card' }, [
          el('div', { class: 'dmh-card-title' }, `Skipped (${r.failed.length}) — partial claim`),
          el('p', { class: 'dmh-hint' }, 'These specific tokens could not be transferred (e.g. a stale approval), but everything else above was still delivered.'),
          ...r.failed.map((f) =>
            el('div', { class: 'dmh-asset-row' }, [
              el('div', { class: 'dmh-asset-info' }, [
                el('div', { class: 'dmh-asset-symbol mono' }, formatAddress(f.token)),
                el('div', { class: 'dmh-asset-balance' }, f.reason),
              ]),
              el('span', { class: 'dmh-badge dmh-badge-danger' }, '✗'),
            ])
          ),
        ])
      );
    }

    if (r.succeeded.length === 0 && r.failed.length === 0) {
      body.push(el('div', { class: 'dmh-empty-state' }, 'No assets were registered to this vault.'));
    }
  } else {
    let failedAttempts = null;
    let cooldown = null;
    try {
      failedAttempts = await getFailedAttempts(state.vaultId);
      const status = await getVaultStatus(state.vaultId);
      cooldown = status.locked ? status.cooldownRemaining : null;
    } catch (_e) {
      // best-effort — result screen still shows the core outcome without this
    }

    body.push(
      el('div', { style: 'text-align:center; padding: 12px 0;' }, [
        el('div', { style: 'font-size: 48px;' }, '🔒'),
        el('h1', { class: 'dmh-heading' }, "Secret didn't match"),
        el('p', { class: 'dmh-subheading' }, `Fee charged: ${ethers.formatUnits(r.feePaid, decimals)} USDT (not refunded).`),
      ])
    );

    body.push(
      el('div', { class: 'dmh-warning-banner' }, [
        cooldown != null
          ? `This vault is now in a cooldown lockout. Try again in ${formatDuration(cooldown)}.`
          : failedAttempts != null
            ? `Failed attempts so far: ${failedAttempts}. The fee escalates with each consecutive failure, and the vault locks temporarily after enough failures.`
            : 'The fee escalates with each consecutive failure.',
      ])
    );
  }

  const transactionHash = r.receipt && (r.receipt.hash || r.receipt.transactionHash);
  if (transactionHash) {
    body.push(el('div', { class: 'dmh-card' }, [
      el('div', { class: 'dmh-card-title' }, 'Transaction'),
      el('div', { class: 'mono', style: 'font-size:12px; word-break:break-all;' }, transactionHash),
      el('a', { class: 'dmh-btn dmh-btn-secondary', href: `${net.explorerUrl}/tx/${transactionHash}`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'View claim transaction in block explorer (opens in a new tab)' }, 'View in explorer'),
    ]));
  }

  container.appendChild(renderStepIndicator(4, 4));
  container.appendChild(el('div', { class: 'dmh-main' }, body));

  const doneBtn = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Back to home');
  doneBtn.addEventListener('click', () => navigate(''));
  container.appendChild(renderStickyCta(doneBtn));
}
