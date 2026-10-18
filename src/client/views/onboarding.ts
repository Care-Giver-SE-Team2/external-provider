// Joining a partner: apply, follow the application, then the connection the server keeps. Written for partners
// speaking CareLink's Open Platform protocol; nothing here names any one partner.

import { CARELINK_SERVICES } from '../carelink.js';
import { fromIso, when, whenSeconds } from '../format.js';
import { badge, busyButton, html, type Html } from '../html.js';
import { connectionScreen, partnerHref, webhookUrlFor } from '../model.js';
import type { ApplicationStatus, BadgeColour, ConnectionState, Partner, State, TextField } from '../types.js';

/** Webhook activity before BrightHands is an approved provider. */
export function gated(p: Partner, title: string): Html {
  const body =
    p.app === 'none'
      ? `${p.name}’s jobs and the messages it sends appear here once BrightHands is an approved provider. Apply first.`
      : `Your application is with ${p.name}. Jobs appear here once it is approved.`;
  return html`<h2 class="sub-title">${title}</h2>
    <div class="empty-card" style="padding:40px 24px;gap:10px">
      <span class="title">Not connected to ${p.name} yet</span>
      <span class="body">${body}</span>
      <a class="btn btn-primary" style="margin-top:6px" href="${partnerHref(p)}">${connectionScreen(p) === 'apply' ? 'Apply' : 'View application'}</a>
    </div>`;
}

const errorBanner = (text: string | null): Html | null => (text ? html`<div class="banner banner-error" role="alert">${text}</div>` : null);

// ---------- Apply ----------

function field(s: State, key: TextField, label: string, placeholder: string, help?: string, type = 'text', autocomplete = 'off'): Html {
  const err = s.errs[key];
  return html`<div class="field">
    <label class="field-label" for="f-${key}">${label}</label>
    <input id="f-${key}" class="input${err ? ' invalid' : ''}" type="${type}" value="${s.form[key]}" placeholder="${placeholder}"
      autocomplete="${autocomplete}" data-input="form.${key}" ${err ? html`aria-invalid="true" aria-describedby="e-${key}"` : ''} />
    ${err ? html`<span class="field-error" id="e-${key}">${err}</span>` : help ? html`<span class="help">${help}</span>` : ''}
  </div>`;
}

export function apply(s: State, p: Partner): Html {
  const errCount = Object.values(s.errs).filter(Boolean).length;
  return html`<div class="narrow" style="gap:18px">
    ${settingsCard(p, 'Already have credentials?')}
    ${portalSignIn(s, p, `Already applied, here or on ${p.name}’s own site? Sign in and this portal picks up the application, so there is no need to apply again.`, 'Already applied?')}
    <div class="intro"><h2 class="sub-title">Apply to become a ${p.name} provider</h2><p class="muted">Connect BrightHands to ${p.name} to receive its jobs.</p></div>
    ${errCount
      ? html`<div class="banner banner-error" role="alert"><b>${errCount === 1 ? '1 field needs' : `${errCount} fields need`} fixing</b> before you can submit.</div>`
      : ''}
    ${s.submitErr && html`<div class="banner banner-error" role="alert"><b>${p.name} did not take the application.</b> ${s.submitErr} Your answers are kept.</div>`}
    <form class="card" data-form="apply" novalidate>
      <h2>Company</h2>
      <div class="form-grid">${field(s, 'company', 'Company name', 'BrightHands Home Services Pte. Ltd.', undefined, 'text', 'organization')}</div>
      <h2 class="section-title">Contact</h2>
      <div class="form-grid">
        ${field(s, 'name', 'Contact name', 'Full name', undefined, 'text', 'name')}
        ${field(s, 'email', 'Contact email', 'name@company.sg', `Also your sign-in to ${p.name}’s portal.`, 'email', 'email')}
        ${field(s, 'phone', 'Contact phone', '+65 9123 4567', undefined, 'tel', 'tel')}
        ${field(s, 'password', 'Portal password', 'At least 8 characters', `For ${p.name}’s portal. ${p.name} keeps only a hash of it; this portal does not keep it at all.`, 'password', 'new-password')}
      </div>
      <fieldset style="border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:12px"
        ${s.errs.services ? html`aria-describedby="e-services"` : ''}>
        <legend class="section-title" style="padding:0;margin-bottom:12px"><h2>Services offered</h2></legend>
        <div class="chips">
          ${CARELINK_SERVICES.map((name) => {
            const on = s.form.services.includes(name);
            return html`<label class="chip${on ? ' on' : s.errs.services ? ' invalid' : ''}">
              <input type="checkbox" data-check="service" value="${name}" ${on ? 'checked' : ''} />${name}</label>`;
          })}
        </div>
        ${s.errs.services ? html`<span class="field-error" id="e-services">${s.errs.services}</span>` : ''}
      </fieldset>
      <h2 class="section-title">Webhook</h2>
      ${field(s, 'webhookUrl', 'Webhook URL', `https://portal.example.sg${p.webhookPath}`,
        `Where ${p.name} sends new and cancelled jobs, signed: this portal’s address with ${p.webhookPath}. HTTPS in production; locally, a partner in Docker reaches this machine at host.docker.internal.`)}
      <div class="form-foot">
        <label class="check"><input id="f-terms" type="checkbox" data-check="terms" ${s.form.terms ? 'checked' : ''}
          ${s.errs.terms ? html`aria-invalid="true" aria-describedby="e-terms"` : ''} />
          <span>I accept ${p.name}’s provider terms and data-handling policy.</span></label>
        ${s.errs.terms ? html`<span class="field-error" id="e-terms">${s.errs.terms}</span>` : ''}
      </div>
      <div class="actions">
        ${busyButton({ action: 'submitApplication', label: 'Submit application', busyLabel: 'Submitting…', busy: s.busy === 'submit' })}
      </div>
    </form>
  </div>`;
}

// ---------- Signing in to the partner's portal ----------

/** The partner's portal sign-in, through the server: needed to check the application and collect credentials. */
function portalSignIn(s: State, p: Partner, why: string, title = `Sign in to ${p.name}’s portal`): Html {
  const busy = s.busy === 'portal';
  return html`<form class="panel outline" data-form="portal" novalidate style="display:flex;flex-direction:column;gap:12px">
    <h3>${title}</h3>
    <p class="soft" style="font-size:15px;margin:0">${why} Use the contact email and password from the application.</p>
    ${errorBanner(s.portalErr)}
    <div class="panel-grid">
      <div class="field"><label class="field-label" for="portal-email">Email</label>
        <input id="portal-email" class="input" type="email" autocomplete="username" value="${s.portalEmailInput}" data-input="portalEmailInput" /></div>
      <div class="field"><label class="field-label" for="portal-password">Password</label>
        <input id="portal-password" class="input" type="password" autocomplete="current-password" /></div>
    </div>
    <div><button type="submit" class="btn btn-primary${busy ? ' busy' : ''}" aria-busy="${String(busy)}" ${busy && 'disabled'}>
      ${busy ? 'Signing in…' : `Sign in to ${p.name}`}</button></div>
  </form>`;
}

// ---------- Application status ----------

const APP_BADGE: Record<Exclude<ApplicationStatus, 'none'>, [BadgeColour, string]> = {
  pending: ['pending', 'Pending review'],
  approved: ['completed', 'Approved'],
  rejected: ['cancelled', 'Rejected'],
};

export function status(s: State, p: Partner): Html {
  const a = p.application;
  if (!a || p.app === 'none') return html``;
  return html`<div class="narrow" style="gap:18px">
    <h2 class="sub-title">Application status</h2>
    <div class="card" style="gap:16px">
      <dl class="dl" style="grid-template-columns:150px 1fr">
        <dt>Application ID</dt><dd class="mono">${a.id}</dd>
        <dt>Submitted</dt><dd>${when(fromIso(a.submittedAt))}</dd>
        <dt>Contact</dt><dd>${a.contactEmail}</dd>
        <dt>Services</dt><dd>${a.services.join(', ')}</dd>
        <dt>Status</dt><dd>${badge(...APP_BADGE[p.app], { dot: true })}</dd>
        ${a.reviewedAt ? html`<dt>Decided</dt><dd>${when(fromIso(a.reviewedAt))}</dd>` : ''}
      </dl>
      ${p.app === 'pending' && p.portal
        ? html`<p class="soft">${p.name} is reviewing your application. Check for an update at any time.</p>
          <div class="actions">
            ${busyButton({ action: 'checkStatus', label: 'Check status', busyLabel: 'Checking…', busy: s.busy === 'check' })}
            ${p.lastChecked ? html`<span class="small muted">Last checked ${whenSeconds(p.lastChecked)}</span>` : ''}
          </div>`
        : ''}
      ${p.app === 'rejected'
        ? html`<div style="display:flex;flex-direction:column;gap:6px;padding:14px 16px;background:#F7F5F2;border-radius:6px">
            <span class="small muted" style="font-weight:600">Reason from ${p.name}</span><span>“${a.reason ?? 'No reason given.'}”</span>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-action="applyAgain">Apply again</button>
            <span class="small muted">Your previous answers will be filled in, apart from the password.</span>
          </div>`
        : ''}
    </div>
    ${errorBanner(p.checkErr)}
    ${p.app === 'pending' && !p.portal ? portalSignIn(s, p, `To see whether ${p.name} has decided, sign in.`) : ''}
  </div>`;
}

// ---------- Connection ----------

function connectionStatus(s: State, p: Partner): Html {
  const views: Record<ConnectionState, { label: string; color: string; dot: string }> = {
    unknown: { label: 'Not tested yet', color: '#5C554E', dot: '#A39B92' },
    connected: { label: 'Connected', color: '#1A6B3D', dot: '#22844C' },
    token_error: { label: 'Token refused', color: '#A3231A', dot: '#C5362A' },
    unreachable: { label: `${p.name} unreachable`, color: '#A3231A', dot: '#C5362A' },
    suspended: { label: `Suspended by ${p.name}`, color: '#A3231A', dot: '#C5362A' },
  };
  const v = views[p.credentials ? p.conn : 'unknown'];
  return html`<section class="card" style="flex:2 1 280px;gap:14px">
    <h2>Connection status</h2>
    <div style="display:flex;align-items:center;gap:10px;font-size:18px;font-weight:600;color:${v.color}">
      <span style="width:12px;height:12px;border-radius:50%;background:${v.dot}"></span>${v.label}
    </div>
    ${p.connMsg ? html`<div class="banner ${p.conn === 'connected' ? 'banner-success' : 'banner-error'}" role="status">${p.connMsg}</div>` : ''}
    ${p.lastTest ? html`<div class="stack" style="gap:2px;line-height:1.5"><span class="small muted">Last token fetched</span><span>${whenSeconds(p.lastTest.at)} (${p.lastTest.ms} ms)</span></div>` : ''}
    <div>${busyButton({ action: 'testConnection', label: 'Test connection', busyLabel: 'Testing…', busy: s.busy === 'test', kind: 'secondary' })}</div>
  </section>`;
}

/** The settings this partner reads from the server's .env: which are set, never their values. */
function settingsCard(p: Partner, title = 'Settings in the server’s .env'): Html {
  const missing = p.settings.filter((x) => !x.set).length;
  return html`<section class="card" style="gap:12px">
    <h2>${title}</h2>
    <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px">
      ${p.settings.map((x) => html`<li style="display:flex;gap:10px;align-items:center">
        <span style="width:20px;color:${x.set ? '#1A6B3D' : '#8A827A'}" aria-hidden="true">${x.set ? '✓' : '○'}</span>
        <span class="mono small">${x.name}</span><span class="small muted">${x.set ? 'set' : 'not set'}</span></li>`)}
    </ul>
    <span class="small muted">${missing && !p.credentials
      ? `Put ${p.name}’s credentials here, in .env next to package.json; the server reads it again when it changes.${p.canApply ? ' Or leave them empty: the server collects them once the application is approved.' : ''}`
      : missing
        ? 'The credentials in use were collected from the partner, so these can stay empty.'
        : 'These win over credentials collected from the partner.'}</span>
    <div class="field"><span class="field-label">Webhook URL to give ${p.name}</span>
      <div class="secret-box shaded mono">${webhookUrlFor(p)}</div></div>
  </section>`;
}

function webhookCard(s: State, p: Partner): Html {
  const a = p.application;
  const busy = s.busy === 'webhookUrl';
  return html`<section class="card" style="gap:14px">
    <h2>Webhook</h2>
    <div class="field"><label class="field-label" for="webhook-url">Where ${p.name} sends jobs</label>
      <input id="webhook-url" class="input mono" value="${s.webhookUrlInput || a?.webhookUrl || ''}" data-input="webhookUrlInput" /></div>
    ${s.webhookMsg && html`<div class="banner ${s.webhookMsg.kind === 'success' ? 'banner-success' : 'banner-error'}" role="status">${s.webhookMsg.text}</div>`}
    ${p.portal
      ? html`<div class="actions" style="gap:10px">
          ${busyButton({ action: 'saveWebhookUrl', label: 'Save URL', busyLabel: 'Saving…', busy, kind: 'secondary' })}
          ${busyButton({ action: 'sendTestEvent', label: 'Send test event', busyLabel: `Asking ${p.name}…`, busy: s.busy === 'ping', kind: 'secondary' })}
          <span class="small muted">The test event shows under Webhook activity once it arrives.</span>
        </div>`
      : html`<span class="small muted">To change it or send a test event, sign in to ${p.name}’s portal below.</span>`}
  </section>`;
}

function removeCard(s: State, p: Partner): Html {
  return html`<section class="card" style="gap:10px">
    <h2>Remove ${p.name}</h2>
    ${s.confirmRemove
      ? html`<p class="soft" style="margin:0">Its jobs disappear from this portal and its webhooks are refused. Its data stays on the server, so adding it again with the ID <span class="mono">${p.id}</span> picks up where it was. Nothing changes at ${p.name}.</p>
        <div class="actions" style="gap:10px">
          ${busyButton({ action: 'removePartner', label: `Remove ${p.name}`, busyLabel: 'Removing…', busy: s.busy === 'removePartner', kind: 'danger' })}
          <button type="button" class="btn btn-secondary" data-action="keepPartner">Keep it</button>
        </div>`
      : html`<div><button type="button" class="btn btn-secondary" data-action="askRemovePartner">Remove partner…</button></div>`}
  </section>`;
}

export function connection(s: State, p: Partner): Html {
  const a = p.application;
  const c = p.credentials;
  const credentials = c
    ? html`<div class="field"><span class="field-label">Client ID</span><div class="secret-box shaded mono">${c.clientId}</div></div>
      <div class="banner banner-success" role="status">
        The client secret and ${c.webhookSecrets === 1 ? 'the webhook signing secret are' : `${c.webhookSecrets} webhook signing secrets are`} kept on
        this portal’s server${c.source === 'settings' ? ', from its settings' : `, collected from ${p.name} ${c.collectedAt ? when(fromIso(c.collectedAt)) : ''}`}.
        They are never shown in the browser.
      </div>`
    : p.credentialsLost
      ? html`<div class="banner banner-warning" role="alert"><b>${p.name} already handed the credentials out once, not to this server.</b>
          Put them in .env (below), or issue new ones: the old client secret stops working at once, and the old signing secret a day later.</div>
        <div>${busyButton({ action: 'reissueCredentials', label: 'Issue new credentials', busyLabel: 'Issuing…', busy: s.busy === 'reissue' })}</div>`
      : p.canApply && p.app === 'approved' && p.application
        ? html`<p class="soft">${p.name} approved BrightHands. Sign in to ${p.name}’s portal below and this portal’s server collects the credentials itself, or put them in .env.</p>`
        : html`<p class="soft">No credentials yet. Put the ones ${p.name} gave you in the server’s .env, under the names below.</p>`;

  return html`<div style="display:flex;flex-direction:column;gap:18px">
    ${a?.suspended ? html`<div class="banner banner-error" role="alert"><b>${p.name} has suspended BrightHands.</b> No jobs, tokens or webhooks until it is reinstated.</div>` : ''}
    <div class="row-wrap">
      <section class="card" style="flex:3 1 420px;gap:14px">
        <h2>API credentials</h2>
        ${credentials}
        ${a ? html`<dl class="dl divided" style="grid-template-columns:150px 1fr;gap:6px 12px;font-size:15px;padding-top:12px">
            ${a.reviewedAt ? html`<dt>Provider since</dt><dd>${when(fromIso(a.reviewedAt))}</dd>` : ''}
            <dt>Services listed</dt><dd>${a.services.join(', ')}</dd>
            <dt>Application</dt><dd class="mono">${a.id}</dd>
          </dl>` : ''}
      </section>
      ${connectionStatus(s, p)}
    </div>
    ${settingsCard(p)}
    ${a && webhookCard(s, p)}
    ${p.canApply
      ? p.portal
        ? html`<p class="small muted">Signed in to ${p.name}’s portal as ${p.portal.email} for an hour.</p>`
        : portalSignIn(s, p, c ? 'To change the webhook or send a test event, sign in.' : 'To collect the credentials, or pick up an application made elsewhere, sign in.')
      : ''}
    ${removeCard(s, p)}
  </div>`;
}
