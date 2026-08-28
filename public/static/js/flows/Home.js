// flows/Home.js — landing screen: choose owner setup vs. claimant lookup.
import { el } from '../components/theme/ui.js';
import { navigate } from '../app.js';
import { getNetworkConfig } from '../config/network.js';

export function renderHome(container) {
  const net = getNetworkConfig();

  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('div', {}, [
        el('h1', { class: 'dmh-heading' }, "Dead Man's Hand"),
        el('p', { class: 'dmh-subheading' }, 'Decentralized crypto inheritance & emergency access on BOT Chain. Your assets stay in your own wallet — nothing moves unless a claim actually matches your secret.'),
      ]),

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, "I'm setting up a vault"),
        el('p', { class: 'dmh-hint' }, 'Connect your wallet, pick a secret + inactivity period, and choose which assets to protect.'),
        el('button', { class: 'dmh-btn dmh-btn-primary', onClick: () => navigate('setup') }, 'Set up a vault →'),
      ]),

      el('div', { class: 'dmh-card' }, [
        el('div', { class: 'dmh-card-title' }, "I'm claiming a vault"),
        el('p', { class: 'dmh-hint' }, "Look up a vault by the former owner's address, check if it's expired, and submit the secret to claim assets."),
        el('button', { class: 'dmh-btn dmh-btn-secondary', onClick: () => navigate('claim') }, 'Look up a vault →'),
      ]),

      net.faucetUrl
        ? el('div', { class: 'dmh-hint' }, [
            `On ${net.chainName}? Get test BOT from the `,
            el('a', { href: net.faucetUrl, target: '_blank', rel: 'noopener' }, 'faucet'),
            '.',
          ])
        : null,
    ])
  );
}
