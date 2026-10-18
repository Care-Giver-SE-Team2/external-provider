import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CareLinkError, createCareLink, type ClientCredentials } from './carelink.ts';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A stand-in for CareLink: answers each call with the next reply, and keeps what it was sent. */
function fakeCareLink(replies: (Response | Error)[]) {
  const seen: Seen[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, method: init.method ?? 'GET', headers: { ...(init.headers as Record<string, string>) }, body: String(init.body ?? '') });
    const next = replies.shift();
    if (!next) throw new Error('no reply left');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { seen, fetchFn };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = (t: string, expiresIn = 3600) => json(200, { access_token: t, expires_in: expiresIn, token_type: 'Bearer' });
const page = () => json(200, { items: [], page: 0, size: 20, totalElements: 0, counts: {} });

const CREDS: ClientCredentials = { clientId: 'client-1', clientSecret: 's3cret' };

function client(replies: (Response | Error)[], creds: ClientCredentials | null = CREDS, clock = { t: 0 }) {
  const fake = fakeCareLink(replies);
  const carelink = createCareLink({ baseUrl: 'https://carelink.test', credentials: () => creds, fetch: fake.fetchFn, now: () => clock.t });
  return { carelink, seen: fake.seen, clock };
}

describe('the CareLink client', () => {
  test('gets a token with the client-credentials grant and reuses it until a minute before it runs out', async () => {
    const { carelink, seen, clock } = client([token('t1'), page(), page(), token('t2'), page()]);
    await carelink.listJobs();
    clock.t = (3600 - 61) * 1000;
    await carelink.listJobs();
    clock.t = (3600 - 59) * 1000;
    await carelink.listJobs();

    const [tokenCall, first, second, , third] = seen;
    assert.equal(tokenCall.url, 'https://carelink.test/api/open/v1/oauth2/token');
    assert.equal(tokenCall.headers.Authorization, `Basic ${Buffer.from('client-1:s3cret').toString('base64')}`);
    assert.match(tokenCall.body, /grant_type=client_credentials/);
    assert.equal(first.headers.Authorization, 'Bearer t1');
    assert.equal(second.headers.Authorization, 'Bearer t1');
    assert.equal(third.headers.Authorization, 'Bearer t2');
  });

  test('replaces a token CareLink refuses, once', async () => {
    const { carelink, seen } = client([token('old'), json(401, { status: 401, code: 'INVALID_TOKEN' }), token('new'), page()]);
    await carelink.listJobs();
    assert.equal(seen[1].headers.Authorization, 'Bearer old');
    assert.match(seen[2].url, /\/oauth2\/token$/);
    assert.equal(seen[3].headers.Authorization, 'Bearer new');
  });

  test('sends an Idempotency-Key on every job action, the one given or a new one', async () => {
    const job = json(200, { id: 'JOB-1' });
    const { carelink, seen } = client([token('t'), job, json(200, {}), json(200, {})]);
    await carelink.acceptJob('JOB-1', 'key-123');
    await carelink.declineJob('JOB-1', { reason: 'OUTSIDE_AREA' });
    await carelink.completeJob('JOB-1', { actualStart: '2026-10-17T10:00:00+08:00', actualEnd: '2026-10-17T13:00:00+08:00' });
    assert.equal(seen[1].url, 'https://carelink.test/api/open/v1/jobs/JOB-1/accept');
    assert.equal(seen[1].headers['Idempotency-Key'], 'key-123');
    assert.match(seen[2].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
    assert.deepEqual(JSON.parse(seen[2].body), { reason: 'OUTSIDE_AREA' });
    assert.ok(seen[3].headers['Idempotency-Key']);
  });

  test('turns a problem answer into a CareLinkError with its code', async () => {
    const { carelink } = client([token('t'), json(409, { status: 409, code: 'JOB_CANCELLED', detail: 'The family cancelled the booking.' })]);
    await assert.rejects(carelink.acceptJob('JOB-1'), (e: CareLinkError) =>
      e.status === 409 && e.code === 'JOB_CANCELLED' && e.message === 'The family cancelled the booking.');
  });

  test('says so when CareLink cannot be reached, or there are no credentials yet', async () => {
    await assert.rejects(client([new TypeError('fetch failed')]).carelink.listJobs(), { code: 'CARELINK_UNREACHABLE', status: 502 });
    await assert.rejects(client([], null).carelink.listJobs(), { code: 'NOT_CONNECTED' });
  });

  test('a token endpoint refusal keeps its OAuth error', async () => {
    const { carelink } = client([json(401, { error: 'invalid_client' })]);
    await assert.rejects(carelink.listJobs(), { code: 'INVALID_CLIENT', status: 401 });
  });
});
