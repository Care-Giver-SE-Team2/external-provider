import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createHub } from './hub.ts';
import { PartnerRegistry, checkPartner, partnerSettings, settingsPrefix } from './partners.ts';
import { createSettings } from './settings.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'provider-partners-'));
});
afterEach(() => rm(dir, { recursive: true }));

const settingsOf = (env: Record<string, string>) => createSettings({ envFile: null, env });

describe('settings', () => {
  test('the environment wins over .env, and an empty value counts as unset', async () => {
    const file = join(dir, '.env');
    await writeFile(file, 'A=from-file\nB=from-file\nC=\n');
    const s = createSettings({ envFile: file, env: { A: 'from-env' } });
    assert.equal(s.get('A'), 'from-env');
    assert.equal(s.get('B'), 'from-file');
    assert.equal(s.get('C'), undefined);
    assert.equal(s.get('D'), undefined);
  });

  test('.env is read again when it changes', async () => {
    const file = join(dir, '.env');
    await writeFile(file, 'KEY=one\n');
    const reloaded = Promise.withResolvers<void>();
    const s = createSettings({ envFile: file, watchFile: true, env: {}, onReload: () => reloaded.resolve() });
    await writeFile(file, 'KEY=two\n');
    await reloaded.promise;
    assert.equal(s.get('KEY'), 'two');
    s.close();
  });
});

describe('a partner', () => {
  test('is named in settings after its ID', () => {
    assert.equal(settingsPrefix('carelink'), 'PARTNER_CARELINK_');
    assert.equal(settingsPrefix('home-match'), 'PARTNER_HOME_MATCH_');
  });

  test('has its credentials from settings, and says which are missing without their values', () => {
    const set = partnerSettings(settingsOf({ PARTNER_ACME_CLIENT_ID: 'id-1', PARTNER_ACME_WEBHOOK_SECRET: 'whsec_a, whsec_b' }), 'acme');
    assert.equal(set.clientId, 'id-1');
    assert.equal(set.clientSecret, undefined);
    assert.deepEqual(set.webhookSecrets, ['whsec_a', 'whsec_b']);
    assert.deepEqual(set.names, [
      { name: 'PARTNER_ACME_CLIENT_ID', set: true },
      { name: 'PARTNER_ACME_CLIENT_SECRET', set: false },
      { name: 'PARTNER_ACME_WEBHOOK_SECRET', set: true },
    ]);
  });

  test('CareLink still reads the settings named before partners were data', () => {
    const set = partnerSettings(settingsOf({ CARELINK_CLIENT_ID: 'old', PARTNER_CARELINK_CLIENT_SECRET: 'new' }), 'carelink');
    assert.equal(set.clientId, 'old');
    assert.equal(set.clientSecret, 'new');
  });

  test('needs a usable ID, a name, a known protocol and a URL', () => {
    assert.deepEqual(checkPartner({ id: 'acme', name: 'Acme', protocol: 'carelink-open-platform', baseUrl: 'https://api.acme.sg' }, []), {});
    const errs = checkPartner({ id: 'Acme!', name: ' ', protocol: 'soap' as never, baseUrl: 'acme.sg' }, []);
    assert.deepEqual(Object.keys(errs).sort(), ['baseUrl', 'id', 'name', 'protocol']);
    assert.ok(checkPartner({ id: 'acme', name: 'A', protocol: 'carelink-open-platform', baseUrl: 'http://x' }, ['acme']).id);
  });
});

describe('the registry', () => {
  test('starts empty on a new server, and keeps what is added', async () => {
    const r = new PartnerRegistry(dir);
    await r.load(settingsOf({}));
    assert.deepEqual(r.list(), []);
    await r.add({ id: 'acme', name: 'Acme', protocol: 'carelink-open-platform', baseUrl: 'https://api.acme.sg', addedAt: '2026-10-18T00:00:00Z' });

    const again = new PartnerRegistry(dir);
    await again.load(settingsOf({}));
    assert.equal(again.get('acme')?.name, 'Acme');
    await again.remove('acme');
    assert.deepEqual(again.list(), []);
  });

  test('moves a server that worked with CareLink before partners were data', async () => {
    await writeFile(join(dir, 'carelink.json'), JSON.stringify({ application: null, credentials: null, deliveries: [], jobVersions: {} }));
    const r = new PartnerRegistry(dir);
    await r.load(settingsOf({ CARELINK_URL: 'http://localhost:5173' }));
    assert.deepEqual(r.list().map((p) => [p.id, p.protocol, p.baseUrl]), [['carelink', 'carelink-open-platform', 'http://localhost:5173']]);
    assert.ok(JSON.parse(await readFile(join(dir, 'partners', 'carelink.json'), 'utf8')));
  });
});

describe('the hub', () => {
  let server: Server;
  let base: string;

  async function start(env: Record<string, string>) {
    const hub = await createHub({ dataDir: dir, settings: settingsOf(env) });
    server = createServer((req, res) => {
      const { pathname } = new URL(req.url ?? '/', 'http://x');
      void (pathname.startsWith('/webhooks/') ? hub.handleWebhook(req, res, pathname) : hub.handleApi(req, res, pathname));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const add = (p: object) => fetch(`${base}/api/partners`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });

  function signedPing(secret: string, id = 'dlv_1') {
    const body = JSON.stringify({ id, type: 'ping', createdAt: '', data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    return { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-CareLink-Timestamp': ts, 'X-CareLink-Signature': `v1=${sig}` } };
  }

  test('adds a partner with no code: it lists, says which settings it needs, and has its own webhook URL', async () => {
    await start({ PARTNER_ACME_WEBHOOK_SECRET: 'whsec_acme' });
    const res = await add({ id: 'acme', name: 'Acme Care', protocol: 'carelink-open-platform', baseUrl: 'https://api.acme.sg/' });
    assert.equal(res.status, 201);
    const added = (await res.json()) as { webhookPath: string; baseUrl: string; settings: { name: string; set: boolean }[] };
    assert.equal(added.webhookPath, '/webhooks/acme');
    assert.equal(added.baseUrl, 'https://api.acme.sg');
    assert.deepEqual(added.settings.map((s) => s.set), [false, false, true]);

    const { partners } = (await (await fetch(`${base}/api/partners`)).json()) as { partners: { id: string }[] };
    assert.deepEqual(partners.map((p) => p.id), ['acme']);

    assert.equal((await fetch(`${base}/webhooks/acme`, signedPing('whsec_acme'))).status, 200);
    assert.equal((await fetch(`${base}/webhooks/acme`, signedPing('whsec_other', 'dlv_2'))).status, 401);
    assert.equal((await fetch(`${base}/webhooks/nobody`, signedPing('whsec_acme'))).status, 404);
  });

  test('keeps each partner apart: its own secret, its own log', async () => {
    await start({ PARTNER_ONE_WEBHOOK_SECRET: 'whsec_one', PARTNER_TWO_WEBHOOK_SECRET: 'whsec_two' });
    await add({ id: 'one', name: 'One', protocol: 'carelink-open-platform', baseUrl: 'https://one.sg' });
    await add({ id: 'two', name: 'Two', protocol: 'carelink-open-platform', baseUrl: 'https://two.sg' });
    assert.equal((await fetch(`${base}/webhooks/one`, signedPing('whsec_two'))).status, 401);
    assert.equal((await fetch(`${base}/webhooks/two`, signedPing('whsec_two'))).status, 200);

    const log = async (id: string) => ((await (await fetch(`${base}/api/partners/${id}/webhooks`)).json()) as { deliveries: { outcome: string }[] }).deliveries.map((d) => d.outcome);
    assert.deepEqual(await log('one'), ['rejected']);
    assert.deepEqual(await log('two'), ['processed']);
  });

  test('refuses a partner it could not work with, and removes one', async () => {
    await start({});
    const bad = await add({ id: 'x', name: '', protocol: 'smtp', baseUrl: 'nope' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(((await bad.json()) as { fields: object }).fields).sort(), ['baseUrl', 'id', 'name', 'protocol']);

    await add({ id: 'acme', name: 'Acme', protocol: 'carelink-open-platform', baseUrl: 'https://api.acme.sg' });
    assert.equal((await add({ id: 'acme', name: 'Again', protocol: 'carelink-open-platform', baseUrl: 'https://a.sg' })).status, 400);
    assert.equal((await fetch(`${base}/api/partners/acme`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/partners/acme`)).status, 404);
    assert.equal((await fetch(`${base}/webhooks/acme`, signedPing('x'))).status, 404);
  });
});
