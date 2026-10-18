// For testing: asks a local CareLink for a value-added service as a family member would, so CareLink dispatches a
// real job to its providers, BrightHands among them. It signs in to CareLink as the family member and calls the
// same API CareLink's own web app does. Never point it at a CareLink with real people in it.
//
//   npm run carelink:request-job
//   npm run carelink:request-job -- --user demo-fiona --service "Light housekeeping" --hours 6 --elder Grace
//
// CareLink offers the request to a provider only when the elder's primary caregiver is not free for it, and the
// start is at least 5 hours away (carelink-platform/docs/section5/decisions.md, D16 and D17).

import { parseArgs } from 'node:util';
import { askHidden } from './server/prompt.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173' },
    user: { type: 'string', default: 'demo-fiona' },
    service: { type: 'string', default: 'Light housekeeping' },
    hours: { type: 'string', default: '6' },
    elder: { type: 'string' },
    note: { type: 'string', default: 'Test request for the BrightHands integration.' },
  },
});

const base = values.url.replace(/\/+$/, '');
const hours = Number(values.hours);
if (!(hours >= 5)) {
  console.error('--hours must be at least 5: CareLink offers nothing nearer than that to a provider.');
  process.exit(1);
}

// ---------- A small cookie jar: CareLink's session cookie and its CSRF cookie ----------

const jar = new Map<string, string>();

function keepCookies(res: Response): void {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const xsrf = jar.get('XSRF-TOKEN');
  if (xsrf && method !== 'GET') headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  } catch (e) {
    console.error(`CareLink could not be reached at ${base}: ${(e as Error).message}. Is its web app running (npm run dev in frontend/)?`);
    process.exit(1);
  }
  keepCookies(res);
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const p = JSON.parse(text) as { code?: string; detail?: string; title?: string };
      detail = [p.code, p.detail ?? p.title].filter(Boolean).join(': ');
    } catch {
      // Not JSON.
    }
    throw new Error(`${method} ${path} answered ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The next whole or half hour at least `h` hours from now, as CareLink takes it: Singapore wall-clock time. */
function startIn(h: number): string {
  const sgt = new Date(Date.now() + 8 * 3600_000 + h * 3600_000);
  sgt.setUTCSeconds(0, 0);
  const m = sgt.getUTCMinutes();
  if (m % 30) sgt.setUTCMinutes(m + (30 - (m % 30)));
  return sgt.toISOString().slice(0, 19);
}

// ---------- The request ----------

try {
  const password = process.env.CARELINK_FAMILY_PASSWORD ?? (await askHidden(`CareLink password for ${values.user}: `));

  await call('GET', '/api/auth/csrf');
  await call('POST', '/api/auth/login', { username: values.user, password });
  await call('GET', '/api/auth/csrf'); // A new CSRF token goes with the new session.

  const elders = await call<{ id: number; fullName: string }[]>('GET', '/api/family/elders');
  const elder = values.elder ? elders.find((e) => e.fullName.toLowerCase().includes(values.elder!.toLowerCase())) : elders[0];
  if (!elder) throw new Error(`${values.user} has no elder${values.elder ? ` matching "${values.elder}"` : ''}. Their elders: ${elders.map((e) => e.fullName).join(', ') || 'none'}.`);

  const services = await call<{ id: number; name: string; durationMinutes: number; status: string }[]>('GET', '/api/family/value-added-services');
  const service = services.find((s) => s.name.toLowerCase() === values.service.toLowerCase());
  if (!service) throw new Error(`No service "${values.service}". CareLink offers: ${services.map((s) => s.name).join(', ')}.`);

  const requestedSchedule = startIn(hours);
  const r = await call<{ id: number; status: string; visitId: number | null; requestedSchedule: string }>('POST', '/api/family/value-added-service-requests', {
    elderId: elder.id,
    valueAddedServiceId: service.id,
    requestedSchedule,
    specialInstructions: values.note,
  });

  console.log(`Requested ${service.name} for ${elder.fullName} at ${r.requestedSchedule.replace('T', ' ')} (Singapore time), as ${values.user}.`);
  console.log(`CareLink request ${r.id}: ${r.status}${r.visitId ? `, visit ${r.visitId}` : ''}.`);
  console.log('');
  console.log('If the elder\'s primary caregiver was busy (or has none), CareLink offered it to a provider that offers');
  console.log(`${service.name}. BrightHands shows it under Jobs → New within about 10 seconds.`);
  console.log('Nothing there? The primary caregiver was free and took it: try --hours with a time they are busy.');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
