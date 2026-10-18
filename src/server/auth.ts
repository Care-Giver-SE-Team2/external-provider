// Who may use the portal: BrightHands staff, signed in with a password, holding a session cookie.
// Everything under /api/carelink acts as BrightHands on CareLink, so none of it answers without a session.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { readJson, sendJson, sendProblem } from './http.ts';

export const SESSION_PATH = '/api/session';
const COOKIE = 'bh_session';

const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 60 * 60 * 1000;
/** Wrong passwords in a row before a username is locked, and for how long. CareLink's portal does the same. */
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
/** Wrong passwords one address may send in LOCK_MS, whatever the usernames: guessing across many accounts. */
const MAX_FAILURES_PER_IP = 20;
export const MIN_PASSWORD = 10;

// ---------- Passwords ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

/** `scrypt$N$r$p$salt$hash`, salt and hash in base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = await scrypt(password, salt, keylen, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

/** Checked against when the username is unknown, so a wrong username takes as long as a wrong password. */
const DECOY = hashPassword(randomBytes(16).toString('hex'));

// ---------- Staff accounts (data/staff.json) ----------

export interface StaffMember {
  username: string;
  name: string;
  role: string;
  passwordHash: string;
}

const staffFile = (dir: string) => join(dir, 'staff.json');

/** Read on every sign-in, so an account added with `npm run add-staff` works without a restart. */
export async function readStaff(dir: string): Promise<StaffMember[]> {
  try {
    return (JSON.parse(await readFile(staffFile(dir), 'utf8')) as { staff: StaffMember[] }).staff;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export async function writeStaff(dir: string, staff: StaffMember[]): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${staffFile(dir)}.tmp`;
  await writeFile(tmp, JSON.stringify({ staff }, null, 2), { mode: 0o600 });
  await rename(tmp, staffFile(dir));
}

export const normaliseUsername = (u: string) => u.trim().toLowerCase();

// ---------- Sessions, CSRF and sign-in ----------

export interface Session {
  username: string;
  name: string;
  role: string;
  /** Sent back in `X-CSRF-Token` on every request that changes something. Another site cannot read it. */
  csrfToken: string;
  createdAt: number;
  lastSeen: number;
}

interface Failures {
  count: number;
  /** When the count started, or when the lock ends once locked. */
  since: number;
  lockedUntil: number;
}

export interface AuthOptions {
  dataDir: string;
  /** Mark the cookie `Secure`: on wherever the portal is served over HTTPS. */
  secureCookies: boolean;
  /** Behind one reverse proxy, the caller is the last `X-Forwarded-For` entry, not the proxy. */
  trustProxy?: boolean;
  now?: () => number;
}

const token = () => randomBytes(32).toString('base64url');

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export function createAuth({ dataDir, secureCookies, trustProxy = false, now = Date.now }: AuthOptions) {
  const sessions = new Map<string, Session>();
  const byUser = new Map<string, Failures>();
  const byIp = new Map<string, Failures>();

  const setCookie = (res: ServerResponse, value: string, maxAgeS?: number) =>
    res.setHeader('Set-Cookie', [
      `${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
      ...(secureCookies ? ['Secure'] : []),
      ...(maxAgeS === undefined ? [] : [`Max-Age=${maxAgeS}`]),
    ].join('; '));

  /** The request's session, if it has one that has not run out. Using it keeps it alive. */
  function current(req: IncomingMessage): [id: string, session: Session] | null {
    const id = cookie(req, COOKIE);
    const s = id ? sessions.get(id) : undefined;
    if (!id || !s) return null;
    const t = now();
    if (t - s.createdAt > SESSION_MAX_MS || t - s.lastSeen > SESSION_IDLE_MS) {
      sessions.delete(id);
      return null;
    }
    s.lastSeen = t;
    return [id, s];
  }

  const changes = (req: IncomingMessage) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET');

  function csrfOk(req: IncomingMessage, s: Session): boolean {
    const given = Buffer.from(String(req.headers['x-csrf-token'] ?? ''));
    const expected = Buffer.from(s.csrfToken);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** Lets the request through with its session, or answers 401 or 403 itself and gives null. */
  function guard(req: IncomingMessage, res: ServerResponse): Session | null {
    const found = current(req);
    if (!found) {
      sendProblem(res, 401, 'SIGN_IN_NEEDED', 'Sign in to the portal.');
      return null;
    }
    if (changes(req) && !csrfOk(req, found[1])) {
      sendProblem(res, 403, 'CSRF_TOKEN_INVALID', 'The request did not carry this session’s CSRF token. Reload the page.');
      return null;
    }
    return found[1];
  }

  // ---------- Failed sign-ins ----------

  function lockedFor(map: Map<string, Failures>, key: string): number {
    const f = map.get(key);
    return f && f.lockedUntil > now() ? f.lockedUntil - now() : 0;
  }

  function fail(map: Map<string, Failures>, key: string, max: number): void {
    const t = now();
    let f = map.get(key);
    if (!f || t - f.since > LOCK_MS) f = { count: 0, since: t, lockedUntil: 0 };
    f.count += 1;
    if (f.count >= max) f.lockedUntil = t + LOCK_MS;
    map.set(key, f);
  }

  /** Forgets sessions and failures that have run out, so the maps do not grow. */
  function sweep(): void {
    const t = now();
    for (const [id, s] of sessions) if (t - s.createdAt > SESSION_MAX_MS || t - s.lastSeen > SESSION_IDLE_MS) sessions.delete(id);
    for (const map of [byUser, byIp]) for (const [k, f] of map) if (f.lockedUntil < t && t - f.since > LOCK_MS) map.delete(k);
  }
  setInterval(sweep, 60_000).unref();

  const tooMany = (res: ServerResponse, ms: number) => {
    const minutes = Math.ceil(ms / 60_000);
    res.setHeader('Retry-After', String(Math.ceil(ms / 1000)));
    sendProblem(res, 429, 'TOO_MANY_ATTEMPTS', `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, { retryAfter: Math.ceil(ms / 1000) });
  };

  const who = (s: Session) => ({ user: { username: s.username, name: s.name, role: s.role }, csrfToken: s.csrfToken });

  async function signIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req, 4 * 1024).catch(() => ({}))) as { username?: unknown; password?: unknown };
    const username = normaliseUsername(typeof body.username === 'string' ? body.username : '');
    const password = typeof body.password === 'string' ? body.password : '';
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim() : '';
    const ip = forwarded || req.socket.remoteAddress || 'unknown';

    // Locks are by the name typed, known or not, so a lock says nothing about which usernames exist.
    const locked = Math.max(lockedFor(byUser, username), lockedFor(byIp, ip));
    if (locked) return tooMany(res, locked);

    const staff = await readStaff(dataDir);
    if (!staff.length) {
      return sendProblem(res, 503, 'NO_STAFF', 'No staff accounts yet. Add one on the server with: npm run add-staff -- <username>');
    }
    const member = staff.find((m) => m.username === username);
    const ok = (await verifyPassword(password, member?.passwordHash ?? (await DECOY))) && !!member && !!password;
    if (!ok) {
      fail(byUser, username, MAX_FAILURES);
      fail(byIp, ip, MAX_FAILURES_PER_IP);
      return sendProblem(res, 401, 'INVALID_CREDENTIALS', 'Wrong username or password.');
    }

    byUser.delete(username);
    // A new session every sign-in: one that was set before signing in is never promoted.
    const old = current(req);
    if (old) sessions.delete(old[0]);
    const id = token();
    const t = now();
    const s: Session = { username: member.username, name: member.name, role: member.role, csrfToken: token(), createdAt: t, lastSeen: t };
    sessions.set(id, s);
    setCookie(res, id);
    sendJson(res, 200, who(s));
  }

  /** `/api/session`: GET who is signed in, POST to sign in, DELETE to sign out. */
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    switch (req.method) {
      case 'GET': {
        const found = current(req);
        if (!found) return sendProblem(res, 401, 'SIGN_IN_NEEDED', 'Sign in to the portal.');
        return sendJson(res, 200, who(found[1]));
      }
      case 'POST':
        return signIn(req, res);
      case 'DELETE': {
        const found = current(req);
        if (found && !csrfOk(req, found[1])) return void sendProblem(res, 403, 'CSRF_TOKEN_INVALID', 'Reload the page and sign out again.');
        if (found) sessions.delete(found[0]);
        setCookie(res, '', 0);
        res.writeHead(204).end();
        return;
      }
      default:
        res.writeHead(405, { Allow: 'GET, POST, DELETE' }).end();
    }
  }

  return { handle, guard };
}
