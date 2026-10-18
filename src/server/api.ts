// One partner's API for the browser (`/api/partners/<id>/*`), for a partner speaking CareLink's Open Platform. The
// browser asks the server, and only the server talks to the partner, so the client secret, the webhook secret and
// the partner portal's password never stay in the browser.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { CareLinkError, type ApplicationCreate, type CareLink, type JobCompletion, type JobDecline } from './carelink.ts';
import { readJson, sendJson, sendProblem } from './http.ts';
import type { PartnerSettings } from './partners.ts';
import type { Store } from './store.ts';

export interface ApiOptions {
  store: Store;
  carelink: CareLink;
  /** Read on every call, so credentials put in `.env` while the server runs are used at once. */
  settings: () => PartnerSettings;
  now?: () => number;
}

/** What the browser is told of the credentials: never the secrets. */
function credentialsSummary(set: PartnerSettings, store: Store) {
  if (set.clientId && set.clientSecret) {
    return { clientId: set.clientId, source: 'settings' as const, webhookSecrets: set.webhookSecrets.length, collectedAt: null };
  }
  const c = store.data.credentials;
  return c && { clientId: c.clientId, source: 'collected' as const, webhookSecrets: c.webhookSecrets.length, collectedAt: c.collectedAt };
}

/** The client credentials in use: set by hand in the settings, or else collected from the partner's portal. */
export function clientCredentials(set: PartnerSettings, store: Store) {
  if (set.clientId && set.clientSecret) return { clientId: set.clientId, clientSecret: set.clientSecret };
  const c = store.data.credentials;
  return c && { clientId: c.clientId, clientSecret: c.clientSecret };
}

/** Every secret that may sign a webhook now. */
export function webhookSecrets(set: PartnerSettings, store: Store): string[] {
  return [...set.webhookSecrets, ...(store.data.credentials?.webhookSecrets.map((s) => s.secret) ?? [])];
}

export function createApi({ store, carelink, settings, now = Date.now }: ApiOptions) {
  // The person signed in to the partner's portal through this one. Kept in memory only: a restart signs out.
  let portal: { email: string; token: string; expiresAt: number } | null = null;

  function portalToken(): string {
    if (!portal || portal.expiresAt <= now()) {
      portal = null;
      throw new CareLinkError({ status: 401, code: 'PORTAL_SIGN_IN_NEEDED', detail: 'Sign in to the CareLink Partner Portal first.' });
    }
    return portal.token;
  }

  /** A Partner Portal call. A token CareLink no longer takes signs the person out. */
  async function asPortal<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = portalToken();
    try {
      return await fn(token);
    } catch (e) {
      if (e instanceof CareLinkError && e.status === 401) {
        portal = null;
        throw new CareLinkError({ status: 401, code: 'PORTAL_SIGN_IN_NEEDED', detail: 'The portal session ran out. Sign in again.' });
      }
      throw e;
    }
  }

  const iso = () => new Date(now()).toISOString();

  /** Collects the credentials once the application is approved, so the server can work jobs with no one copying them. */
  async function collectIfApproved(status: string, suspended: boolean): Promise<{ lost: boolean }> {
    if (status !== 'APPROVED' || suspended || clientCredentials(settings(), store)) return { lost: false };
    try {
      const issued = await asPortal(carelink.collectCredentials);
      await store.update((d) => {
        d.credentials = {
          clientId: issued.clientId,
          clientSecret: issued.clientSecret,
          webhookSecrets: [{ secret: issued.webhookSecret, issuedAt: iso() }],
          collectedAt: iso(),
        };
      });
      return { lost: false };
    } catch (e) {
      // Shown once and collected elsewhere: only new secrets help now.
      if (e instanceof CareLinkError && e.code === 'CREDENTIALS_COLLECTED') return { lost: true };
      throw e;
    }
  }

  async function portalApplication() {
    const a = await asPortal(carelink.getApplication);
    const application = {
      id: a.id, status: a.status, organisationName: a.organisationName, contactEmail: a.contactEmail, services: a.services,
      webhookUrl: a.webhookUrl, submittedAt: a.submittedAt, reviewedAt: a.reviewedAt, reason: a.reason, suspended: a.suspended,
    };
    await store.update((d) => {
      d.application = application;
    });
    const { lost } = await collectIfApproved(application.status, application.suspended);
    return { application, credentials: credentialsSummary(settings(), store), credentialsLost: lost };
  }

  /** What the browser is told of this partner's connection. */
  const summary = () => {
    const set = settings();
    return {
      application: store.data.application,
      credentials: credentialsSummary(set, store),
      settings: set.names,
      portal: portal && portal.expiresAt > now() ? { email: portal.email } : null,
    };
  };

  type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<unknown> | unknown;

  const routes: [method: string, path: RegExp, handler: Handler][] = [
    ['GET', /^state$/, () => summary()],

    // ---------- Joining the partner ----------

    ['POST', /^applications$/, async (req) => {
      const body = (await readJson(req)) as ApplicationCreate;
      const { applicationId } = await carelink.submitApplication(body);
      await store.update((d) => {
        d.application = {
          id: applicationId, status: 'PENDING', organisationName: body.organisationName, contactEmail: body.contactEmail,
          services: body.services, webhookUrl: body.webhookUrl, submittedAt: iso(), reviewedAt: null, reason: null, suspended: false,
        };
      });
      // Signed in to CareLink's portal with the password just chosen, so checking the status needs no second sign-in.
      try {
        const { accessToken, expiresIn } = await carelink.signIn(body.contactEmail, body.password);
        portal = { email: body.contactEmail, token: accessToken, expiresAt: now() + expiresIn * 1000 };
      } catch {
        // Then the person signs in when they check.
      }
      return { applicationId, application: store.data.application, portal: portal && { email: portal.email } };
    }],

    ['POST', /^portal\/session$/, async (req) => {
      const { email, password } = (await readJson(req)) as { email?: string; password?: string };
      const { accessToken, expiresIn } = await carelink.signIn(email ?? '', password ?? '');
      portal = { email: email ?? '', token: accessToken, expiresAt: now() + expiresIn * 1000 };
      return portalApplication();
    }],

    ['DELETE', /^portal\/session$/, () => {
      portal = null;
      return null;
    }],

    ['GET', /^portal\/application$/, () => portalApplication()],

    // New secrets, for when the ones CareLink showed once were lost.
    ['POST', /^portal\/credentials\/reissue$/, async () => {
      const client = await asPortal(carelink.rotateClientSecret);
      const { webhookSecret } = await asPortal(carelink.rotateWebhookSecret);
      await store.update((d) => {
        d.credentials = {
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          webhookSecrets: [{ secret: webhookSecret, issuedAt: iso() }, ...(d.credentials?.webhookSecrets ?? [])],
          collectedAt: iso(),
        };
      });
      return { credentials: credentialsSummary(settings(), store) };
    }],

    ['POST', /^portal\/webhook\/secret\/rotate$/, async () => {
      if (!store.data.credentials) {
        throw new CareLinkError({ status: 409, code: 'NOT_CONNECTED', detail: 'No collected credentials to rotate.' });
      }
      const { webhookSecret } = await asPortal(carelink.rotateWebhookSecret);
      await store.update((d) => {
        d.credentials!.webhookSecrets.unshift({ secret: webhookSecret, issuedAt: iso() });
      });
      return { credentials: credentialsSummary(settings(), store) };
    }],

    ['POST', /^portal\/webhook\/test$/, () => asPortal(carelink.sendTestEvent)],

    // Where CareLink sends webhooks. Both job events stay subscribed: this portal handles both.
    ['PUT', /^portal\/webhook$/, async (req) => {
      const { url } = (await readJson(req)) as { url?: string };
      const saved = await asPortal((t) => carelink.updateWebhook(t, { url: url ?? '', events: ['job.dispatched', 'job.cancelled'] }));
      await store.update((d) => {
        if (d.application) d.application.webhookUrl = saved.url;
      });
      return { application: store.data.application };
    }],

    // ---------- Working the partner's jobs ----------

    ['POST', /^connection\/test$/, async () => {
      const started = performance.now();
      await carelink.token(true);
      return { ok: true, ms: Math.round(performance.now() - started), at: iso() };
    }],

    ['GET', /^jobs$/, (req) => {
      const q = new URL(req.url ?? '', 'http://x').searchParams;
      const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
      return carelink.listJobs({ status: q.get('status') ?? undefined, page: num('page'), size: num('size') });
    }],

    ['GET', /^jobs\/([^/]+)$/, (_req, _res, [id]) => carelink.getJob(id)],

    ['POST', /^jobs\/([^/]+)\/accept$/, (req, _res, [id]) => carelink.acceptJob(id, idempotencyKey(req))],

    ['POST', /^jobs\/([^/]+)\/decline$/, async (req, _res, [id]) =>
      carelink.declineJob(id, (await readJson(req)) as JobDecline, idempotencyKey(req))],

    ['POST', /^jobs\/([^/]+)\/complete$/, async (req, _res, [id]) =>
      carelink.completeJob(id, (await readJson(req)) as JobCompletion, idempotencyKey(req))],

    // ---------- What the partner sent ----------

    ['GET', /^webhooks$/, () => ({ deliveries: store.data.deliveries })],
  ];

  /** Answers `sub`, the path after `/api/partners/<id>/`. */
  async function handle(req: IncomingMessage, res: ServerResponse, sub: string): Promise<void> {
    const matching = routes.filter(([, re]) => re.test(sub));
    const route = matching.find(([method]) => method === req.method);
    if (!route) {
      if (matching.length) sendProblem(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed here.`);
      else sendProblem(res, 404, 'NOT_FOUND', 'No such endpoint.');
      return;
    }
    const [, re, handler] = route;
    try {
      const params = (re.exec(sub) ?? []).slice(1).map(decodeURIComponent);
      const result = await handler(req, res, params);
      if (result == null) res.writeHead(204).end();
      else sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof CareLinkError) {
        // CareLink refusing the server's own token is a fault between the two servers, not the browser's.
        const status = e.status === 401 && e.code !== 'PORTAL_SIGN_IN_NEEDED' && e.code !== 'INVALID_CREDENTIALS' ? 502 : e.status;
        sendProblem(res, status, e.code, e.message, e.problem.fields ? { fields: e.problem.fields } : {});
      } else if (e instanceof SyntaxError) {
        sendProblem(res, 400, 'BAD_JSON', 'The request body is not JSON.');
      } else {
        console.error(e);
        sendProblem(res, 500, 'INTERNAL', 'Something went wrong on the server.');
      }
    }
  }

  return { handle, summary };
}

function idempotencyKey(req: IncomingMessage): string | undefined {
  const v = req.headers['idempotency-key'];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}
