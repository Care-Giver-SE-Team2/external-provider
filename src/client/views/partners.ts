// Partners: the companies that send BrightHands work. They are data: added here, with no code, as long as they
// speak a protocol the server has a connector for. Each has a page of its own.

import { busyButton, badge, html, type Html } from '../html.js';
import { connectionScreen, isConnected, partnerHref } from '../model.js';
import type { ApplicationStatus, BadgeColour, Partner, PartnerForm, State } from '../types.js';

const APP_STATUS: Record<Exclude<ApplicationStatus, 'approved'>, [BadgeColour, string]> = {
  none: ['declined', 'Not applied'],
  pending: ['pending', 'Application pending'],
  rejected: ['cancelled', 'Rejected'],
};

/** How far along a partner is. Approved is not yet connected: that takes credentials the partner accepts. */
export function partnerStatus(p: Partner): [BadgeColour, string] {
  if (p.app !== 'approved') return APP_STATUS[p.app];
  if (isConnected(p)) return ['completed', 'Connected'];
  if (!p.credentials) return ['pending', 'Needs credentials'];
  return p.conn === 'unknown' ? ['pending', 'Approved'] : ['cancelled', 'Connection failing'];
}

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

const tile = (name: string, big = false): Html => html`<span class="partner-tile${big ? ' lg' : ''}" aria-hidden="true">${initials(name)}</span>`;

export function partners(s: State): Html {
  const count = (p: Partner) => s.jobs.filter((j) => j.partnerId === p.id).length;
  return html`
    <div class="page-head">
      <h1>Partners</h1><span class="small muted">Companies that send BrightHands work</span>
      <a class="btn btn-primary ml-auto" href="#/partners/new">Add partner</a>
    </div>
    ${s.partners.length
      ? html`<div class="card flush">
          <div class="t-head cols-partners"><span>Partner</span><span>How jobs arrive</span><span>Jobs</span><span>Status</span><span></span></div>
          ${s.partners.map((p) => html`<div class="t-row cols-partners">
            <span class="partner-name">${tile(p.name)}<span class="t-cell"><b>${p.name}</b><span class="small muted mono">${p.baseUrl}</span></span></span>
            <span class="t-cell"><span class="t-15">${p.protocolName}</span><span class="small muted">API and webhooks</span></span>
            <span class="tnum">${isConnected(p) ? count(p) : '—'}</span>
            <span>${badge(...partnerStatus(p))}</span>
            <span class="cta"><a class="btn btn-secondary btn-md" href="${partnerHref(p)}">${isConnected(p) ? 'Manage' : 'Set up'}</a></span>
          </div>`)}
        </div>`
      : html`<div class="empty-card" style="padding:40px 24px;gap:10px">
          <span class="title">No partners yet</span>
          <span class="body">Add the companies that send BrightHands work. A partner needs no code here, only its details and, in the server’s .env, its credentials.</span>
          <a class="btn btn-primary" style="margin-top:6px" href="#/partners/new">Add partner</a>
        </div>`}`;
}

// ---------- Adding one ----------

function field(s: State, key: keyof PartnerForm, label: string, placeholder: string, help: string): Html {
  const err = s.partnerErrs[key];
  return html`<div class="field">
    <label class="field-label" for="p-${key}">${label}</label>
    <input id="p-${key}" class="input${err ? ' invalid' : ''}${key === 'baseUrl' || key === 'id' ? ' mono' : ''}" value="${s.partnerForm[key]}"
      placeholder="${placeholder}" autocomplete="off" spellcheck="false" data-input="partnerForm.${key}"
      ${err ? html`aria-invalid="true" aria-describedby="pe-${key}"` : ''} />
    ${err ? html`<span class="field-error" id="pe-${key}">${err}</span>` : html`<span class="help">${help}</span>`}
  </div>`;
}

export function addPartner(s: State): Html {
  const prefix = `PARTNER_${(s.partnerForm.id || 'id').toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;
  return html`
    <a class="link-back" href="#/partners">← Partners</a>
    <div class="narrow" style="gap:18px">
      <div class="intro"><h1>Add a partner</h1>
        <p class="muted">Any partner whose API this portal has a connector for can be added here, with no code.</p></div>
      ${s.partnerErr && html`<div class="banner banner-error" role="alert">${s.partnerErr}</div>`}
      <form class="card" data-form="partner" novalidate style="gap:16px">
        ${field(s, 'name', 'Name', 'CareLink', 'As staff see it.')}
        ${field(s, 'id', 'ID', 'carelink', 'Lowercase letters, digits and dashes. It names the partner’s settings and webhook URL, and cannot change.')}
        <div class="field">
          <label class="field-label" for="p-protocol">Protocol</label>
          <select id="p-protocol" class="input${s.partnerErrs.protocol ? ' invalid' : ''}" data-input="partnerForm.protocol">
            ${s.protocols.map((p) => html`<option value="${p.id}" ${p.id === s.partnerForm.protocol ? 'selected' : ''}>${p.name}</option>`)}
          </select>
          ${s.partnerErrs.protocol
            ? html`<span class="field-error">${s.partnerErrs.protocol}</span>`
            : html`<span class="help">The API the partner speaks. A partner with another API needs its connector written first.</span>`}
        </div>
        ${field(s, 'baseUrl', 'Address', 'https://api.partner.sg', 'Where its API is. Locally, CareLink’s is http://localhost:5173.')}
        <div class="panel shaded" style="gap:6px">
          <span class="small" style="font-weight:600">Its credentials go in the server’s .env, not here</span>
          <pre class="mono small" style="margin:0;white-space:pre-wrap">${prefix}CLIENT_ID=\n${prefix}CLIENT_SECRET=\n${prefix}WEBHOOK_SECRET=</pre>
          <span class="small muted">The server reads .env again when it changes. A partner one applies to through its API can leave them empty: the server collects them once approved.</span>
        </div>
        <div class="actions">
          ${busyButton({ action: 'addPartner', label: 'Add partner', busyLabel: 'Adding…', busy: s.busy === 'addPartner' })}
          <a class="btn btn-secondary" href="#/partners">Cancel</a>
        </div>
      </form>
    </div>`;
}

// ---------- One partner's page ----------

/** A partner's page: a header and sub-tabs around its application, connection and webhook screens. */
export function partnerPage(s: State, p: Partner, body: Html): Html {
  const onWebhooks = s.screen === 'webhooks';
  const tab = (label: string, on: boolean, href: string, extra: Html | string = ''): Html =>
    html`<a class="tab${on ? ' active' : ''}" href="${href}" ${extra} ${on && html`aria-current="page"`}>${label}</a>`;
  const first = connectionScreen(p);

  return html`
    <a class="link-back" href="#/partners">← Partners</a>
    <div class="page-head" style="gap:14px">
      ${tile(p.name, true)}
      <div class="t-cell"><h1>${p.name}</h1><span class="small muted">${p.protocolName} · <span class="mono">${p.baseUrl}</span></span></div>
      <span class="ml-auto">${badge(...partnerStatus(p))}</span>
    </div>
    <nav class="tabs" aria-label="${p.name}">
      ${p.app === 'approved'
        ? [
            tab('Connection', !onWebhooks, partnerHref(p)),
            tab('Webhook activity', onWebhooks, partnerHref(p, 'webhooks')),
            tab(`Jobs from ${p.name}`, false, '#/jobs', html`data-action="jobsFrom" data-id="${p.id}"`),
          ]
        : tab(first === 'connection' ? 'Connection' : 'Application', true, partnerHref(p))}
    </nav>
    ${body}`;
}
