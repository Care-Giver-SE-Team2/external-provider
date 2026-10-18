// A partner speaking CareLink's Open Platform protocol, through the portal's server (`/api/partners/<id>/*`), and
// turning its jobs into the portal's own shape. Every call names the partner: any number of them can speak it.

import { fromIso } from './format.js';
import { serverFetch } from './session.js';
import type { Application, Credentials, Job, JobStatus, PartnerInfo, TimelineStep, WebhookDelivery } from './types.js';

// ---------- CareLink's shapes (carelink-platform/docs/api/open-platform.yaml) ----------

type CareLinkStatus = 'NEW' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'CANCELLED';

interface JobSummary {
  id: string;
  version: number;
  status: CareLinkStatus;
  serviceName: string;
  district: string;
  areaName: string;
  scheduledStart: string;
  durationMinutes: number;
  respondBy: string | null;
  receivedAt: string;
  cancelReason: string | null;
}

export interface JobDetail extends JobSummary {
  elderSummary: string;
  languages: string;
  bookedBy: string;
  instructions: string | null;
  address: { text: string; accessNotes: string | null } | null;
  timeline: { step: 'DISPATCHED' | Exclude<CareLinkStatus, 'NEW'>; at: string }[];
  completion: { actualStart: string; actualEnd: string; note: string | null } | null;
  decline: { reason: DeclineCode; note: string | null } | null;
}

interface JobPage {
  items: JobSummary[];
  page: number;
  size: number;
  totalElements: number;
}

export type DeclineCode = 'OUTSIDE_HOURS' | 'NO_PRACTITIONER' | 'OUTSIDE_AREA' | 'OTHER';

/** The protocol's decline reasons, as staff read them. */
export const DECLINE_REASONS: readonly (readonly [DeclineCode, string])[] = [
  ['NO_PRACTITIONER', 'No staff available at that time'],
  ['OUTSIDE_HOURS', 'Outside our working hours'],
  ['OUTSIDE_AREA', 'Outside our service area'],
  ['OTHER', 'Other'],
];

/** The services CareLink's catalogue offers today (report's V2 migration), offered when applying. */
export const CARELINK_SERVICES: readonly string[] = ['Hospital escort', 'Grocery assistance', 'Companionship', 'Light housekeeping'];

// ---------- Turning a partner's job into the portal's Job ----------

const STATUS: Record<CareLinkStatus, JobStatus> = {
  NEW: 'new',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

type Step = Exclude<JobDetail['timeline'][number]['step'], 'NEW'>;

function stepLabel(step: Step, partner: string): [string, JobStatus] {
  const labels: Record<Step, [string, JobStatus]> = {
    DISPATCHED: [`Received from ${partner}`, 'new'],
    ACCEPTED: ['Accepted by BrightHands', 'accepted'],
    DECLINED: ['Declined by BrightHands', 'declined'],
    COMPLETED: [`Completed, reported to ${partner}`, 'completed'],
    CANCELLED: [`Cancelled by ${partner}`, 'cancelled'],
  };
  return labels[step];
}

const area = (j: JobSummary): string => (j.district ? `${j.areaName} (D${j.district})` : j.areaName || '—');

const declineLabel = (code: DeclineCode): string => DECLINE_REASONS.find(([c]) => c === code)?.[1] ?? code;

/** The partner a job came from, as a job names it. */
export type From = Pick<PartnerInfo, 'id' | 'name'>;

/** A job from the partner's list. The parts only reading the job gives are kept from `before`, if it had them. */
export function fromSummary(from: From, j: JobSummary, before?: Job): Job {
  const status = STATUS[j.status];
  if (before?.carelink && before.carelink.version === j.version) return before;
  return {
    id: j.id,
    partnerId: from.id,
    source: from.name,
    service: j.serviceName,
    start: fromIso(j.scheduledStart),
    dur: j.durationMinutes,
    district: area(j),
    received: fromIso(j.receivedAt),
    status,
    fresh: before?.fresh ?? false,
    elder: '',
    address: '',
    instr: '—',
    timeline: [{ label: `Received from ${from.name}`, at: fromIso(j.receivedAt), status: 'new' }],
    cancelReason: j.cancelReason ?? undefined,
    carelink: {
      version: j.version,
      respondBy: j.respondBy ? fromIso(j.respondBy) : null,
      areaName: j.areaName,
      cancelReason: j.cancelReason,
      detailed: false,
    },
  };
}

/** A job as CareLink gives it when read on its own: everything the panel shows. */
export function fromDetail(from: From, j: JobDetail, fresh = false): Job {
  const job = fromSummary(from, j);
  const timeline: TimelineStep[] = j.timeline.map((t) => {
    const [label, status] = stepLabel(t.step, from.name);
    return { label, at: fromIso(t.at), status, sub: t.step === 'CANCELLED' && j.cancelReason ? j.cancelReason : undefined };
  });
  const cancelled = j.timeline.find((t) => t.step === 'CANCELLED');
  return {
    ...job,
    fresh,
    elder: j.elderSummary,
    address: j.address?.text ?? '',
    instr: j.instructions || '—',
    timeline: timeline.length ? timeline : job.timeline,
    completedAt: j.completion ? fromIso(j.completion.actualEnd) : undefined,
    notes: j.completion ? j.completion.note || 'No notes.' : undefined,
    declineReason: j.decline ? declineLabel(j.decline.reason) : undefined,
    cancelledAt: cancelled ? fromIso(cancelled.at) : undefined,
    cancelledAfterAccept: !!cancelled && j.timeline.some((t) => t.step === 'ACCEPTED'),
    carelink: {
      ...job.carelink!,
      detailed: true,
      elderSummary: j.elderSummary,
      languages: j.languages,
      bookedBy: j.bookedBy,
      accessNotes: j.address?.accessNotes ?? null,
      declineNote: j.decline?.note ?? null,
      actualStart: j.completion ? fromIso(j.completion.actualStart) : undefined,
    },
  };
}

// ---------- Calls ----------

export interface PortalAnswer {
  application: Application;
  credentials: Credentials | null;
  credentialsLost: boolean;
}

export interface ApplicationCreate {
  organisationName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  services: string[];
  webhookUrl: string;
  password: string;
  agreedToTerms: true;
}

const base = (partner: string) => `/api/partners/${encodeURIComponent(partner)}`;
const post = <T>(partner: string, path: string, body?: unknown, headers?: HeadersInit) =>
  serverFetch<T>(base(partner) + path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers });

export const apply = (partner: string, a: ApplicationCreate) =>
  post<{ applicationId: string; application: Application; portal: { email: string } | null }>(partner, '/applications', a);

export const portalSignIn = (partner: string, email: string, password: string) =>
  post<PortalAnswer>(partner, '/portal/session', { email, password });
export const portalApplication = (partner: string) => serverFetch<PortalAnswer>(`${base(partner)}/portal/application`);
export const reissueCredentials = (partner: string) => post<{ credentials: Credentials }>(partner, '/portal/credentials/reissue');
export const sendTestEvent = (partner: string) => post<unknown>(partner, '/portal/webhook/test');
export const changeWebhookUrl = (partner: string, url: string) =>
  serverFetch<{ application: Application }>(`${base(partner)}/portal/webhook`, { method: 'PUT', body: JSON.stringify({ url }) });

export const testConnection = (partner: string) => post<{ ok: true; ms: number; at: string }>(partner, '/connection/test');

/** Every job the partner has sent BrightHands, a page of 100 at a time. */
export async function listJobs(partner: string): Promise<JobSummary[]> {
  const all: JobSummary[] = [];
  for (let page = 0; ; page++) {
    const p = await serverFetch<JobPage>(`${base(partner)}/jobs?size=100&page=${page}`);
    all.push(...p.items);
    if (all.length >= p.totalElements || !p.items.length) return all;
  }
}

const key = (k: string) => ({ 'Idempotency-Key': k });
const job = (id: string) => `/jobs/${encodeURIComponent(id)}`;

export const getJob = (partner: string, id: string) => serverFetch<JobDetail>(base(partner) + job(id));
export const acceptJob = (partner: string, id: string, k: string) => post<JobDetail>(partner, `${job(id)}/accept`, undefined, key(k));
export const declineJob = (partner: string, id: string, reason: DeclineCode, note: string | null, k: string) =>
  post<JobDetail>(partner, `${job(id)}/decline`, { reason, note }, key(k));
export const completeJob = (partner: string, id: string, actualStart: string, actualEnd: string, note: string | null, k: string) =>
  post<JobDetail>(partner, `${job(id)}/complete`, { actualStart, actualEnd, note }, key(k));

export const listWebhooks = (partner: string) => serverFetch<{ deliveries: WebhookDelivery[] }>(`${base(partner)}/webhooks`);

/** Each request that reaches any partner's webhook, as it arrives. The browser reconnects by itself if the stream drops. */
export function onWebhook(fn: (d: WebhookDelivery) => void): () => void {
  const source = new EventSource('/api/events');
  source.addEventListener('delivery', (e) => fn(JSON.parse((e as MessageEvent<string>).data) as WebhookDelivery));
  return () => source.close();
}
