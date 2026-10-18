// The endpoint a partner speaking CareLink's Open Platform sends signed webhooks to (carelink-platform/docs/api/webhooks.md).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BodyTooLarge, readBody, sendJson } from './http.ts';
import type { JobSummary } from './carelink.ts';
import type { DeliveryOutcome, DeliveryRecord, Store } from './store.ts';

/** Each partner sends to its own URL: /webhooks/<partner id>. */
export const WEBHOOK_PREFIX = '/webhooks/';
const MAX_BODY = 64 * 1024;
/** A request signed further than this from our clock, either way, may be a replay. */
const TOLERANCE_S = 300;

export type Verdict = 'ok' | 'bad_signature' | 'bad_timestamp';

/**
 * Checks `X-CareLink-Signature`: HMAC-SHA256 over `{timestamp}.{raw body}`, against any of the secrets.
 * After a rotation the header carries two `v1=` values and we may hold two secrets: any pair matching is enough.
 */
export function verifySignature(
  secrets: readonly string[],
  timestamp: string | undefined,
  body: Buffer,
  header: string | undefined,
  nowS = Date.now() / 1000,
): Verdict {
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(nowS - Number(timestamp)) > TOLERANCE_S) return 'bad_timestamp';
  const given = (header ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .map((part) => Buffer.from(part.slice(3), 'utf8'));
  for (const secret of secrets) {
    const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex'), 'utf8');
    if (given.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected))) return 'ok';
  }
  return 'bad_signature';
}

interface Envelope {
  id?: unknown;
  type?: unknown;
  data?: { job?: Partial<JobSummary> };
}

export interface WebhookOptions {
  store: Store;
  secrets: () => string[];
  /** Told of every request logged, after it was answered. Only `processed` ones are new to act on. */
  onDelivery?: (record: DeliveryRecord) => void;
  now?: () => number;
}

export function createWebhookReceiver({ store, secrets, onDelivery, now = Date.now }: WebhookOptions) {
  return async function receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const at = now();
    const header = (name: string) => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const event = header('x-carelink-event') ?? 'unknown';
    const record = (outcome: DeliveryOutcome, status: number, detail: string, fields: Partial<DeliveryRecord> = {}) =>
      ({ id: header('x-carelink-delivery') ?? null, event, jobId: null, version: null, receivedAt: new Date(at).toISOString(), outcome, status, detail, ...fields }) satisfies DeliveryRecord;

    // Answers, and logs the answer. Every outcome but `rejected` is a 2xx, so CareLink stops sending it.
    const answer = async (r: DeliveryRecord) => {
      await store.update((d) => {
        d.deliveries.unshift(r);
      }, at);
      sendJson(res, r.status, { outcome: r.outcome, detail: r.detail });
      onDelivery?.(r);
    };

    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }

    let raw: Buffer;
    try {
      raw = await readBody(req, MAX_BODY);
    } catch (e) {
      if (!(e instanceof BodyTooLarge)) throw e;
      return answer(record('rejected', 413, 'Body over 64 KB.'));
    }

    const keys = secrets();
    if (!keys.length) return answer(record('rejected', 503, 'No webhook signing secret yet. It is collected once the application is approved.'));

    const verdict = verifySignature(keys, header('x-carelink-timestamp'), raw, header('x-carelink-signature'), at / 1000);
    if (verdict === 'bad_timestamp') return answer(record('rejected', 401, 'Timestamp missing or more than 5 minutes off.'));
    if (verdict === 'bad_signature') return answer(record('rejected', 401, 'Signature does not match.'));

    let body: Envelope;
    try {
      body = JSON.parse(raw.toString('utf8')) as Envelope;
    } catch {
      return answer(record('rejected', 400, 'Signed, but the body is not JSON.'));
    }

    const id = typeof body.id === 'string' ? body.id : header('x-carelink-delivery');
    if (!id) return answer(record('rejected', 400, 'No delivery ID.'));
    const job = body.data?.job;
    const fields: Partial<DeliveryRecord> = {
      id,
      event: typeof body.type === 'string' ? body.type : event,
      jobId: typeof job?.id === 'string' ? job.id : null,
      version: typeof job?.version === 'number' ? job.version : null,
    };

    // Delivery is at least once: a repeat is acknowledged and nothing more.
    if (store.hasDelivery(id)) return answer(record('duplicate', 200, 'Already handled.', fields));

    // Order is not guaranteed: an event older than what we hold for the job changes nothing.
    const held = fields.jobId ? store.data.jobVersions[fields.jobId] : undefined;
    if (fields.jobId && fields.version != null && held != null && fields.version < held) {
      return answer(record('stale', 200, `Version ${fields.version} is older than ${held}, already held.`, fields));
    }

    const detail =
      fields.event === 'job.dispatched' ? 'New job.' :
      fields.event === 'job.cancelled' ? 'Job cancelled.' :
      fields.event === 'ping' ? 'Test event.' :
      'Event type not known; ignored.';
    const done = record('processed', 200, detail, fields);
    await store.update((d) => {
      if (fields.jobId && fields.version != null) d.jobVersions[fields.jobId] = Math.max(fields.version, held ?? 0);
      d.deliveries.unshift(done);
    }, at);
    sendJson(res, 200, { outcome: done.outcome, detail });
    // The work after answering, within CareLink's 10 seconds or not.
    onDelivery?.(done);
  };
}
