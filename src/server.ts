import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { SESSION_PATH, createAuth, readStaff } from './server/auth.ts';
import { ENV_FILE, ROOT, loadConfig } from './server/config.ts';
import { createHub } from './server/hub.ts';
import { partnerSettings } from './server/partners.ts';
import { createSettings } from './server/settings.ts';
import { WEBHOOK_PREFIX } from './server/webhooks.ts';

const settings = createSettings({
  envFile: ENV_FILE,
  watchFile: true,
  onReload: () => console.log('.env changed: settings read again.'),
});
const config = loadConfig(settings);
const PUBLIC_DIR = join(ROOT, 'public');

const hub = await createHub({ dataDir: config.dataDir, settings });
const auth = createAuth({ dataDir: config.dataDir, secureCookies: config.secureCookies, trustProxy: config.trustProxy });

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host}`);

  try {
    // Open to anyone: the partner's signature, not a session, is what lets a webhook in.
    if (pathname.startsWith(WEBHOOK_PREFIX)) return await hub.handleWebhook(req, res, pathname);
    if (pathname === SESSION_PATH) return await auth.handle(req, res);
    if (pathname.startsWith('/api/')) {
      if (!auth.guard(req, res)) return;
      return await hub.handleApi(req, res, pathname);
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end();
    return;
  }

  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));

  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(config.port, () => {
  console.log(`External provider running at http://localhost:${config.port}`);
  for (const p of hub.partners()) {
    const missing = partnerSettings(settings, p.id).names.filter((n) => !n.set).map((n) => n.name);
    console.log(`Partner ${p.name} (${p.id}) at ${p.baseUrl}; webhooks at ${WEBHOOK_PREFIX}${p.id}` +
      (missing.length ? `; not set (fine if collected from the partner): ${missing.join(', ')}` : ''));
  }
  if (!hub.partners().length) console.log('No partners yet. Add one on the Partners page.');
  void readStaff(config.dataDir).then((staff) => {
    if (!staff.length) console.warn('No staff accounts yet, so nobody can sign in. Add one with: npm run add-staff -- <username>');
  });
});
