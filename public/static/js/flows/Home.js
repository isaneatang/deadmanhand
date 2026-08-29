// flows/Home.js — landing screen: choose owner setup vs. claimant lookup.
import { el } from '../components/theme/ui.js';
import { navigate } from '../app.js';
import { getNetworkConfig } from '../config/network.js';

export function renderHome(container) {
  const net = getNetworkConfig();

  container.appendChild(
    el('div', { class: 'dmh-main' }, [
      el('section', { class: 'dmh-hero' }, [
        el('div', { class: 'dmh-eyebrow mono' }, [el('span', { class: 'dmh-live-dot' }), 'NON-CUSTODIAL RECOVERY PROTOCOL']),
        el('h1', { class: 'dmh-heading dmh-hero-title' }, ["A dead man's switch ", el('span', {}, 'for digital assets.')]),
        el('p', { class: 'dmh-subheading dmh-hero-copy' }, 'Create a recovery path without transferring custody. Your assets remain in your wallet until the inactivity rule is met and the correct secret is submitted.'),
        el('div', { class: 'dmh-trust-row' }, [
          el('span', {}, 'No deposits'),
          el('span', {}, 'Owner-controlled'),
          el('span', {}, net.chainName),
        ]),
      ]),

      el('div', { class: 'dmh-path-grid' }, [
        el('section', { class: 'dmh-card dmh-path-card primary' }, [
          el('div', { class: 'dmh-path-index mono' }, '01 / OWNER'),
          el('h2', { class: 'dmh-path-title' }, 'Protect a wallet'),
          el('p', { class: 'dmh-subheading' }, 'Set an inactivity window, commit a strong secret, then approve only the token contracts you choose.'),
          el('button', { class: 'dmh-btn dmh-btn-primary', onClick: () => navigate('setup') }, 'Create a vault'),
        ]),
        el('section', { class: 'dmh-card dmh-path-card' }, [
          el('div', { class: 'dmh-path-index mono' }, '02 / CLAIMANT'),
          el('h2', { class: 'dmh-path-title' }, 'Find a recovery vault'),
          el('p', { class: 'dmh-subheading' }, "Look up the owner's address, inspect vault status and fees, then claim when the inactivity window has elapsed."),
          el('button', { class: 'dmh-btn dmh-btn-secondary', onClick: () => navigate('claim') }, 'Look up a vault'),
        ]),
      ]),

      el('section', { class: 'dmh-protocol-strip', 'aria-label': 'How the protocol works' }, [
        el('div', {}, [el('strong', { class: 'mono' }, '01'), el('span', {}, 'Commit an inactivity rule')]),
        el('div', {}, [el('strong', { class: 'mono' }, '02'), el('span', {}, 'Approve selected assets')]),
        el('div', {}, [el('strong', { class: 'mono' }, '03'), el('span', {}, 'Check in before expiry')]),
      ]),

      net.faucetUrl
        ? el('div', { class: 'dmh-faucet-note' }, [
            `On ${net.chainName}? Get test BOT from the `,
            el('a', { href: net.faucetUrl, target: '_blank', rel: 'noopener' }, 'faucet'),
            '.',
          ])
        : null,
    ])
  );
}
