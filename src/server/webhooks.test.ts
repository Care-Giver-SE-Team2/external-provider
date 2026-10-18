import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Store } from './store.ts';
import { createWebhookReceiver, verifySignature } from './webhooks.ts';

// webhooks.md, section 5
const VECTOR = {
  secret: 'whsec_example_do_not_use',
  timestamp: '1791864000',
  body: '{"id":"dlv_0000test","type":"ping","createdAt":"2026-10-13T12:00:00+08:00","data":{}}',
  signature: 'v1=929d8bf95a92a264f468f1d6f0be8e2b88f07be25e4610b319fdb3e9987be1f8',
};

const sign = (secret: string, timestamp: string, body: string) =>
  `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

describe('verifySignature', () => {
  const at = Number(VECTOR.timestamp);
  const body = Buffer.from(VECTOR.body);

  test('accepts the test vector from the contract', () => {
    assert.equal(verifySignature([VECTOR.secret], VECTOR.timestamp, body, VECTOR.signature, at), 'ok');
  });

  test('refuses another secret, another body or no signature', () => {
    assert.equal(verifySignature(['whsec_other'], VECTOR.timestamp, body, VECTOR.signature, at), 'bad_signature');
    assert.equal(verifySignature([VECTOR.secret], VECTOR.timestamp, Buffer.from(`${VECTOR.body} `), VECTOR.signature, at), 'bad_signature');
    assert.equal(verifySignature([VECTOR.secret], VECTOR.timestamp, body, undefined, at), 'bad_signature');
  });

  test('refuses a timestamp more than 300 seconds off, either way', () => {
    assert.equal(verifySignature([VECTOR.secret], VECTOR.timestamp, body, VECTOR.signature, at + 300), 'ok');
    assert.equal(verifySignature([VECTOR.secret], VECTOR.timestamp, body, VECTOR.signature, at + 301), 'bad_timestamp');
    assert.equal(verifySignature([VECTOR.secret], VECTOR.timestamp, body, VECTOR.signature, at - 301), 'bad_timestamp');
    assert.equal(verifySignature([VECTOR.secret], undefined, body, VECTOR.signature, at), 'bad_timestamp');
  });

  test('during a rotation, accepts either of two signatures and either of two secrets', () => {
    const header = `${sign('whsec_new', VECTOR.timestamp, VECTOR.body)},${VECTOR.signature}`;
    assert.equal(verifySignature([VECTOR.secret], VECTOR.timestamp, body, header, at), 'ok');
    assert.equal(verifySignature(['whsec_new'], VECTOR.timestamp, body, header, at), 'ok');
    assert.equal(verifySignature(['whsec_other', VECTOR.secret], VECTOR.timestamp, body, VECTOR.signature, at), 'ok');
  });
});

describe('the webhook receiver', () => {
  const SECRET = 'whsec_test';
  let dir: string;
  let store: Store;
  let server: Server;
  let url: string;
  let handled: string[];
  let nowMs: number;

  before(async () => {
    server = createServer((req, res) => void receive(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/carelink`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  let receive: ReturnType<typeof createWebhookReceiver>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'provider-'));
    store = new Store(join(dir, 'partners', 'carelink.json'));
    handled = [];
    nowMs = Date.parse('2026-10-15T01:02:11Z');
    receive = createWebhookReceiver({
      store,
      secrets: () => [SECRET],
      onDelivery: (r) => {
        if (r.outcome === 'processed') handled.push(r.id ?? '');
      },
      now: () => nowMs,
    });
  });

  const jobEvent = (id: string, type: string, jobId: string, version: number) =>
    JSON.stringify({ id, type, createdAt: '2026-10-15T09:02:11+08:00', data: { job: { id: jobId, version, status: type === 'job.cancelled' ? 'CANCELLED' : 'NEW' } } });

  async function deliver(body: string, { secret = SECRET, offsetS = 0 } = {}) {
    const ts = String(Math.floor(nowMs / 1000) + offsetS);
    const parsed = JSON.parse(body) as { id: string; type: string };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CareLink-Delivery': parsed.id,
        'X-CareLink-Event': parsed.type,
        'X-CareLink-Timestamp': ts,
        'X-CareLink-Signature': sign(secret, ts, body),
      },
      body,
    });
    return { status: res.status, body: (await res.json()) as { outcome: string } };
  }

  test('handles a new job once, and answers a repeat of it without handling it again', async () => {
    const body = jobEvent('dlv_1', 'job.dispatched', 'JOB-1', 0);
    assert.deepEqual(await deliver(body), { status: 200, body: { outcome: 'processed', detail: 'New job.' } });
    assert.equal((await deliver(body)).body.outcome, 'duplicate');
    assert.deepEqual(handled, ['dlv_1']);
    assert.deepEqual(store.data.deliveries.map((d) => d.outcome), ['duplicate', 'processed']);
  });

  test('ignores an event older than one already held for the job', async () => {
    await deliver(jobEvent('dlv_c', 'job.cancelled', 'JOB-2', 2));
    const late = await deliver(jobEvent('dlv_d', 'job.dispatched', 'JOB-2', 0));
    assert.equal(late.status, 200);
    assert.equal(late.body.outcome, 'stale');
    assert.equal(store.data.jobVersions['JOB-2'], 2);
    assert.deepEqual(handled, ['dlv_c']);
  });

  test('refuses a bad signature or an old timestamp with 401, and handles nothing', async () => {
    assert.equal((await deliver(jobEvent('dlv_x', 'job.dispatched', 'JOB-3', 0), { secret: 'whsec_wrong' })).status, 401);
    assert.equal((await deliver(jobEvent('dlv_y', 'job.dispatched', 'JOB-3', 0), { offsetS: -301 })).status, 401);
    assert.deepEqual(handled, []);
    assert.deepEqual(store.data.deliveries.map((d) => d.outcome), ['rejected', 'rejected']);
    // A rejected delivery is not remembered as handled, so CareLink's retry with a good signature goes through.
    assert.equal((await deliver(jobEvent('dlv_x', 'job.dispatched', 'JOB-3', 0))).body.outcome, 'processed');
  });

  test('acknowledges a ping and an event type it does not know', async () => {
    assert.equal((await deliver(JSON.stringify({ id: 'dlv_p', type: 'ping', createdAt: '', data: {} }))).status, 200);
    assert.equal((await deliver(JSON.stringify({ id: 'dlv_n', type: 'job.renamed', createdAt: '', data: {} }))).status, 200);
  });

  test('remembers handled deliveries across a restart', async () => {
    await deliver(jobEvent('dlv_1', 'job.dispatched', 'JOB-1', 0));
    const saved = JSON.parse(await readFile(join(dir, 'partners', 'carelink.json'), 'utf8'));
    assert.equal(saved.deliveries[0].id, 'dlv_1');

    const reloaded = new Store(join(dir, 'partners', 'carelink.json'));
    await reloaded.load();
    assert.ok(reloaded.hasDelivery('dlv_1'));
    await rm(dir, { recursive: true });
  });
});
