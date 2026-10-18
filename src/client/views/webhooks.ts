// Every request that reached one partner's webhook URL, with how the server answered it.

import { day, fromIso, hms } from '../format.js';
import { html, type Html } from '../html.js';
import type { Partner, State, WebhookDelivery } from '../types.js';

const EVENT_LABEL: Record<string, string> = {
  'job.dispatched': 'Job dispatched',
  'job.cancelled': 'Job cancelled',
  ping: 'Test event',
};

const OUTCOME: Record<WebhookDelivery['outcome'], { tint: string; badge: Html }> = {
  processed: { tint: '', badge: html`<span class="hook-badge hb-valid">✓ Signature valid</span>` },
  duplicate: { tint: ' dup', badge: html`<span class="hook-badge hb-valid">✓ Signature valid</span><span class="hook-badge hb-dup">↺ Duplicate, ignored</span>` },
  stale: { tint: ' dup', badge: html`<span class="hook-badge hb-valid">✓ Signature valid</span><span class="hook-badge hb-dup">↺ Older version, ignored</span>` },
  rejected: { tint: ' invalid', badge: html`<span class="hook-badge hb-invalid">✕ Rejected</span>` },
};

const loading = html`<div class="card flush skeleton" aria-busy="true">
  <div class="sk-row"><span class="sk strong" style="width:200px"></span><span class="sk" style="width:320px"></span></div>
  <div class="sk-row"><span class="sk strong" style="width:160px"></span><span class="sk" style="width:280px"></span></div>
  <div class="small muted" style="padding:12px 16px">Loading activity…</div>
</div>`;

function row(h: WebhookDelivery): Html {
  const at = fromIso(h.receivedAt);
  const o = OUTCOME[h.outcome];
  const meta = [
    h.id && `delivery ${h.id}`,
    h.jobId && `job ${h.jobId}${h.version != null ? ` v${h.version}` : ''}`,
    `answered ${h.status}: ${h.detail}`,
  ].filter(Boolean).join(' · ');
  return html`<div class="hook-row${o.tint}">
    <span class="mono small">${hms(at)}</span>
    <span class="event">${EVENT_LABEL[h.event] ?? h.event}</span>
    <span class="badges">${o.badge}</span>
    <span class="micro muted">${day(at)}</span>
    <span class="meta">${meta}</span>
  </div>`;
}

export function webhooks(s: State, p: Partner): Html {
  const hooks = s.hooks.filter((h) => h.partnerId === p.id);
  return html`
    <div class="page-head baseline"><h2 class="sub-title">Webhook activity</h2><span class="small muted ml-auto">What reached ${p.webhookPath} in the last 30 days, newest first</span></div>
    <div class="hook-legend">
      <span><span class="hook-badge legend hb-valid">✓ Signature valid</span>HMAC matches our signing secret, answered 200</span>
      <span><span class="hook-badge legend hb-invalid">✕ Rejected</span>bad or old signature, answered 401; the partner retries</span>
      <span><span class="hook-badge legend hb-dup">↺ Ignored</span>a delivery seen before, or older than what we hold</span>
    </div>
    ${s.loading
      ? loading
      : hooks.length
        ? html`<div class="card flush">${hooks.map(row)}</div>`
        : html`<div class="empty-card">
            <span class="title">No messages yet</span>
            <span class="body">${p.name} has not sent anything to this portal. Messages appear here as soon as they arrive. Try <b>Send test event</b> on the Connection tab.</span>
            ${p.application && html`<span class="mono small soft">${p.application.webhookUrl}</span>`}
          </div>`}`;
}
