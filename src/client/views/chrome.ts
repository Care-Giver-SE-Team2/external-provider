import { html, type Html } from '../html.js';
import { PARTNER_SCREENS, connectedPartners, jobsIn } from '../model.js';
import type { Screen, State } from '../types.js';

type NavKey = 'overview' | 'jobs' | 'customers' | 'schedule' | 'staff' | 'services' | 'billing' | 'partners';

/** No partner has a tab of its own. Each is one partner under Partners. */
const NAV: readonly [label: string, key: NavKey][] = [
  ['Overview', 'overview'],
  ['Jobs', 'jobs'],
  ['Customers', 'customers'],
  ['Schedule', 'schedule'],
  ['Staff', 'staff'],
  ['Services', 'services'],
  ['Billing', 'billing'],
  ['Partners', 'partners'],
];

/** The nav item a screen sits under. */
const navOf = (screen: Screen): Screen => (screen === 'customer' ? 'customers' : PARTNER_SCREENS.has(screen) || screen === 'partnerNew' ? 'partners' : screen);

export function appBar(s: State): Html {
  const connected = connectedPartners(s);
  const pill = connected.length === 1 ? `Connected to ${connected[0].name}` : connected.length ? `${connected.length} partners connected` : 'No partner connected';
  const active = navOf(s.screen);
  const newCount = jobsIn(s, 'new', true).length;
  const name = s.user?.name ?? '';
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return html`<header>
    <div class="appbar-top">
      <div class="brand">
        <div class="logo" aria-hidden="true"></div>
        <div class="stack"><span class="wordmark">BrightHands</span><span class="on-dark-sub">Provider Portal</span></div>
      </div>
      <div class="cl-pill"><span class="cl-dot${connected.length ? ' on' : ''}"></span>${pill}</div>
      ${s.loggedIn &&
      html`<div class="user">
        <div class="avatar" aria-hidden="true">${initials}</div>
        <div class="stack"><span class="user-name">${name}</span><span class="on-dark-sub">${s.user?.role}</span></div>
        <button type="button" class="btn-ghost" data-action="logout">Log out</button>
      </div>`}
    </div>
    ${s.loggedIn &&
    html`<nav class="appnav" aria-label="Main">
      ${NAV.map(([label, key]) => {
        const count = key === 'jobs' && newCount > 0 && html`<span class="nav-count" aria-label="${newCount} new">${newCount}</span>`;
        return html`<a class="nav-item${key === active ? ' active' : ''}" href="#/${key}"
          ${key === active && html`aria-current="page"`}>${label}${count}</a>`;
      })}
    </nav>`}
  </header>`;
}

export const toast = (s: State): Html | null =>
  s.toast && html`<div class="banner banner-${s.toast.kind}" role="status">${s.toast.text}</div>`;
