// BrightHands' own day-to-day pages. Their data is static.

import {
  CUSTOMERS,
  CUSTOMER_FILTERS,
  CUSTOMER_STATUS,
  INVOICES,
  INVOICE_STATUS,
  JOB_STAFF_ROW,
  LEAVE,
  SCHEDULE_ROWS,
  SCHEDULE_VISITS,
  SCHEDULE_WEEKS,
  SERVICES,
  STAFF,
  TODAY_VISITS,
  type ScheduleRow,
  type ScheduleVisit,
  type Visit,
} from '../data.js';
import { T, dayOfMonth, demoNow, durationShort, hm, money, now, when } from '../format.js';
import { badge, html, notBuilt, type Html } from '../html.js';
import { isApproved, jobsIn, partnerHref, visibleJobs } from '../model.js';
import type { BadgeColour, BillFilter, CustomerStatus, Partner, State } from '../types.js';

export function signIn(s: State): Html {
  const busy = s.busy === 'signin';
  return html`<div class="signin-wrap">
    <form class="card signin" data-form="signin" novalidate style="display:flex;flex-direction:column;gap:16px">
      <div class="intro"><h1>Sign in</h1><p class="muted">BrightHands staff only.</p></div>
      ${s.signInErr && html`<div class="banner banner-error" role="alert" id="signin-err">${s.signInErr}</div>`}
      <div class="field">
        <label class="field-label" for="signin-user">Username</label>
        <input id="signin-user" class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false"
          value="${s.signInUser}" data-input="signInUser" required ${s.signInErr && html`aria-describedby="signin-err"`} />
      </div>
      <div class="field">
        <label class="field-label" for="signin-password">Password</label>
        <input id="signin-password" class="input" name="password" type="password" autocomplete="current-password" required />
      </div>
      <button type="submit" class="btn btn-primary btn-lg${busy ? ' busy' : ''}" aria-busy="${String(busy)}" ${busy && 'disabled'}>
        ${busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>`;
}

// ---------- Overview ----------

/** What a partner still needs before it can send BrightHands jobs, if anything. */
function setupStep(p: Partner): string | null {
  if (p.app === 'none') return p.canApply ? 'apply to it' : 'add its credentials';
  if (p.app === 'pending') return `wait for it to decide on application ${p.application?.id ?? ''}`;
  if (p.app === 'rejected') return 'see why it said no, and apply again';
  if (!p.credentials) return 'add its credentials';
  return null;
}

function visitState(v: Visit, t: number): [label: string, colour: string] {
  const end = v.start + v.dur * 60_000;
  if (t >= end) return ['Done', '#1A6B3D'];
  if (t >= v.start) return ['In progress', '#1C5596'];
  return ['Upcoming', '#5C554E'];
}

interface Attention {
  dot: string;
  title: string;
  sub: string;
  cta?: string;
  href?: string;
  action?: string;
  id?: string;
}

function attentionItems(s: State): Attention[] {
  const items: Attention[] = [
    { dot: '#C5362A', title: 'Invoice INV-2026-2195 is 12 days overdue', sub: 'Mr David Ng · S$224.00', cta: 'View', href: '#/billing' },
  ];
  const fresh = jobsIn(s, 'new', true);
  if (fresh.length) {
    items.push({
      dot: '#6D4BC4',
      title: `${fresh.length} new job request${fresh.length > 1 ? 's' : ''} waiting for a reply`,
      sub: `Latest received ${when(fresh[0].received)}`,
      cta: 'Review',
      action: 'reviewNewJobs',
    });
  }
  const cancelled = visibleJobs(s)
    .filter((j) => j.cancelledAfterAccept && (j.cancelledAt ?? 0) >= now() - 7 * 86_400_000)
    .sort((a, b) => (b.cancelledAt ?? 0) - (a.cancelledAt ?? 0))[0];
  if (cancelled) {
    items.push({
      dot: '#C5362A',
      title: `${cancelled.id} was cancelled by ${cancelled.source}`,
      sub: `${cancelled.cancelReason} Cancelled ${when(cancelled.cancelledAt ?? 0)}.`,
      cta: 'View',
      action: 'openJob',
      id: cancelled.id,
    });
  }
  for (const p of s.partners) {
    if (isApproved(p) && p.credentials && (p.conn === 'unreachable' || p.conn === 'token_error' || p.conn === 'suspended')) {
      items.push({ dot: '#C5362A', title: `${p.name}’s jobs could not be loaded`, sub: p.jobsErr ?? 'Check the connection.', cta: 'Check', href: partnerHref(p) });
    }
  }
  items.push(
    { dot: '#B07A10', title: 'Lakshmi Devi is on leave until Fri 16 Oct', sub: 'Her regular customers are covered by Wati Suryani and Hui Min Ong.' },
    { dot: '#B07A10', title: 'Supplies running low', sub: 'Floor cleaner and microfibre cloths. Reorder before Wed 14 Oct.' },
  );
  return items;
}

export function overview(s: State): Html {
  const t = demoNow();
  const visits = TODAY_VISITS.map((v) => ({ ...v, state: visitState(v, t) }));
  const count = (label: string): number => visits.filter((v) => v.state[0] === label).length;
  const done = count('Done');
  const visitsSub = `${done ? `${done} done, ` : ''}${count('In progress')} in progress, ${count('Upcoming')} to go`;

  const stats = [
    ['Visits today', String(visits.length), visitsSub, '#/schedule'],
    ['Regular customers', '48', '3 joined this month', '#/customers'],
    ['Housekeepers on duty', '7 of 9', '1 on leave, 1 off', '#/staff'],
    ['Billed in October', 'S$9,860', '1 invoice overdue', '#/billing'],
  ];

  return html`
    <div class="page-head baseline">
      <h1>Good morning, Alan</h1>
      <span class="small muted ml-auto nowrap">Mon 12 Oct 2026 · ${hm(t)} SGT</span>
    </div>
    ${!s.partners.length
      ? html`<div class="setup-card">
          <div class="text"><b>Add the partners that send BrightHands work.</b><span class="soft">Their jobs arrive here, by API and webhook.</span></div>
          <a class="btn btn-primary" href="#/partners/new">Add partner</a>
        </div>`
      : s.partners.map((p) => {
          const next = setupStep(p);
          return next && html`<div class="setup-card">
              <div class="text"><b>${p.name} cannot send jobs yet.</b><span class="soft">Next: ${next}.</span></div>
              <a class="btn btn-primary" href="${partnerHref(p)}">Open ${p.name}</a>
            </div>`;
        })}
    <div class="stats">
      ${stats.map(([label, value, sub, href]) => html`<a class="stat" href="${href}">
        <span class="label">${label}</span><span class="value">${value}</span><span class="sub">${sub}</span></a>`)}
    </div>
    <div class="two-col">
      <section class="card flush">
        <div class="card-head"><h2>Needs your attention</h2></div>
        ${attentionItems(s).map((a) => html`<div class="attention">
          <span class="dot" style="background:${a.dot}"></span>
          <div class="text"><span style="font-weight:600">${a.title}</span><span class="small muted">${a.sub}</span></div>
          ${a.href ? html`<a class="btn btn-secondary btn-sm" href="${a.href}">${a.cta}</a>` : ''}
          ${a.action ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="${a.action}" data-id="${a.id ?? ''}">${a.cta}</button>` : ''}
        </div>`)}
      </section>
      <section class="card flush">
        <div class="card-head"><h2>Today's visits</h2><a class="ml-auto small" style="font-weight:600;text-decoration:none" href="#/schedule">Full schedule</a></div>
        ${visits.map((v) => html`<div class="visit">
          <span class="mono small">${hm(v.start)}</span>
          <span style="font-weight:600">${v.service} <span class="muted" style="font-weight:400">· ${v.client}</span></span>
          <span class="state" style="color:${v.state[1]}">${v.state[0]}</span>
          <span></span><span class="small muted">${v.staff} · ${v.area}</span><span></span>
        </div>`)}
      </section>
    </div>`;
}

// ---------- Customers ----------

const customerBadge = (status: CustomerStatus): Html => badge(...CUSTOMER_STATUS[status]);

export function customers(s: State): Html {
  const q = s.custQuery.trim().toLowerCase();
  const rows = CUSTOMERS.filter(
    (c) => (s.custFilter === 'all' || c.status === s.custFilter) && (!q || `${c.name} ${c.home}`.toLowerCase().includes(q)),
  );
  const total = CUSTOMER_FILTERS.find((f) => f.key === s.custFilter)?.count ?? CUSTOMERS.length;
  const row = (c: (typeof CUSTOMERS)[number]): Html => {
    const cells = html`<span class="t-cell"><span style="font-weight:600">${c.name}</span><span class="micro muted">${c.since}</span></span>
      <span class="t-15">${c.plan}</span><span class="t-15">${c.home}</span>
      <span class="t-15${c.nextMuted ? ' muted' : ''}">${c.next}</span><span>${customerBadge(c.status)}</span>`;
    return c.detail
      ? html`<a class="t-row cols-customers" href="#/customer">${cells}</a>`
      : html`<div class="t-row cols-customers">${cells}</div>`;
  };

  return html`
    <div class="page-head">
      <h1>Customers</h1><span class="small muted">Households that book BrightHands directly</span>
      <span class="ml-auto">${notBuilt('Add customer', 'primary')}</span>
    </div>
    <div class="toolbar">
      <input id="cust-search" class="input search" type="search" placeholder="Search by name or area" aria-label="Search customers"
        value="${s.custQuery}" data-input="custQuery" />
      ${CUSTOMER_FILTERS.map((f) => html`<button type="button" class="pill${f.key === s.custFilter ? ' on' : ''}"
        data-action="custFilter" data-key="${f.key}" aria-pressed="${String(f.key === s.custFilter)}">${f.label} ${f.count}</button>`)}
    </div>
    <div class="card flush">
      <div class="t-head cols-customers"><span>Customer</span><span>Plan</span><span>Home</span><span>Next visit</span><span>Status</span></div>
      ${rows.length ? rows.map(row) : html`<div class="t-row"><span class="muted">No customers match “${s.custQuery}”.</span></div>`}
    </div>
    <span class="small muted">Showing ${rows.length} of ${total}. CareLink elders are not listed here. They stay in CareLink jobs.</span>`;
}

export function customer(): Html {
  const upcoming = [
    ['Tue 13 Oct, 09:00', 'Housekeeping + ironing', 'Ana Santos'],
    ['Tue 20 Oct, 09:00', 'Housekeeping + ironing', 'Ana Santos'],
    ['Sat 31 Oct, 09:00', 'Window & grille cleaning', 'Kumar Velu'],
  ];
  return html`
    <a class="link-back" href="#/customers">← All customers</a>
    <div class="page-head">
      <h1>Lim family</h1>${customerBadge('regular')}
      <span class="ml-auto actions">${notBuilt('Edit')}${notBuilt('Book extra visit', 'primary')}</span>
    </div>
    <div class="detail-cols">
      <div class="col">
        <section class="card compact">
          <h2>Contact</h2>
          <dl class="kv"><dt>Name</dt><dd>Mrs Rachel Lim</dd><dt>Phone</dt><dd>+65 9188 2047</dd>
            <dt>Email</dt><dd>rachel.lim@example.sg</dd><dt>Pays by</dt><dd>GIRO, monthly</dd></dl>
        </section>
        <section class="card compact">
          <h2>Home</h2>
          <dl class="kv"><dt>Address</dt><dd>Blk 456 Tampines Street 42, #09-118, Singapore 520456</dd>
            <dt>Type</dt><dd>4-room HDB, 2 bathrooms</dd><dt>Access</dt><dd>Helper at home on weekdays</dd><dt>Pets</dt><dd>1 cat</dd></dl>
        </section>
        <section class="note-card"><b>House notes</b><span>Use the family's own cleaning products under the kitchen sink. Do not move items on the study desk. Iron school uniforms first.</span></section>
      </div>
      <div class="col">
        <section class="card flush">
          <div class="card-head"><h2>Plan</h2><span class="ml-auto small muted">S$112.00 per visit</span></div>
          <div class="card-row"><span><b>Light housekeeping</b> · 3 h</span><span class="muted">Every Tue, 09:00</span></div>
          <div class="card-row"><span><b>Laundry &amp; ironing</b> · 1 h</span><span class="muted">Same visit</span></div>
          <div class="card-row"><span class="muted">Preferred housekeeper</span><span style="font-weight:600">Ana Santos</span></div>
        </section>
        <section class="card flush">
          <div class="card-head"><h2>Upcoming visits</h2></div>
          ${upcoming.map(([at, what, who]) => html`<div class="t-row cols-upcoming"><span>${at}</span><span style="font-weight:600">${what}</span><span class="muted">${who}</span></div>`)}
        </section>
        <section class="card flush">
          <div class="card-head"><h2>Recent visit notes</h2></div>
          <div class="card-row" style="flex-direction:column;gap:2px"><span class="small muted">Tue 6 Oct · Ana Santos</span><span>All rooms done. Bathroom grout needs a deep clean. Suggested window clean, booked for 31 Oct.</span></div>
          <div class="card-row" style="flex-direction:column;gap:2px"><span class="small muted">Tue 29 Sep · Ana Santos</span><span>Ironed 14 pieces. Floor cleaner running low, family will buy more.</span></div>
        </section>
      </div>
    </div>`;
}

// ---------- Schedule ----------

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Partners' jobs BrightHands has taken on, as chips in the housekeeper's row, showing the job ID. */
const jobVisits = (s: State): ScheduleVisit[] =>
  visibleJobs(s)
    .filter((j) => j.status === 'accepted' || j.status === 'completed')
    .map((j) => ({ d: dayOfMonth(j.start), row: JOB_STAFF_ROW[j.service] ?? 'crew', time: hm(j.start), what: durationShort(j.dur), who: j.id, jobId: j.id, carelink: true }));

function chip(v: ScheduleVisit): Html {
  const body = html`<span><b>${v.time}</b> <span class="nowrap">${v.what}</span></span><span>${v.who}</span>`;
  return v.jobId
    ? html`<button type="button" class="vchip job${v.carelink ? ' cl' : ''}" data-action="openJob" data-id="${v.jobId}" title="Open ${v.jobId}">${body}</button>`
    : html`<span class="vchip">${body}</span>`;
}

export function schedule(s: State): Html {
  const first = SCHEDULE_WEEKS[s.week];
  const days = WEEKDAYS.map((name, i) => ({ name, d: first + i }));
  const visits = [...SCHEDULE_VISITS, ...jobVisits(s)].sort((a, b) => a.time.localeCompare(b.time));
  const today = dayOfMonth(demoNow());

  const cells = (row: ScheduleRow, last: boolean): Html[] => {
    const out: Html[] = [];
    const edge = last ? ' last' : '';
    for (let i = 0; i < days.length; i++) {
      const { d } = days[i];
      const leave = LEAVE.find((l) => l.row === row.key && d >= l.from && d <= l.to);
      if (leave) {
        const span = Math.min(leave.to, days[6].d) - d + 1;
        out.push(html`<span class="sched-cell off leave${edge}" style="grid-column:span ${span}">${leave.label}</span>`);
        i += span - 1;
      } else if (i === 6) {
        out.push(html`<span class="sched-cell off${edge}" aria-label="Day off"></span>`);
      } else {
        out.push(html`<span class="sched-cell${edge}">${visits.filter((v) => v.row === row.key && v.d === d).map(chip)}</span>`);
      }
    }
    return out;
  };

  const label = `Mon ${first} – Sun ${first + 6} Oct`;
  return html`
    <div class="page-head" style="gap:10px">
      <h1>Schedule</h1>
      <button type="button" class="btn btn-secondary btn-icon ml-auto" data-action="week" data-step="-1" aria-label="Previous week" ${s.week === 0 ? 'disabled' : ''}>‹</button>
      <span style="font-weight:600">${label}</span>
      <button type="button" class="btn btn-secondary btn-icon" data-action="week" data-step="1" aria-label="Next week" ${s.week === SCHEDULE_WEEKS.length - 1 ? 'disabled' : ''}>›</button>
      ${notBuilt('Book a visit', 'primary', 'md')}
    </div>
    <div class="sched-legend">
      <span><span class="sw"></span>Own customer</span>
      <span><span class="sw cl"></span>Partner job</span>
      <span><span class="sw off"></span>Leave / off</span>
    </div>
    <div class="sched" role="table" aria-label="Visits for ${label}">
      <span class="sched-h corner">Housekeeper</span>
      ${days.map(({ name, d }) => html`<span class="sched-h${d === today ? ' today' : ''}">${name} ${d}${d === today ? ' · Today' : ''}</span>`)}
      ${SCHEDULE_ROWS.map((row, i) => {
        const last = i === SCHEDULE_ROWS.length - 1;
        return html`<span class="sched-who${last ? ' last' : ''}"><b>${row.name}</b><span class="muted">${row.sub}</span></span>${cells(row, last)}`;
      })}
    </div>`;
}

// ---------- Staff, Services, Billing ----------

const STAFF_TODAY: Record<(typeof STAFF)[number]['today'], [BadgeColour, string]> = { on: ['completed', 'On duty'], leave: ['pending', 'On leave'], off: ['declined', 'Off today'] };

export function staff(): Html {
  return html`
    <div class="page-head">
      <h1>Staff</h1><span class="small muted">9 people · 7 on duty today</span>
      <span class="ml-auto">${notBuilt('Add staff member')}</span>
    </div>
    <div class="card flush">
      <div class="t-head cols-staff"><span>Name</span><span>Does</span><span>Training</span><span>Week</span><span>Today</span></div>
      ${STAFF.map((p) => html`<div class="t-row cols-staff">
        <span class="t-cell"><b>${p.name}</b><span class="small muted">${p.role}</span></span>
        <span class="t-15">${p.does}</span>
        <span class="small" style="${p.trainingExpiring ? 'color:#A3231A;font-weight:600' : 'color:#3E3832'}">${p.training}</span>
        <span>${p.week}</span>
        <span class="badge-stack">${badge(...STAFF_TODAY[p.today])}${p.note ? html`<span class="note">${p.note}</span>` : ''}</span>
      </div>`)}
    </div>`;
}

export function services(): Html {
  return html`
    <div class="page-head">
      <h1>Services</h1><span class="small muted">7 services · 1 offered on CareLink</span>
      <span class="ml-auto">${notBuilt('Add service')}</span>
    </div>
    <div class="card flush">
      <div class="t-head cols-services"><span>Service</span><span>Minimum</span><span class="num">Price</span><span>On CareLink</span></div>
      ${SERVICES.map((sv) => html`<div class="t-row cols-services">
        <span class="t-cell"><b>${sv.name}</b><span class="small muted">${sv.desc}</span></span>
        <span>${sv.min}</span><span class="num">${sv.price}</span>
        ${sv.carelink
          ? html`<span style="display:flex;align-items:center;gap:8px"><span class="toggle" role="img" aria-label="On"></span>
              <span class="stack" style="line-height:1.3"><span>As “${sv.carelink.as}”</span><span class="micro muted">${sv.carelink.terms}</span></span></span>`
          : html`<span class="muted">Not a CareLink service</span>`}
      </div>`)}
    </div>
    <span class="small muted">CareLink has its own fixed list of services. BrightHands' light housekeeping matches CareLink's “Light housekeeping”, at the rate agreed in the provider terms.</span>`;
}

const BILL_FILTERS: readonly [BillFilter, string][] = [
  ['all', 'All'],
  ['customers', 'Customers'],
  ['partners', 'Partners'],
];

export function billing(s: State): Html {
  const shown = INVOICES.filter((inv) => s.billFilter === 'all' || (s.billFilter === 'partners') === !!inv.carelink);
  return html`
    <div class="page-head"><h1>Billing</h1><span class="ml-auto">${notBuilt('New invoice', 'primary')}</span></div>
    <div class="stats three">
      <div class="stat"><span class="label">Outstanding</span><span class="value">S$672.00</span><span class="sub">2 invoices</span></div>
      <div class="stat danger"><span class="label">Overdue</span><span class="value">S$224.00</span><span class="sub">1 invoice, 12 days late</span></div>
      <div class="stat"><span class="label">Collected in October</span><span class="value">S$1,646.00</span><span class="sub">3 payments</span></div>
    </div>
    <div class="toolbar">
      ${BILL_FILTERS.map(([key, label]) => html`<button type="button" class="pill${key === s.billFilter ? ' on' : ''}"
        data-action="billFilter" data-key="${key}" aria-pressed="${String(key === s.billFilter)}">${label}</button>`)}
    </div>
    <div class="card flush">
      <div class="t-head cols-billing"><span>Invoice</span><span>Bill to</span><span>Period</span><span class="num">Amount</span><span>Status</span></div>
      ${shown.length
        ? shown.map((inv) => html`<div class="t-row cols-billing${inv.status === 'overdue' ? ' overdue' : ''}">
            <span class="mono small">${inv.no}</span>
            <span class="t-cell"><b>${inv.to}</b><span class="micro muted">${inv.what}</span></span>
            <span>${inv.period}</span>
            <span class="num" style="font-weight:600">${money(inv.amount)}</span>
            <span class="badge-stack">${badge(...INVOICE_STATUS[inv.status])}${inv.note ? html`<span class="note">${inv.note}</span>` : ''}</span>
          </div>`)
        : html`<div class="t-row"><span class="muted">No partner invoices. Billing partners is not part of their APIs.</span></div>`}
    </div>`;
}
