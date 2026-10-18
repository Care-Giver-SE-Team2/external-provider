import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { SESSION_PATH, createAuth, hashPassword, verifyPassword, writeStaff } from './auth.ts';

const PASSWORD = 'correct horse battery';
const MIN = 60_000;

describe('passwords', () => {
  test('a hash verifies its own password and no other', async () => {
    const hash = await hashPassword(PASSWORD);
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verifyPassword(PASSWORD, hash), true);
    assert.equal(await verifyPassword('wrong password', hash), false);
    assert.notEqual(await hashPassword(PASSWORD), hash, 'each hash has its own salt');
  });
});

describe('signing in and the session', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let clock: number;
  let auth: ReturnType<typeof createAuth>;
  let hash: string;

  before(async () => {
    hash = await hashPassword(PASSWORD);
    // The session endpoint, and one guarded endpoint standing in for /api/carelink/*.
    server = createServer((req, res) => {
      if (req.url === SESSION_PATH) return void auth.handle(req, res);
      if (!auth.guard(req, res)) return;
      res.writeHead(200).end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'provider-auth-'));
    await writeStaff(dir, [{ username: 'alan', name: 'Alan Tan', role: 'Manager', passwordHash: hash }]);
    clock = Date.parse('2026-10-17T01:00:00Z');
    auth = createAuth({ dataDir: dir, secureCookies: false, now: () => clock });
  });
  afterEach(() => rm(dir, { recursive: true }));

  const signIn = (username: string, password: string) =>
    fetch(base + SESSION_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });

  async function signedIn() {
    const res = await signIn('alan', PASSWORD);
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const { csrfToken } = (await res.json()) as { csrfToken: string };
    return { cookie, csrfToken };
  }

  const api = (method: string, headers: Record<string, string> = {}) => fetch(`${base}/api/carelink/jobs`, { method, headers });

  test('the right password gets a session cookie that page scripts and other sites cannot use', async () => {
    const res = await signIn('Alan', PASSWORD);
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie')!;
    assert.match(setCookie, /^bh_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict$/);
    const body = (await res.json()) as { user: { name: string }; csrfToken: string };
    assert.equal(body.user.name, 'Alan Tan');
    assert.ok(body.csrfToken.length >= 43);
  });

  test('the cookie is Secure when the portal is served over HTTPS', async () => {
    auth = createAuth({ dataDir: dir, secureCookies: true, now: () => clock });
    assert.match((await signIn('alan', PASSWORD)).headers.get('set-cookie')!, /; Secure$/);
  });

  test('a wrong password and an unknown username get the same answer', async () => {
    const wrong = await signIn('alan', 'not the password');
    const unknown = await signIn('nobody', PASSWORD);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrong.json(), await unknown.json());
    assert.equal(wrong.headers.get('set-cookie'), null);
  });

  test('without a session the API answers 401', async () => {
    assert.equal((await api('GET')).status, 401);
    assert.equal((await api('GET', { Cookie: 'bh_session=made-up' })).status, 401);
    assert.equal((await fetch(base + SESSION_PATH)).status, 401);
  });

  test('with a session, reads pass; changes need the CSRF token as well', async () => {
    const { cookie, csrfToken } = await signedIn();
    assert.equal((await api('GET', { Cookie: cookie })).status, 200);
    assert.equal((await api('POST', { Cookie: cookie })).status, 403);
    assert.equal((await api('POST', { Cookie: cookie, 'X-CSRF-Token': 'x'.repeat(csrfToken.length) })).status, 403);
    assert.equal((await api('POST', { Cookie: cookie, 'X-CSRF-Token': csrfToken })).status, 200);
  });

  test('the page can ask who is signed in, and get the CSRF token again after a reload', async () => {
    const { cookie, csrfToken } = await signedIn();
    const res = await fetch(base + SESSION_PATH, { headers: { Cookie: cookie } });
    assert.deepEqual(await res.json(), { user: { username: 'alan', name: 'Alan Tan', role: 'Manager' }, csrfToken });
  });

  test('a session ends after an hour unused, or 8 hours in all', async () => {
    const idle = await signedIn();
    clock += 59 * MIN;
    assert.equal((await api('GET', { Cookie: idle.cookie })).status, 200);
    clock += 61 * MIN;
    assert.equal((await api('GET', { Cookie: idle.cookie })).status, 401);

    const busy = await signedIn();
    for (let i = 0; i < 9; i++) {
      clock += 55 * MIN;
      await api('GET', { Cookie: busy.cookie });
    }
    assert.equal((await api('GET', { Cookie: busy.cookie })).status, 401);
  });

  test('signing out ends the session, and needs the CSRF token', async () => {
    const { cookie, csrfToken } = await signedIn();
    assert.equal((await fetch(base + SESSION_PATH, { method: 'DELETE', headers: { Cookie: cookie } })).status, 403);
    const out = await fetch(base + SESSION_PATH, { method: 'DELETE', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken } });
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await api('GET', { Cookie: cookie })).status, 401);
  });

  test('signing in again replaces the session rather than keeping the old one', async () => {
    const first = await signedIn();
    const res = await fetch(base + SESSION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: first.cookie },
      body: JSON.stringify({ username: 'alan', password: PASSWORD }),
    });
    assert.notEqual(res.headers.get('set-cookie')!.split(';')[0], first.cookie);
    assert.equal((await api('GET', { Cookie: first.cookie })).status, 401);
  });

  test('five wrong passwords in a row lock the username for 15 minutes, even with the right one', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await signIn('alan', 'wrong password')).status, 401);
    const locked = await signIn('alan', PASSWORD);
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('retry-after'), '900');
    assert.equal(((await locked.json()) as { code: string }).code, 'TOO_MANY_ATTEMPTS');

    clock += 15 * MIN + 1;
    assert.equal((await signIn('alan', PASSWORD)).status, 200);
  });

  test('a right password clears the count of wrong ones', async () => {
    for (let i = 0; i < 4; i++) await signIn('alan', 'wrong password');
    await signedIn();
    for (let i = 0; i < 4; i++) await signIn('alan', 'wrong password');
    assert.equal((await signIn('alan', PASSWORD)).status, 200);
  });

  test('an unknown username locks the same way, so a lock gives nothing away', async () => {
    for (let i = 0; i < 5; i++) await signIn('ghost', 'wrong password');
    assert.equal((await signIn('ghost', 'wrong password')).status, 429);
  });

  test('one address guessing across many usernames is locked out after 20 wrong passwords', async () => {
    for (let i = 0; i < 20; i++) await signIn(`user${i}`, 'wrong password');
    assert.equal((await signIn('alan', PASSWORD)).status, 429);
  });

  test('with no staff accounts, signing in says how to add one', async () => {
    await writeStaff(dir, []);
    const res = await signIn('alan', PASSWORD);
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, 'NO_STAFF');
  });
});
