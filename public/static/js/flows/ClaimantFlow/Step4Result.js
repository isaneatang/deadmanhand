import { el, renderStepIndicator, renderStickyCta, formatAddress } from '../../components/theme/ui.js';
import { getNetworkConfig } from '../../config/network.js';
import { ethers } from '../../lib/ethers.js';
import { navigate } from '../../app.js';

export async function renderStep4Result(container, state) {
  const net = getNetworkConfig(), r = state.result, decimals = net.usdtDecimals || 6;
  const body = [el('div', { style: 'text-align:center; padding: 12px 0;' }, [
    el('h1', { class: 'dmh-heading' }, r.matched ? 'Claim submitted successfully' : 'Claim was not accepted'),
    el('p', { class: 'dmh-subheading' }, `Fee paid: ${ethers.formatUnits(r.feePaid, decimals)} USDT.`),
  ])];
  body.push(el('dl', { class: 'dmh-card' }, [
    el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Signed recipient'), el('dd', { class: 'mono' }, formatAddress(r.recipient))]),
    el('div', {}, [el('dt', { class: 'dmh-card-title' }, 'Fee payer'), el('dd', { class: 'mono' }, formatAddress(r.feePayer))]),
  ]));
  if (r.succeeded.length) body.push(el('div', { class: 'dmh-card' }, [el('div', { class: 'dmh-card-title' }, `Assets received (${r.succeeded.length})`), ...r.succeeded.map((s) => el('div', { class: 'dmh-asset-row' }, [el('div', { class: 'dmh-asset-info' }, [el('div', { class: 'dmh-asset-symbol mono' }, formatAddress(s.token)), el('div', { class: 'dmh-asset-balance mono' }, `Amount/ID: ${s.amountOrId}`)]), el('span', { class: 'dmh-badge dmh-badge-success' }, 'Completed')]))]));
  if (r.failed.length) body.push(el('div', { class: 'dmh-warning-banner' }, [
    el('strong', {}, `${r.failed.length} asset transfer(s) were not recovered. This one-time vault cannot retry them.`),
    ...r.failed.map((failure) => el('div', { class: 'dmh-asset-row' }, [
      el('span', { class: 'mono' }, formatAddress(failure.token)),
      el('span', {}, failure.reason),
    ])),
  ]));
  const hash = r.receipt && (r.receipt.hash || r.receipt.transactionHash);
  if (hash) body.push(el('div', { class: 'dmh-card' }, [el('div', { class: 'dmh-card-title' }, 'Transaction'), el('div', { class: 'mono', style: 'font-size:12px; word-break:break-all;' }, hash), el('a', { class: 'dmh-btn dmh-btn-secondary', href: `${net.explorerUrl}/tx/${hash}`, target: '_blank', rel: 'noopener noreferrer' }, 'View in explorer')]));
  container.appendChild(renderStepIndicator(4, 4)); container.appendChild(el('div', { class: 'dmh-main' }, body));
  const done = el('button', { class: 'dmh-btn dmh-btn-primary' }, 'Back to home'); done.addEventListener('click', () => navigate('')); container.appendChild(renderStickyCta(done));
}
