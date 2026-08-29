// app.js — top-level routing only, no business logic here (Section 9).
//
// Simple hash-based router: #/  #/setup  #/claim  #/dashboard/:vaultId
// A hash router (rather than pushState) is deliberately chosen because
// several mobile wallet in-app browsers mishandle history.pushState/back
// navigation (Section 8.5 rationale) — hash changes are the most reliably
// supported cross-WebView navigation primitive, and we ALSO render our own
// persistent back button rather than depending on it.

import { renderHome } from './flows/Home.js';
import { renderOwnerSetup } from './flows/OwnerSetup/index.js';
import { renderClaimantFlow } from './flows/ClaimantFlow/index.js';
import { renderDashboard } from './flows/Dashboard/index.js';
import { renderTopBar } from './components/theme/ui.js';

const root = document.getElementById('app-root');

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path, ...rest] = hash.split('/');
  return { path: path || '', params: rest };
}

export function navigate(path) {
  window.location.hash = `#/${path}`;
}

function renderApp() {
  root.replaceChildren();
  const { path, params } = parseRoute();
  const routeTitles = {
    '': "Dead Man's Hand",
    setup: "Set Up a Vault | Dead Man's Hand",
    claim: "Claim a Vault | Dead Man's Hand",
    dashboard: "Vault Dashboard | Dead Man's Hand",
  };
  document.title = routeTitles[path] || routeTitles[''];

  root.appendChild(renderTopBar(() => renderApp()));

  const content = document.createElement('main');
  content.id = 'app-content';
  root.appendChild(content);

  switch (path) {
    case '':
      renderHome(content);
      break;
    case 'setup':
      renderOwnerSetup(content);
      break;
    case 'claim':
      renderClaimantFlow(content);
      break;
    case 'dashboard':
      renderDashboard(content, params[0]);
      break;
    default:
      renderHome(content);
  }

  requestAnimationFrame(() => {
    const heading = content.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  });
}

window.addEventListener('hashchange', renderApp);
window.addEventListener('DOMContentLoaded', renderApp);
// In case DOMContentLoaded already fired before this module executed.
if (document.readyState !== 'loading') {
  renderApp();
}
