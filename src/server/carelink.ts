// CareLink's Open API, as the provider's server calls it (carelink-platform/docs/api/open-platform.yaml).

import { randomUUID } from 'node:crypto';

const OPEN = '/api/open/v1';
const SCOPES = 'open-platform/jobs.read open-platform/jobs.write';
/** A token is renewed this long before it runs out, so none expires on the way. */
const RENEW_MS = 60_000;
const TIMEOUT_MS = 10_000;

/** RFC 9457 problem details, as CareLink answers errors. */
export interface Problem {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  fields?: Record<string, string>;
}

/** A call CareLink refused, or could not be made. `status` and `code` are what the portal's API answers with. */
export class CareLinkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title ?? problem.code);
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
  }
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface IssuedCredentials extends ClientCredentials {
  webhookSecret: string;
}

export type JobStatus = 'NEW' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'CANCELLED';

export interface JobSummary {
  id: string;
  version: number;
  status: JobStatus;
  serviceName: string;
  district: string;
  areaName: string;
  scheduledStart: string;
  durationMinutes: number;
  respondBy: string | null;
  receivedAt: string;
  cancelReason: string | null;
}

export interface JobDecline {
  reason: 'OUTSIDE_HOURS' | 'NO_PRACTITIONER' | 'OUTSIDE_AREA' | 'OTHER';
  note?: string | null;
}

export interface JobCompletion {
  actualStart: string;
  actualEnd: string;
  note?: string | null;
}

export interface Job extends JobSummary {
  elderSummary: string;
  languages: string;
  bookedBy: string;
  instructions: string | null;
  address: { text: string; accessNotes: string | null } | null;
  timeline: { step: JobStatus | 'DISPATCHED'; at: string }[];
  completion: JobCompletion | null;
  decline: JobDecline | null;
}

export interface JobPage {
  items: JobSummary[];
  page: number;
  size: number;
  totalElements: number;
  counts: Record<JobStatus, number>;
}

export interface Application {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  organisationName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  services: string[];
  webhookUrl: string;
  submittedAt: string;
  reviewedAt: string | null;
  reason: string | null;
  suspended: boolean;
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

interface CallOptions {
  method?: string;
  body?: unknown;
  bearer?: string;
  idempotencyKey?: string;
}

export interface CareLinkOptions {
  baseUrl: string;
  /** Read on every call, so credentials collected or rotated while running are used at once. */
  credentials: () => ClientCredentials | null;
  fetch?: typeof fetch;
  now?: () => number;
}

export type CareLink = ReturnType<typeof createCareLink>;

export function createCareLink({ baseUrl, credentials, fetch: fetchFn = fetch, now = Date.now }: CareLinkOptions) {
  let cached: { clientId: string; token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(`${baseUrl}${OPEN}${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new CareLinkError({ status: 502, code: 'CARELINK_UNREACHABLE', detail: `CareLink could not be reached: ${(e as Error).message}` });
    }
  }

  async function failure(res: Response): Promise<CareLinkError> {
    const text = await res.text().catch(() => '');
    let body: Partial<Problem> & { error?: string } = {};
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: a proxy's error page, say.
    }
    const code = body.code ?? body.error?.toUpperCase() ?? (res.status >= 500 ? 'CARELINK_ERROR' : `HTTP_${res.status}`);
    return new CareLinkError({ ...body, status: res.status, code, detail: body.detail ?? (text.slice(0, 200) || res.statusText) });
  }

  async function call<T>(path: string, { method = 'GET', body, bearer, idempotencyKey }: CallOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw await failure(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async function fetchToken(creds: ClientCredentials): Promise<string> {
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await send('/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPES }).toString(),
    });
    if (!res.ok) throw await failure(res);
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    cached = { clientId: creds.clientId, token: access_token, expiresAt: now() + expires_in * 1000 };
    return access_token;
  }

  /** A current access token for the provider's server: the cached one, or a new one. */
  async function token(fresh = false): Promise<string> {
    const creds = credentials();
    if (!creds) {
      throw new CareLinkError({ status: 409, code: 'NOT_CONNECTED', detail: 'No CareLink credentials yet. They are collected once the application is approved.' });
    }
    if (!fresh && cached && cached.clientId === creds.clientId && cached.expiresAt - RENEW_MS > now()) return cached.token;
    // Calls made while a token is being fetched wait for that one.
    pending ??= fetchToken(creds).finally(() => {
      pending = null;
    });
    return pending;
  }

  /** A job API call with the server's token. A token CareLink no longer takes is replaced, once. */
  async function jobCall<T>(path: string, options: CallOptions = {}): Promise<T> {
    const bearer = await token();
    try {
      return await call<T>(path, { ...options, bearer });
    } catch (e) {
      if (!(e instanceof CareLinkError) || e.status !== 401) throw e;
      cached = null;
      return call<T>(path, { ...options, bearer: await token(true) });
    }
  }

  const key = (k?: string) => k || randomUUID();
  const job = (id: string) => `/jobs/${encodeURIComponent(id)}`;

  return {
    // Onboarding and the Partner Portal, as the person who applied
    submitApplication: (application: ApplicationCreate) =>
      call<{ applicationId: string }>('/applications', { method: 'POST', body: application }),
    signIn: (email: string, password: string) =>
      call<{ accessToken: string; expiresIn: number }>('/portal/sessions', { method: 'POST', body: { email, password } }),
    getApplication: (portalToken: string) => call<Application>('/portal/application', { bearer: portalToken }),
    collectCredentials: (portalToken: string) =>
      call<IssuedCredentials>('/portal/credentials/collect', { method: 'POST', bearer: portalToken }),
    rotateClientSecret: (portalToken: string) =>
      call<ClientCredentials>('/portal/credentials/rotate', { method: 'POST', bearer: portalToken }),
    rotateWebhookSecret: (portalToken: string) =>
      call<{ webhookSecret: string }>('/portal/webhook/secret/rotate', { method: 'POST', bearer: portalToken }),
    sendTestEvent: (portalToken: string) => call<unknown>('/portal/webhook/test', { method: 'POST', bearer: portalToken }),
    updateWebhook: (portalToken: string, settings: { url: string; events: string[] }) =>
      call<{ url: string; events: string[] }>('/portal/webhook', { method: 'PUT', body: settings, bearer: portalToken }),

    // The provider's server
    token,
    listJobs: (query: { status?: string; page?: number; size?: number } = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
      const qs = params.size ? `?${params}` : '';
      return jobCall<JobPage>(`/jobs${qs}`);
    },
    getJob: (id: string) => jobCall<Job>(job(id)),
    acceptJob: (id: string, idempotencyKey?: string) =>
      jobCall<Job>(`${job(id)}/accept`, { method: 'POST', idempotencyKey: key(idempotencyKey) }),
    declineJob: (id: string, decline: JobDecline, idempotencyKey?: string) =>
      jobCall<Job>(`${job(id)}/decline`, { method: 'POST', body: decline, idempotencyKey: key(idempotencyKey) }),
    completeJob: (id: string, completion: JobCompletion, idempotencyKey?: string) =>
      jobCall<Job>(`${job(id)}/complete`, { method: 'POST', body: completion, idempotencyKey: key(idempotencyKey) }),
  };
}
