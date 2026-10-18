// Jobs from every partner: a list by status beside the selected job.

import { DECLINE_REASONS } from '../carelink.js';
import { durationLong, durationShort, hm, now, received, schedule, when } from '../format.js';
import { badge, busyButton, html, type Html } from '../html.js';
import { currentJob, isApproved, jobsIn } from '../model.js';
import type { Job, JobStatus, State, Tab } from '../types.js';

const TABS: readonly [Tab, string][] = [
  ['new', 'New'],
  ['accepted', 'Accepted'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
];

const EMPTY: Record<Tab, [title: string, body: string]> = {
  new: ['No new jobs', 'When a partner sends a job, it appears here straight away, by webhook.'],
  accepted: ['No accepted jobs', 'Accept a job from the New tab.'],
  completed: ['No completed jobs yet', 'Jobs you report as done appear here.'],
  cancelled: ['No cancelled or declined jobs', 'Jobs a partner cancels, or that you decline, appear here.'],
};

const DOT: Record<JobStatus, string> = { new: '#6D4BC4', accepted: '#2468B5', completed: '#22844C', cancelled: '#C5362A', declined: '#7D766E' };

const loadingList = html`<div class="card flush skeleton" aria-busy="true">
  <div class="sk-row"><span class="sk" style="width:90px"></span><span class="sk strong" style="width:180px"></span><span class="sk" style="width:240px"></span></div>
  <div class="sk-row"><span class="sk" style="width:90px"></span><span class="sk strong" style="width:150px"></span></div>
  <div class="small muted" style="padding:12px 16px">Loading jobs from partners…</div>
</div>`;

const partnerName = (s: State, id: string): string => s.partners.find((p) => p.id === id)?.name ?? id;

/** All partners, or one: only the partners BrightHands is approved by can send jobs. */
function sourcePills(s: State): Html {
  const keys = ['all', ...s.partners.filter(isApproved).map((p) => p.id)];
  if (keys.length < 3) return html``;
  return html`<div class="toolbar" style="gap:8px">
    ${keys.map((k) => html`<button type="button" class="pill${s.srcFilter === k ? ' on' : ''}" data-action="srcFilter" data-key="${k}"
      aria-pressed="${String(s.srcFilter === k)}">${k === 'all' ? 'All partners' : partnerName(s, k)}</button>`)}
  </div>`;
}

function jobRow(s: State, j: Job, selected: boolean): Html {
  return html`<button type="button" class="job-row${selected ? ' selected' : ''}" data-action="selectJob" data-id="${j.id}"
    aria-current="${String(selected)}">
    <span class="top">
      <span class="id">${j.id}</span>
      ${j.fresh ? html`<span class="badge sm fresh">Just arrived</span>` : ''}
      <span class="src-tag cl">${j.source}</span>
      ${s.tab === 'cancelled' ? badge(j.status, undefined, { small: true }) : ''}
      <span class="rcv${j.fresh ? ' fresh' : ''}">Received ${received(j.received)}</span>
    </span>
    <span class="svc">${j.service}</span>
    <span class="small soft">${schedule(j.start, j.dur)} · ${durationShort(j.dur)}</span>
    <span class="small muted">${j.district}${j.carelink?.respondBy && j.status === 'new' ? ` · answer by ${when(j.carelink.respondBy)}` : ''}</span>
  </button>`;
}

interface Step {
  label: string;
  sub?: string;
  color: string;
  fill: string;
  text: string;
  weight: number;
}

function timeline(j: Job): Html {
  const steps: Step[] = j.timeline.map((e) => ({
    label: e.label,
    sub: when(e.at) + (e.sub ? ` · ${e.sub}` : ''),
    color: DOT[e.status],
    fill: DOT[e.status],
    text: e.status === 'cancelled' ? '#A3231A' : '#1F1B17',
    weight: 600,
  }));
  const future = j.status === 'new' ? ['Accepted', 'Completed'] : j.status === 'accepted' ? ['Completed'] : [];
  future.forEach((label) => steps.push({ label, color: '#CFC8BF', fill: '#fff', text: '#8A827A', weight: 400 }));

  return html`<div class="divided" style="display:flex;flex-direction:column;gap:10px">
    <span class="eyebrow">Timeline</span>
    <ol class="timeline" style="list-style:none;margin:0;padding:0">
      ${steps.map((e, i) => html`<li class="tl-step">
        <div class="tl-rail"><span class="tl-dot" style="background:${e.fill};border-color:${e.color}"></span>
          ${i < steps.length - 1 ? html`<span class="tl-line"></span>` : ''}</div>
        <div class="tl-body"><div style="font-weight:${e.weight};color:${e.text}">${e.label}</div>
          ${e.sub ? html`<div class="small muted">${e.sub}</div>` : ''}</div>
      </li>`)}
    </ol>
  </div>`;
}

function declinePanel(s: State, j: Job): Html {
  const noteNeeded = s.declineReason === 'OTHER';
  return html`<div class="panel outline">
    <h3>Decline this job?</h3>
    <p class="soft" style="font-size:15px">${j.source}’s own staff take it on instead. The reason is sent to ${j.source}.</p>
    <div class="field">
      <label class="field-label" for="decline-reason">Reason</label>
      <select id="decline-reason" class="input${s.declineErr ? ' invalid' : ''}" data-input="declineReason"
        ${s.declineErr ? html`aria-invalid="true" aria-describedby="e-decline"` : ''}>
        <option value="">Choose a reason</option>
        ${DECLINE_REASONS.map(([code, label]) => html`<option value="${code}" ${code === s.declineReason ? 'selected' : ''}>${label}</option>`)}
      </select>
      ${s.declineErr ? html`<span class="field-error" id="e-decline">${s.declineErr}</span>` : ''}
    </div>
    <div class="field">
      <label class="field-label" for="decline-note">Details <span class="opt">(${noteNeeded ? 'required for Other' : 'optional'})</span></label>
      <textarea id="decline-note" class="input" rows="2" maxlength="500" placeholder="Add anything ${j.source} should know" data-input="declineNote">${s.declineNote}</textarea>
    </div>
    <div class="actions" style="gap:10px">
      ${busyButton({ action: 'confirmDecline', label: 'Decline job', busyLabel: 'Declining…', busy: s.busy === 'decline', kind: 'danger' })}
      <button type="button" class="btn btn-secondary" data-action="keepJob">Keep job</button>
    </div>
  </div>`;
}

function completePanel(s: State): Html {
  const invalid = s.compErr ? html`aria-invalid="true" aria-describedby="e-comp"` : '';
  return html`<div class="panel shaded">
    <h3>Report completion</h3>
    <div class="panel-grid">
      <div class="field">
        <label class="field-label" for="comp-start">Started at</label>
        <input id="comp-start" type="datetime-local" class="input${s.compErr ? ' invalid' : ''}" style="font-size:15px;padding:0 10px"
          value="${s.compStart}" data-input="compStart" ${invalid} />
      </div>
      <div class="field">
        <label class="field-label" for="comp-end">Finished at</label>
        <input id="comp-end" type="datetime-local" class="input${s.compErr ? ' invalid' : ''}" style="font-size:15px;padding:0 10px"
          value="${s.compEnd}" data-input="compEnd" ${invalid} />
      </div>
      ${s.compErr ? html`<span class="field-error" id="e-comp" style="grid-column:1/-1">${s.compErr}</span>` : ''}
      <div class="field" style="grid-column:1/-1">
        <label class="field-label" for="comp-notes">Notes <span class="opt">(<span id="notes-left">${500 - s.compNotes.length}</span> left)</span></label>
        <textarea id="comp-notes" class="input" rows="3" maxlength="500" placeholder="What was done" data-input="compNotes">${s.compNotes}</textarea>
      </div>
    </div>
    <div>${busyButton({ action: 'completeJob', label: 'Report completion', busyLabel: 'Sending…', busy: s.busy === 'complete' })}</div>
  </div>`;
}

/** What the partner tells about the job: never the elder's name, and the address only once accepted. */
function careLinkRows(j: Job): Html {
  const c = j.carelink!;
  if (!c.detailed) return html`<dt>Details</dt><dd class="muted">Loading from ${j.source}…</dd>`;
  const accepted = j.status === 'accepted' || j.status === 'completed';
  const hidden = html`<span class="hidden-val">${j.status === 'new' ? 'Shown after you accept' : 'Not shared'}</span>`;
  return html`
    <dt>Elder</dt><dd>${c.elderSummary}</dd>
    <dt>Languages</dt><dd>${c.languages || '—'}</dd>
    <dt>Booked by</dt><dd>${c.bookedBy}</dd>
    ${j.status === 'new' && c.respondBy ? html`<dt>Answer by</dt><dd><b>${when(c.respondBy)}</b></dd>` : ''}
    <dt>Address</dt><dd>${accepted && j.address ? j.address : hidden}</dd>
    ${accepted && c.accessNotes ? html`<dt>Access</dt><dd>${c.accessNotes}</dd>` : ''}
    <dt>Instructions</dt><dd>${j.instr}</dd>
    ${c.actualStart && j.completedAt ? html`<dt>Done</dt><dd>${when(c.actualStart)} – ${when(j.completedAt)}</dd><dt>Notes</dt><dd>${j.notes}</dd>` : ''}
    ${j.declineReason ? html`<dt>Our reason</dt><dd>${j.declineReason}${c.declineNote ? `: ${c.declineNote}` : ''}</dd>` : ''}
    ${j.status === 'cancelled' && c.cancelReason ? html`<dt>Why cancelled</dt><dd>${c.cancelReason}</dd>` : ''}`;
}

function detail(s: State, j: Job): Html {
  const partner = s.partners.find((p) => p.id === j.partnerId);
  return html`<article class="card">
    ${j.cancelledAfterAccept
      ? html`<div class="banner banner-error banner-cancelled" role="alert">
          <b class="head">${j.source} cancelled this job</b>
          <span>You had accepted it. Cancelled ${when(j.cancelledAt ?? 0)}. Do not send staff. No action is needed.</span>
          <span><b>Reason:</b> “${j.cancelReason}”</span>
        </div>`
      : ''}
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;gap:10px"><span class="mono small muted">${j.id}</span>${badge(j.status, undefined, { dot: true })}</div>
      <h2 class="job-title">${j.service}</h2>
    </div>
    <dl class="dl">
      <dt>From</dt><dd>${j.source}${partner ? html` <span class="small muted">(${partner.protocolName})</span>` : ''}</dd>
      <dt>Schedule</dt><dd>${schedule(j.start, j.dur)}</dd>
      <dt>Duration</dt><dd>${durationLong(j.dur)}</dd>
      <dt>Area</dt><dd>${j.district}</dd>
      ${j.carelink ? careLinkRows(j) : ''}
    </dl>
    ${j.status === 'new' && s.mode !== 'decline'
      ? html`<div class="actions divided" style="gap:10px">
          ${busyButton({ action: 'acceptJob', label: 'Accept job', busyLabel: 'Accepting…', busy: s.busy === 'accept' })}
          <button type="button" class="btn btn-secondary" data-action="openDecline">Decline…</button>
        </div>`
      : ''}
    ${j.status === 'new' && s.mode === 'decline' ? declinePanel(s, j) : ''}
    ${j.status === 'accepted' ? completePanel(s) : ''}
    ${timeline(j)}
  </article>`;
}

export function jobs(s: State): Html {
  const list = jobsIn(s, s.tab);
  const cur = currentJob(s);
  const [emptyTitle, emptyBody] = EMPTY[s.tab];

  return html`
    <div class="page-head baseline"><h1>Jobs</h1><span class="small muted ml-auto nowrap">Now ${hm(now())} SGT</span></div>
    ${sourcePills(s)}
    ${s.partners.filter((p) => p.jobsErr && isApproved(p)).map((p) => html`<div class="banner banner-error row" role="alert">
          <span><b>${p.name}’s jobs could not be loaded.</b> ${p.jobsErr}</span>
          <button type="button" class="btn btn-secondary btn-md" data-action="reloadJobs">Try again</button>
        </div>`)}
    ${!s.partners.some(isApproved)
      ? html`<div class="banner banner-info row" role="status"><span>No partner sends BrightHands jobs yet.</span>
          <a class="btn btn-secondary btn-md" href="#/partners">Partners</a></div>`
      : ''}
    <div class="tabs" role="tablist">
      ${TABS.map(([key, label]) => html`<button type="button" role="tab" class="tab tab-${key}${s.tab === key ? ' active' : ''}"
        aria-selected="${String(s.tab === key)}" data-action="pickTab" data-key="${key}">${label}<span class="tab-count">${jobsIn(s, key).length}</span></button>`)}
    </div>
    ${s.loading
      ? loadingList
      : html`<div class="jobs-layout">
          <div class="jobs-list">
            ${list.length
              ? html`<div class="card flush">${list.map((j) => jobRow(s, j, j === cur))}</div>`
              : html`<div class="empty-card"><span class="title">${emptyTitle}</span><span class="body" style="max-width:360px">${emptyBody}</span></div>`}
          </div>
          <div class="jobs-detail">
            ${s.jobErr
              ? html`<div class="banner banner-error row" role="alert"><span>${s.jobErr.lead ? html`<b>${s.jobErr.lead}</b> ` : ''}${s.jobErr.text}</span>
                  ${s.jobErr.retry ? html`<button type="button" class="btn btn-secondary btn-md" data-action="${s.jobErr.retry}">Try again</button>` : ''}</div>`
              : ''}
            ${cur ? detail(s, cur) : list.length ? html`<div class="empty-card"><span class="body">Select a job to see its details.</span></div>` : ''}
          </div>
        </div>`}`;
}
