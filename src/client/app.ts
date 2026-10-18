// The portal: one state object, rendered whole on every change, with hash routes per page.
// Signing in is the server's, and partners are reached only through the server (/api/partners/*): the browser never
// holds a partner's secret. Partners are data the server keeps; nothing here names any one of them.

import * as carelink from './carelink.js';
import { DECLINE_REASONS, type DeclineCode, type From, type JobDetail, type PortalAnswer } from './carelink.js';
import { APPLY_DEFAULTS } from './data.js';
import { fromIso, fromLocalInput, localInputToIso, now, toLocalInput } from './format.js';
import { html, type Html } from './html.js';
import { PARTNER_SCREENS, connectionScreen, currentJob, isApproved, openPartner, partnerHref, tabOf, webhookUrlFor } from './model.js';
import * as partnersApi from './partners.js';
import { ServerError, currentUser, signIn as serverSignIn, signOut, whenSignedOut } from './session.js';
import type {
  Application,
  ApplicationForm,
  BillFilter,
  Busy,
  ConnectionState,
  CustomerFilter,
  FormErrors,
  Job,
  Partner,
  PartnerForm,
  PartnerInfo,
  Screen,
  SourceFilter,
  State,
  Tab,
  TextField,
  Toast,
} from './types.js';
import { billing, customer, customers, overview, schedule, services, signIn, staff } from './views/business.js';
import { appBar, toast } from './views/chrome.js';
import { jobs } from './views/jobs.js';
import { apply, connection, gated, status } from './views/onboarding.js';
import { addPartner, partnerPage, partners } from './views/partners.js';
import { webhooks } from './views/webhooks.js';

const TOAST_MS = 5000;

const BLANK_PARTNER_FORM: PartnerForm = { id: '', name: '', protocol: 'carelink-open-platform', baseUrl: '' };

const initialState = (): State => ({
  loggedIn: false,
  user: null,
  signInUser: '',
  signInErr: null,
  screen: 'login',
  toast: null,
  busy: null,

  partners: [],
  protocols: [],
  partnerId: null,
  partnerForm: { ...BLANK_PARTNER_FORM },
  partnerErrs: {},
  partnerErr: null,
  confirmRemove: false,

  portalEmailInput: '',
  portalErr: null,
  form: { ...APPLY_DEFAULTS, services: [...APPLY_DEFAULTS.services] },
  errs: {},
  submitErr: null,
  webhookUrlInput: '',
  webhookMsg: null,

  jobs: [],
  hooks: [],
  loading: false,
  tab: 'new',
  srcFilter: 'all',
  sel: null,
  draftFor: null,
  mode: null,
  declineReason: '',
  declineNote: '',
  declineErr: null,
  compStart: '',
  compEnd: '',
  compNotes: '',
  compErr: null,
  jobErr: null,

  custFilter: 'all',
  custQuery: '',
  billFilter: 'all',
  week: 0,
});

// The session is the server's cookie, so a reload keeps the person signed in and on the same page.
let state: State = initialState();
const root = document.getElementById('app') as HTMLElement;

// ---------- Rendering ----------

function screenView(s: State): Html {
  const p = openPartner(s);
  if (PARTNER_SCREENS.has(s.screen) && p) return partnerPage(s, p, partnerScreen(s, p));
  return pageView(s);
}

/** A screen on a partner's page, under its header and sub-tabs. */
function partnerScreen(s: State, p: Partner): Html {
  switch (s.screen) {
    case 'apply': return apply(s, p);
    case 'status': return status(s, p);
    case 'webhooks': return isApproved(p) ? webhooks(s, p) : gated(p, 'Webhook activity');
    default: return connection(s, p);
  }
}

function pageView(s: State): Html {
  switch (s.screen) {
    case 'login': return signIn(s);
    case 'overview': return overview(s);
    case 'customers': return customers(s);
    case 'customer': return customer();
    case 'schedule': return schedule(s);
    case 'staff': return staff();
    case 'services': return services();
    case 'billing': return billing(s);
    case 'jobs': return jobs(s);
    case 'partnerNew': return addPartner(s);
    default: return partners(s);
  }
}

/**
 * A new job in the detail panel starts with empty decline and completion forms. Completion is filled in with the
 * scheduled times, moved back so neither is in the future, since a partner refuses a completion that is.
 */
function syncDrafts(): void {
  if (state.screen !== 'jobs') return;
  const j = currentJob(state);
  if (j) void ensureDetail(j);
  if (!j || j.id === state.draftFor) return;
  const end = Math.min(j.start + j.dur * 60_000, now() - (now() % 60_000));
  Object.assign(state, {
    draftFor: j.id,
    mode: null,
    declineReason: '',
    declineNote: '',
    declineErr: null,
    compStart: toLocalInput(end - j.dur * 60_000),
    compEnd: toLocalInput(end),
    compNotes: '',
    compErr: null,
  } satisfies Partial<State>);
}

/** A selector that finds an element again after a re-render, so it can keep focus. */
function focusKey(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const { action, key, id, index } = el.dataset;
  if (!action) return null;
  let sel = `[data-action="${CSS.escape(action)}"]`;
  if (key) sel += `[data-key="${CSS.escape(key)}"]`;
  if (id) sel += `[data-id="${CSS.escape(id)}"]`;
  if (index) sel += `[data-index="${CSS.escape(index)}"]`;
  return sel;
}

/** The caret or selection in a text field, which inputs such as datetime-local do not have. */
function selectionOf(el: Element | null): [number, number] | null {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  try {
    return el.selectionStart == null || el.selectionEnd == null ? null : [el.selectionStart, el.selectionEnd];
  } catch {
    return null;
  }
}

/** Sign-in passwords are never in the state, so a re-render would empty them: their values are carried over. */
function passwordsTyped(): Map<string, string> {
  const typed = new Map<string, string>();
  root.querySelectorAll<HTMLInputElement>('input[type="password"][id]:not([data-input])').forEach((el) => typed.set(el.id, el.value));
  return typed;
}

function render(): void {
  syncDrafts();
  const active = document.activeElement;
  const key = focusKey(active);
  const range = selectionOf(active);
  const passwords = passwordsTyped();

  root.innerHTML = String(html`${appBar(state)}<main class="page" id="main">${toast(state)}${screenView(state)}</main>`);

  for (const [id, value] of passwords) {
    const el = root.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
    if (el && !el.value) el.value = value;
  }
  const again = key ? root.querySelector<HTMLElement>(key) : null;
  if (!again) return;
  again.focus({ preventScroll: true });
  if (range && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)) {
    try {
      again.setSelectionRange(...range);
    } catch {
      // As above.
    }
  }
}

function set(patch: Partial<State>): void {
  Object.assign(state, patch);
  render();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function flash(text: string, kind: Toast['kind'] = 'success'): void {
  clearTimeout(toastTimer);
  set({ toast: { text, kind } });
  toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS);
}

/** Runs one server call at a time, with its button showing it is busy. */
async function busyWith(busy: Busy, fn: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  set({ busy });
  try {
    await fn();
  } finally {
    set({ busy: null });
  }
}

const text = (e: unknown): string => (e instanceof ServerError ? e.message : 'Something went wrong. Try again.');
const code = (e: unknown): string => (e instanceof ServerError ? e.code : '');

/** What a failed call with the server's credentials for a partner says about the connection. */
function connFrom(e: unknown): ConnectionState {
  switch (code(e)) {
    case 'CARELINK_UNREACHABLE':
    case 'CARELINK_ERROR':
    case 'SERVER_UNREACHABLE':
      return 'unreachable';
    case 'PROVIDER_SUSPENDED':
      return 'suspended';
    case 'INVALID_CLIENT':
    case 'INVALID_TOKEN':
    case 'UNAUTHORIZED_CLIENT':
      return 'token_error';
    case 'NOT_CONNECTED':
      return 'unknown';
    default:
      return e instanceof ServerError && e.status === 502 ? 'token_error' : 'unreachable';
  }
}

// ---------- Partners ----------

const APP_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' } as const;

/** Credentials without an application on record (set by hand, after applying on the partner's own site) mean approved. */
const appOf = (p: Pick<PartnerInfo, 'application' | 'credentials'>) =>
  p.application ? APP_STATUS[p.application.status] : p.credentials ? ('approved' as const) : ('none' as const);

/** A partner as the server described it, keeping what this page learnt of it unless its credentials changed. */
function toPartner(info: PartnerInfo, before?: Partner): Partner {
  const same = before && before.credentials?.clientId === info.credentials?.clientId;
  return {
    credentialsLost: false,
    conn: 'unknown',
    connMsg: null,
    lastTest: null,
    checkErr: null,
    lastChecked: null,
    jobsErr: null,
    ...(same ? before : {}),
    ...info,
    app: appOf(info),
  };
}

const partner = (id: string): Partner | undefined => state.partners.find((p) => p.id === id);

function patchPartner(id: string, patch: Partial<Partner>): void {
  state.partners = state.partners.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p, ...patch };
    return { ...next, app: appOf(next) };
  });
}

/** The partner list, as the server has it now: after a .env change, credentials show up here. */
async function loadPartners(): Promise<void> {
  try {
    const [{ partners: infos }, { protocols }] = await Promise.all([partnersApi.listPartners(), partnersApi.listProtocols()]);
    state.partners = infos.map((i) => toPartner(i, partner(i.id)));
    state.protocols = protocols;
  } catch (e) {
    flash(`Partners could not be loaded: ${text(e)}`, 'info');
  }
}

/** One partner, read again: on opening its page, so settings changed in .env show. */
async function refreshPartner(id: string): Promise<void> {
  try {
    const info = await partnersApi.getPartner(id);
    state.partners = state.partners.map((p) => (p.id === id ? toPartner(info, p) : p));
    render();
  } catch {
    // The list as it was is good enough to show.
  }
}

/** Everything every partner has: applications, jobs, webhook logs. After signing in, or a reload. */
async function loadEverything(): Promise<void> {
  await loadPartners();
  route();
  await Promise.all(state.partners.map(async (p) => {
    if (p.portal && p.application) await refreshApplication(p.id);
    if (partner(p.id)?.credentials) await Promise.all([loadJobs(p.id), loadHooks(p.id)]);
  }));
  render();
}

// ---------- One partner: the application and the connection ----------

/** The partner's portal sign-in ran out: the person signs in again where it is needed. */
function portalExpired(id: string, e: unknown): boolean {
  if (code(e) !== 'PORTAL_SIGN_IN_NEEDED') return false;
  patchPartner(id, { portal: null });
  state.portalErr = text(e);
  return true;
}

/** What the server answered about the application. Credentials it collected just now start the jobs coming. */
async function takePortalAnswer(id: string, a: PortalAnswer, email?: string): Promise<void> {
  const had = !!partner(id)?.credentials;
  patchPartner(id, {
    application: a.application,
    credentials: a.credentials,
    credentialsLost: a.credentialsLost,
    lastChecked: now(),
    checkErr: null,
    ...(email ? { portal: { email } } : {}),
  });
  state.portalErr = null;
  const p = partner(id)!;
  if (!had && p.credentials) {
    flash(`${p.name} approved BrightHands. The server collected the credentials and keeps them.`);
    await loadJobs(id);
  }
  // An application found by signing in, or just decided: the page moves to the screen that fits it.
  if (state.partnerId === id && (state.screen === 'apply' || state.screen === 'status') && connectionScreen(p) !== state.screen) route();
}

async function refreshApplication(id: string): Promise<void> {
  try {
    await takePortalAnswer(id, await carelink.portalApplication(id));
  } catch (e) {
    if (!portalExpired(id, e)) patchPartner(id, { checkErr: text(e) });
  }
}

// ---------- Jobs and webhooks ----------

const fromOf = (id: string): From => ({ id, name: partner(id)?.name ?? id });

/** A partner's jobs, read again. A job whose version did not change keeps the details already read. */
async function loadJobs(id: string, showLoading = false): Promise<void> {
  if (!partner(id)?.credentials) return;
  if (showLoading) set({ loading: true });
  try {
    const items = await carelink.listJobs(id);
    const before = new Map(state.jobs.filter((j) => j.partnerId === id).map((j) => [j.id, j]));
    state.jobs = [...state.jobs.filter((j) => j.partnerId !== id), ...items.map((i) => carelink.fromSummary(fromOf(id), i, before.get(i.id)))];
    detailFailed.clear();
    patchPartner(id, { conn: 'connected', jobsErr: null });
  } catch (e) {
    patchPartner(id, { conn: connFrom(e), jobsErr: text(e) });
  } finally {
    set({ loading: false });
  }
}

const loadAllJobs = (showLoading = false) =>
  Promise.all(state.partners.filter((p) => p.credentials).map((p) => loadJobs(p.id, showLoading)));

async function loadHooks(id: string, showLoading = false): Promise<void> {
  if (showLoading) set({ loading: true });
  try {
    const { deliveries } = await carelink.listWebhooks(id);
    state.hooks = [...state.hooks.filter((h) => h.partnerId !== id), ...deliveries.map((d) => ({ ...d, partnerId: id }))]
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  } catch (e) {
    flash(`Webhook activity could not be loaded: ${text(e)}`, 'info');
  } finally {
    set({ loading: false });
  }
}

const detailLoading = new Set<string>();
const detailFailed = new Set<string>();

/** The list has only a job's summary. Its elder, languages, address and timeline come from reading it. */
async function ensureDetail(j: Job): Promise<void> {
  const k = `${j.partnerId}:${j.id}`;
  if (!j.carelink || j.carelink.detailed || detailLoading.has(k) || detailFailed.has(k)) return;
  detailLoading.add(k);
  try {
    putJob(carelink.fromDetail(fromOf(j.partnerId), await carelink.getJob(j.partnerId, j.id), j.fresh));
  } catch (e) {
    detailFailed.add(k);
    state.jobErr = { lead: `${j.id} could not be read.`, text: text(e) };
  } finally {
    detailLoading.delete(k);
    render();
  }
}

const sameJob = (a: Job, b: Job): boolean => a.id === b.id && a.partnerId === b.partnerId;

function updateJob(job: Job, fn: (job: Job) => Job): void {
  state.jobs = state.jobs.map((j) => (sameJob(j, job) ? fn({ ...j, timeline: [...j.timeline] }) : j));
}

/** A job as its partner just answered with it, in place of the one held. */
function putJob(job: Job): void {
  state.jobs = state.jobs.some((j) => sameJob(j, job)) ? state.jobs.map((j) => (sameJob(j, job) ? job : j)) : [job, ...state.jobs];
}

function selectJob(id: string): void {
  const j = state.jobs.find((x) => x.id === id);
  if (!j) return;
  updateJob(j, (x) => ({ ...x, fresh: false }));
  const srcFilter = state.srcFilter === 'all' || state.srcFilter === j.partnerId ? state.srcFilter : 'all';
  Object.assign(state, { tab: tabOf(j), srcFilter, sel: id, jobErr: null });
}

/** Each request reaching any partner's webhook, as it arrives: the log grows, and that partner's jobs are read again. */
let stopLive: (() => void) | null = null;

function startLive(): void {
  stopLive?.();
  stopLive = carelink.onWebhook((d) => {
    state.hooks = [d, ...state.hooks];
    const p = d.partnerId ? partner(d.partnerId) : undefined;
    if (d.outcome !== 'processed' || !p) return render();
    if (d.event === 'ping') return flash(`Test event from ${p.name} arrived and its signature checked out.`, 'info');
    if (!d.jobId || (d.event !== 'job.dispatched' && d.event !== 'job.cancelled')) return render();
    const jobId = d.jobId;
    void loadJobs(p.id).then(() => {
      const j = state.jobs.find((x) => x.id === jobId && x.partnerId === p.id);
      if (d.event === 'job.dispatched') {
        if (j) updateJob(j, (x) => ({ ...x, fresh: true }));
        flash(`New job ${jobId} arrived from ${p.name}.`, 'info');
      } else {
        flash(`${p.name} cancelled ${jobId}.`, 'info');
      }
    });
  });
}

// ---------- Idempotency keys ----------

/** One key per action on a job, kept until the partner gives a final answer, so trying again never acts twice. */
const actionKeys = new Map<string, string>();

function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function keyFor(k: string): string {
  let v = actionKeys.get(k);
  if (!v) actionKeys.set(k, (v = newKey()));
  return v;
}

/** Calls the job's partner for an action on it. Refusals that trying again cannot fix offer no retry. */
async function jobAction(
  job: Job,
  busy: Busy,
  retry: 'acceptJob' | 'confirmDecline' | 'completeJob',
  lead: string,
  call: (key: string) => Promise<JobDetail>,
  done: (j: Job) => void,
): Promise<void> {
  const k = `${busy}:${job.partnerId}:${job.id}`;
  await busyWith(busy, async () => {
    try {
      const j = carelink.fromDetail(fromOf(job.partnerId), await call(keyFor(k)));
      actionKeys.delete(k);
      putJob(j);
      done(j);
    } catch (e) {
      const final = e instanceof ServerError && [400, 403, 404, 409, 422].includes(e.status);
      if (final) actionKeys.delete(k);
      state.jobErr = { lead, text: text(e), retry: final ? undefined : retry };
      // Cancelled, or answered too late: show the job as the partner has it now.
      if (final && e.status === 409) {
        try {
          putJob(carelink.fromDetail(fromOf(job.partnerId), await carelink.getJob(job.partnerId, job.id)));
        } catch {
          // The message says enough.
        }
      }
    }
  });
}

// ---------- Routing ----------

const SCREENS = new Set<Screen>(['overview', 'jobs', 'customers', 'customer', 'schedule', 'staff', 'services', 'billing', 'partners']);

/**
 * Opening a partner's page reads it again, so settings changed in .env show. Its forms start afresh when it is
 * another partner's page than the last one opened.
 */
function openPartnerPage(p: Partner): void {
  const already = state.partnerId === p.id && PARTNER_SCREENS.has(state.screen);
  if (!already) void refreshPartner(p.id);
  if (state.partnerId === p.id) return;
  Object.assign(state, {
    partnerId: p.id,
    portalEmailInput: p.portal?.email ?? p.application?.contactEmail ?? '',
    portalErr: null,
    form: { ...APPLY_DEFAULTS, webhookUrl: webhookUrlFor(p), services: [...APPLY_DEFAULTS.services] },
    errs: {},
    submitErr: null,
    webhookUrlInput: '',
    webhookMsg: null,
    confirmRemove: false,
  } satisfies Partial<State>);
}

/** `#/partners`, `#/partners/new`, `#/partners/<id>` (the screen that fits it) and `#/partners/<id>/webhooks`. */
function route(): void {
  if (!state.loggedIn) {
    set({ screen: 'login' });
    return;
  }
  const [first, second, third] = location.hash.replace(/^#\/?/, '').split('/');
  let key: Screen = 'overview';
  let canonical = '#/overview';

  if (first === 'partners' && second === 'new') {
    key = 'partnerNew';
    canonical = '#/partners/new';
  } else if (first === 'partners' && second) {
    const p = partner(decodeURIComponent(second));
    if (p) {
      openPartnerPage(p);
      key = third === 'webhooks' ? 'webhooks' : connectionScreen(p);
      canonical = partnerHref(p, key === 'webhooks' ? 'webhooks' : '');
    } else {
      key = 'partners';
      canonical = '#/partners';
    }
  } else if (SCREENS.has(first as Screen)) {
    key = first as Screen;
    canonical = `#/${key}`;
  }
  if (location.hash !== canonical) history.replaceState(null, '', canonical);

  const changed = key !== state.screen;
  Object.assign(state, { screen: key, jobErr: null });
  if (changed && key === 'jobs') void loadAllJobs(true);
  if (changed && key === 'webhooks' && state.partnerId) void loadHooks(state.partnerId, true);
  render();
  if (changed) window.scrollTo(0, 0);
}

function go(href: string): void {
  if (location.hash !== href) history.pushState(null, '', href);
  route();
}

// ---------- Forms ----------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TEXT_FIELDS = new Set<string>(['company', 'name', 'email', 'phone', 'webhookUrl', 'password'] satisfies TextField[]);
const PARTNER_FIELDS = new Set<string>(['id', 'name', 'protocol', 'baseUrl'] satisfies (keyof PartnerForm)[]);

function validate(f: ApplicationForm): FormErrors {
  const e: FormErrors = {};
  if (!f.company.trim()) e.company = 'Enter the company name.';
  if (!f.name.trim()) e.name = 'Enter a contact name.';
  if (!EMAIL.test(f.email.trim())) e.email = 'Enter a valid email address, e.g. name@company.sg';
  if (!f.phone.trim() || f.phone.trim().length > 30) e.phone = 'Enter a phone number, e.g. +65 9123 4567';
  if (f.password.length < 8) e.password = 'At least 8 characters.';
  if (!/^https?:\/\/[^\s/]+/.test(f.webhookUrl.trim())) e.webhookUrl = 'Enter a full URL, e.g. https://portal.example.sg/webhooks/partner';
  if (!f.services.length) e.services = 'Choose at least one service.';
  if (!f.terms) e.terms = 'You must accept the provider terms to apply.';
  return e;
}

/** The protocol's field names, as the form names them. */
const FORM_FIELD: Record<string, keyof FormErrors> = {
  organisationName: 'company',
  contactName: 'name',
  contactEmail: 'email',
  contactPhone: 'phone',
  password: 'password',
  webhookUrl: 'webhookUrl',
  services: 'services',
  agreedToTerms: 'terms',
};

/** A partner's name as an ID: "Acme Care Pte" → "acme-care-pte". */
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
let idTyped = false;

// ---------- Actions ----------

/** What `data-*` attribute an element carries, or an empty string. */
const data = (el: HTMLElement, name: string): string => el.dataset[name] ?? '';

const declineLabel = (c: string): string => DECLINE_REASONS.find(([k]) => k === c)?.[1] ?? c;

/** The open partner, for actions on its page. */
const here = (): Partner | null => openPartner(state);

/** Every `data-action` a view can name. Each gets the element that was clicked. */
const actions = {
  async login() {
    if (state.busy) return;
    const password = root.querySelector<HTMLInputElement>('#signin-password')?.value ?? '';
    if (!state.signInUser.trim() || !password) {
      set({ signInErr: 'Enter your username and password.' });
      root.querySelector<HTMLElement>(state.signInUser.trim() ? '#signin-password' : '#signin-user')?.focus();
      return;
    }
    set({ busy: 'signin', signInErr: null });
    try {
      const user = await serverSignIn(state.signInUser, password);
      Object.assign(state, { busy: null, loggedIn: true, user, signInErr: null });
      if (!location.hash || location.hash === '#/login') history.replaceState(null, '', '#/overview');
      startLive();
      await loadEverything();
    } catch (e) {
      const pw = root.querySelector<HTMLInputElement>('#signin-password');
      if (pw) pw.value = '';
      set({ busy: null, signInErr: e instanceof ServerError ? e.message : 'Sign-in failed. Try again.' });
      root.querySelector<HTMLElement>('#signin-password')?.focus();
    }
  },

  async logout() {
    await signOut().catch(() => {});
    signedOut();
  },

  notBuilt() {
    flash('Not part of this demo.', 'info');
  },

  reviewNewJobs() {
    Object.assign(state, { tab: 'new', srcFilter: 'all', sel: null });
    go('#/jobs');
  },

  jobsFrom(el: HTMLElement) {
    Object.assign(state, { tab: 'new', srcFilter: data(el, 'id'), sel: null });
    go('#/jobs');
  },

  openJob(el: HTMLElement) {
    selectJob(data(el, 'id'));
    go('#/jobs');
  },

  custFilter: (el: HTMLElement) => set({ custFilter: data(el, 'key') as CustomerFilter }),
  billFilter: (el: HTMLElement) => set({ billFilter: data(el, 'key') as BillFilter }),
  week: (el: HTMLElement) => set({ week: state.week + Number(data(el, 'step')) }),

  // ---------- Partners ----------

  async addPartner() {
    const f = state.partnerForm;
    await busyWith('addPartner', async () => {
      try {
        const info = await partnersApi.addPartner({ ...f, id: f.id.trim(), name: f.name.trim(), baseUrl: f.baseUrl.trim() });
        state.partners = [...state.partners, toPartner(info)];
        Object.assign(state, { partnerForm: { ...BLANK_PARTNER_FORM }, partnerErrs: {}, partnerErr: null });
        idTyped = false;
        go(partnerHref(info));
        flash(`${info.name} added. Next: its credentials, or its application.`);
      } catch (e) {
        if (e instanceof ServerError && Object.keys(e.fields).length) state.partnerErrs = e.fields;
        else state.partnerErr = text(e);
      }
    });
  },

  askRemovePartner: () => set({ confirmRemove: true }),
  keepPartner: () => set({ confirmRemove: false }),

  async removePartner() {
    const p = here();
    if (!p) return;
    await busyWith('removePartner', async () => {
      try {
        await partnersApi.removePartner(p.id);
        state.partners = state.partners.filter((x) => x.id !== p.id);
        state.hooks = state.hooks.filter((h) => h.partnerId !== p.id);
        Object.assign(state, { partnerId: null, confirmRemove: false, srcFilter: state.srcFilter === p.id ? 'all' : state.srcFilter });
        go('#/partners');
        flash(`${p.name} removed.`);
      } catch (e) {
        flash(text(e), 'info');
      }
    });
  },

  // ---------- Joining a partner ----------

  async submitApplication() {
    const p = here();
    if (!p) return;
    const errs = validate(state.form);
    set({ errs, submitErr: null });
    if (Object.keys(errs).length) {
      root.querySelector<HTMLElement>('[aria-invalid="true"], .chip.invalid input')?.focus();
      return;
    }
    const f = state.form;
    await busyWith('submit', async () => {
      try {
        const r = await carelink.apply(p.id, {
          organisationName: f.company.trim(),
          contactName: f.name.trim(),
          contactEmail: f.email.trim(),
          contactPhone: f.phone.trim(),
          services: f.services,
          webhookUrl: f.webhookUrl.trim(),
          password: f.password,
          agreedToTerms: true,
        });
        patchPartner(p.id, { application: r.application, portal: r.portal, lastChecked: now() });
        state.portalEmailInput = f.email.trim();
        state.form.password = '';
        route();
        flash(`Application ${r.applicationId} submitted to ${p.name}.`);
      } catch (e) {
        if (e instanceof ServerError && Object.keys(e.fields).length) {
          const fieldErrs: FormErrors = {};
          for (const [k, v] of Object.entries(e.fields)) fieldErrs[FORM_FIELD[k] ?? 'company'] = v;
          Object.assign(state, { errs: fieldErrs, submitErr: `${p.name} found problems with some answers.` });
        } else if (code(e) === 'ACCOUNT_EXISTS') {
          state.submitErr = `This email already has a pending or approved application with ${p.name}. Sign in above instead.`;
        } else {
          state.submitErr = text(e);
        }
      }
    });
  },

  async portalSignIn() {
    const p = here();
    if (!p) return;
    const email = state.portalEmailInput.trim();
    const password = root.querySelector<HTMLInputElement>('#portal-password')?.value ?? '';
    if (!email || !password) return set({ portalErr: 'Enter the email and password.' });
    await busyWith('portal', async () => {
      try {
        await takePortalAnswer(p.id, await carelink.portalSignIn(p.id, email, password), email);
      } catch (e) {
        state.portalErr = text(e);
        const pw = root.querySelector<HTMLInputElement>('#portal-password');
        if (pw) pw.value = '';
      }
    });
  },

  async checkStatus() {
    const p = here();
    if (!p) return;
    patchPartner(p.id, { checkErr: null });
    await busyWith('check', () => refreshApplication(p.id));
  },

  applyAgain() {
    const p = here();
    if (!p) return;
    const a = p.application;
    state.form = {
      ...APPLY_DEFAULTS,
      company: a?.organisationName ?? APPLY_DEFAULTS.company,
      email: a?.contactEmail ?? '',
      services: a?.services ?? [...APPLY_DEFAULTS.services],
      webhookUrl: a?.webhookUrl ?? webhookUrlFor(p),
    };
    // Back to applying: the rejected application stays on the server until a new one replaces it.
    Object.assign(state, { errs: {}, submitErr: null, screen: 'apply' });
    render();
  },

  async reissueCredentials() {
    const p = here();
    if (!p) return;
    await busyWith('reissue', async () => {
      try {
        const r = await carelink.reissueCredentials(p.id);
        patchPartner(p.id, { credentials: r.credentials, credentialsLost: false });
        flash('New credentials issued. The server keeps them.');
        await loadJobs(p.id);
      } catch (e) {
        if (!portalExpired(p.id, e)) flash(text(e), 'info');
      }
    });
  },

  async testConnection() {
    const p = here();
    if (!p) return;
    await busyWith('test', async () => {
      try {
        const r = await carelink.testConnection(p.id);
        patchPartner(p.id, { conn: 'connected', lastTest: { at: fromIso(r.at), ms: r.ms }, connMsg: `Test passed. New token fetched in ${r.ms} ms.` });
        await loadJobs(p.id);
      } catch (e) {
        const conn = connFrom(e);
        const why =
          conn === 'token_error'
            ? `${p.name} refused the client credentials (${code(e)}). Check them in the server’s .env, or issue new ones.`
            : text(e);
        patchPartner(p.id, { conn, connMsg: why });
      }
    });
  },

  async sendTestEvent() {
    const p = here();
    if (!p) return;
    await busyWith('ping', async () => {
      try {
        await carelink.sendTestEvent(p.id);
        state.webhookMsg = { kind: 'success', text: `${p.name} is sending a test event. It shows under Webhook activity when it arrives.` };
      } catch (e) {
        if (!portalExpired(p.id, e)) state.webhookMsg = { kind: 'error', text: text(e) };
      }
    });
  },

  async saveWebhookUrl() {
    const p = here();
    if (!p) return;
    const url = (state.webhookUrlInput || p.application?.webhookUrl || '').trim();
    await busyWith('webhookUrl', async () => {
      try {
        const r = await carelink.changeWebhookUrl(p.id, url);
        patchPartner(p.id, { application: r.application as Application });
        Object.assign(state, { webhookUrlInput: '', webhookMsg: { kind: 'success', text: `Saved. New deliveries go to ${url}.` } });
      } catch (e) {
        if (portalExpired(p.id, e)) return;
        const fieldMsg = e instanceof ServerError ? Object.values(e.fields)[0] : undefined;
        state.webhookMsg = { kind: 'error', text: fieldMsg ?? text(e) };
      }
    });
  },

  // ---------- Jobs ----------

  pickTab: (el: HTMLElement) => set({ tab: data(el, 'key') as Tab, sel: null, jobErr: null }),
  srcFilter: (el: HTMLElement) => set({ srcFilter: data(el, 'key') as SourceFilter, sel: null, mode: null, jobErr: null }),

  selectJob(el: HTMLElement) {
    selectJob(data(el, 'id'));
    render();
  },

  async reloadJobs() {
    await loadAllJobs(true);
  },

  async acceptJob() {
    const job = currentJob(state);
    if (!job) return;
    state.jobErr = null;
    await jobAction(job, 'accept', 'acceptJob', 'Accept failed.', (k) => carelink.acceptJob(job.partnerId, job.id, k), (j) => {
      Object.assign(state, { tab: 'accepted', sel: j.id });
      flash(`Job accepted. ${j.source} has been told, and the address is now shown.`);
    });
  },

  openDecline: () => set({ mode: 'decline', declineErr: null }),
  keepJob: () => set({ mode: null, declineErr: null }),

  async confirmDecline() {
    const job = currentJob(state);
    if (!job) return;
    const reason = state.declineReason as DeclineCode | '';
    const note = state.declineNote.trim();
    if (!reason) {
      set({ declineErr: 'Choose a reason.' });
      root.querySelector<HTMLElement>('#decline-reason')?.focus();
      return;
    }
    if (reason === 'OTHER' && !note) {
      set({ declineErr: 'Say why in the details when the reason is Other.' });
      root.querySelector<HTMLElement>('#decline-note')?.focus();
      return;
    }
    state.jobErr = null;
    await jobAction(job, 'decline', 'confirmDecline', 'Decline failed.', (k) => carelink.declineJob(job.partnerId, job.id, reason, note || null, k), (j) => {
      Object.assign(state, { sel: null, mode: null });
      flash(`${j.id} declined (${declineLabel(reason)}). ${j.source} takes it from here.`);
    });
  },

  async completeJob() {
    const job = currentJob(state);
    if (!job) return;
    const start = fromLocalInput(state.compStart);
    const end = fromLocalInput(state.compEnd);
    const problem =
      start == null || end == null ? 'Enter when the work started and finished.' :
      end <= start ? 'The finish must be after the start.' :
      end > now() ? 'The finish cannot be in the future. Report the job once it is done.' :
      null;
    if (problem) {
      set({ compErr: problem });
      root.querySelector<HTMLElement>('#comp-start')?.focus();
      return;
    }
    state.jobErr = null;
    const notes = state.compNotes.trim();
    await jobAction(
      job, 'complete', 'completeJob', 'Report failed.',
      (k) => carelink.completeJob(job.partnerId, job.id, localInputToIso(state.compStart), localInputToIso(state.compEnd), notes || null, k),
      (j) => {
        Object.assign(state, { tab: 'completed', sel: j.id });
        flash(`Completion reported to ${j.source}.`);
      },
    );
  },
} satisfies Record<string, (el: HTMLElement) => void | Promise<void>>;

type ActionName = keyof typeof actions;

const isAction = (name: string | undefined): name is ActionName => !!name && Object.hasOwn(actions, name);

// ---------- Events ----------

root.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-action]');
  const name = el?.dataset.action;
  if (!el || !isAction(name)) return;
  e.preventDefault();
  void actions[name](el);
});

root.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const path = el.dataset.input;
  if (!path) return;

  if (path.startsWith('form.')) {
    const k = path.slice(5);
    if (!TEXT_FIELDS.has(k)) return;
    state.form[k as TextField] = el.value;
    if (state.errs[k as TextField]) {
      delete state.errs[k as TextField];
      render();
    }
    return;
  }

  if (path.startsWith('partnerForm.')) {
    const k = path.slice(12) as keyof PartnerForm;
    if (!PARTNER_FIELDS.has(k)) return;
    state.partnerForm[k] = el.value;
    if (k === 'id') idTyped = el.value !== '';
    // The ID follows the name until someone types one.
    if (k === 'name' && !idTyped) {
      state.partnerForm.id = slug(el.value);
      const idInput = root.querySelector<HTMLInputElement>('#p-id');
      if (idInput) idInput.value = state.partnerForm.id;
    }
    if (state.partnerErrs[k] || k === 'name' || k === 'id') {
      delete state.partnerErrs[k];
      render();
    }
    return;
  }

  switch (path) {
    case 'signInUser':
      state.signInUser = el.value;
      break;
    case 'portalEmailInput':
      state.portalEmailInput = el.value;
      break;
    case 'webhookUrlInput':
      state.webhookUrlInput = el.value;
      break;
    case 'custQuery':
      set({ custQuery: el.value });
      break;
    case 'declineReason':
      set({ declineReason: el.value, declineErr: null });
      break;
    case 'declineNote':
      state.declineNote = el.value;
      break;
    case 'compStart':
    case 'compEnd':
      state[path] = el.value;
      if (state.compErr) set({ compErr: null });
      break;
    case 'compNotes': {
      state.compNotes = el.value;
      const left = root.querySelector('#notes-left');
      if (left) left.textContent = String(500 - el.value.length);
      break;
    }
  }
});

root.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.check === 'service') {
    state.form.services = el.checked ? [...state.form.services, el.value] : state.form.services.filter((x) => x !== el.value);
    delete state.errs.services;
    render();
  } else if (el.dataset.check === 'terms') {
    state.form.terms = el.checked;
    delete state.errs.terms;
    render();
  }
});

root.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = (e.target as HTMLElement).dataset.form;
  if (form === 'signin') void actions.login();
  else if (form === 'apply') void actions.submitApplication();
  else if (form === 'portal') void actions.portalSignIn();
  else if (form === 'partner') void actions.addPartner();
});

/** Back to the sign-in page, with the portal's state as it was before anyone signed in. */
function signedOut(): void {
  stopLive?.();
  stopLive = null;
  actionKeys.clear();
  state = initialState();
  history.replaceState(null, '', location.pathname + location.search);
  route();
}

// The server ended the session (an hour idle, a restart): sign in again.
whenSignedOut(() => {
  if (!state.loggedIn) return;
  signedOut();
  flash('Your session ended. Sign in again.', 'info');
});

window.addEventListener('hashchange', route);

// Keep "now" current on the pages that show it, unless someone is typing.
setInterval(() => {
  const typing = document.activeElement && document.activeElement !== document.body;
  if (!typing && (state.screen === 'overview' || state.screen === 'jobs')) render();
}, 30_000);

const user = await currentUser();
Object.assign(state, { loggedIn: !!user, user });
if (user) {
  startLive();
  await loadEverything();
} else {
  route();
}
