// Every partner, connected: its registry entry, its data, its connector, its webhook endpoint and its API for the
// browser. Partners come and go at runtime; nothing here names any one of them.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApi, clientCredentials, webhookSecrets } from './api.ts';
import { createCareLink } from './carelink.ts';
import { readJson, sendJson, sendProblem } from './http.ts';
import { PROTOCOLS, PartnerRegistry, checkPartner, partnerSettings, type PartnerRecord, type Protocol } from './partners.ts';
import type { Settings } from './settings.ts';
import { Store } from './store.ts';
import type { DeliveryRecord } from './store.ts';
import { WEBHOOK_PREFIX, createWebhookReceiver } from './webhooks.ts';

const HEARTBEAT_MS = 25_000;

interface Connection {
  record: PartnerRecord;
  receive: ReturnType<typeof createWebhookReceiver>;
  api: ReturnType<typeof createApi>;
}

export interface HubOptions {
  dataDir: string;
  settings: Settings;
  now?: () => number;
  fetch?: typeof fetch;
}

export async function createHub({ dataDir, settings, now = Date.now, fetch: fetchFn }: HubOptions) {
  const registry = new PartnerRegistry(dataDir);
  await registry.load(settings, new Date(now()));
  const connections = new Map<string, Connection>();
  const listeners = new Set<ServerResponse>();

  /** Tells every open page what reached a partner's webhook. */
  function broadcast(partnerId: string, record: DeliveryRecord): void {
    const line = `event: delivery\ndata: ${JSON.stringify({ ...record, partnerId })}\n\n`;
    for (const res of listeners) res.write(line);
  }

  /** The connector for the partner's protocol. Today there is one; another protocol adds a case here. */
  async function connect(record: PartnerRecord): Promise<Connection> {
    const store = new Store(registry.dataFile(record.id));
    await store.load();
    const set = () => partnerSettings(settings, record.id);
    switch (record.protocol satisfies Protocol) {
      case 'carelink-open-platform': {
        const carelink = createCareLink({ baseUrl: record.baseUrl.replace(/\/+$/, ''), credentials: () => clientCredentials(set(), store), fetch: fetchFn, now });
        return {
          record,
          receive: createWebhookReceiver({ store, secrets: () => webhookSecrets(set(), store), onDelivery: (r) => broadcast(record.id, r), now }),
          api: createApi({ store, carelink, settings: set, now }),
        };
      }
    }
  }

  for (const record of registry.list()) connections.set(record.id, await connect(record));

  /** What the browser is told of a partner. */
  const describe = (c: Connection) => ({
    id: c.record.id,
    name: c.record.name,
    protocol: c.record.protocol,
    protocolName: PROTOCOLS[c.record.protocol].name,
    canApply: PROTOCOLS[c.record.protocol].canApply,
    baseUrl: c.record.baseUrl,
    addedAt: c.record.addedAt,
    webhookPath: `${WEBHOOK_PREFIX}${c.record.id}`,
    ...c.api.summary(),
  });

  /** `POST /webhooks/<partner id>`: open to anyone, since the partner's signature is what lets a webhook in. */
  async function handleWebhook(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const c = connections.get(decodeURIComponent(path.slice(WEBHOOK_PREFIX.length)));
    if (!c) return void sendProblem(res, 404, 'NO_SUCH_PARTNER', 'No partner sends webhooks here.');
    await c.receive(req, res);
  }

  /** `/api/partners…` and `/api/events`, for a signed-in person. */
  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (path === '/api/events' && req.method === 'GET') return events(req, res);
    if (path === '/api/protocols' && req.method === 'GET') {
      return sendJson(res, 200, { protocols: Object.entries(PROTOCOLS).map(([id, p]) => ({ id, ...p })) });
    }

    if (path === '/api/partners') {
      if (req.method === 'GET') return sendJson(res, 200, { partners: [...connections.values()].map(describe) });
      if (req.method === 'POST') return add(req, res);
      return sendProblem(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed here.`);
    }

    const m = /^\/api\/partners\/([^/]+)(?:\/(.*))?$/.exec(path);
    const c = m && connections.get(decodeURIComponent(m[1]));
    if (!m || !c) return sendProblem(res, 404, 'NOT_FOUND', 'No such partner or endpoint.');
    if (m[2] === undefined) {
      if (req.method === 'GET') return sendJson(res, 200, describe(c));
      if (req.method === 'DELETE') {
        await registry.remove(c.record.id);
        connections.delete(c.record.id);
        return void res.writeHead(204).end();
      }
      return sendProblem(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed here.`);
    }
    await c.api.handle(req, res, m[2]);
  }

  async function add(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Partial<PartnerRecord>;
    try {
      body = (await readJson(req)) as Partial<PartnerRecord>;
    } catch {
      return sendProblem(res, 400, 'BAD_JSON', 'The request body is not JSON.');
    }
    const record = {
      id: String(body.id ?? '').trim(),
      name: String(body.name ?? '').trim(),
      protocol: body.protocol as Protocol,
      baseUrl: String(body.baseUrl ?? '').trim().replace(/\/+$/, ''),
      addedAt: new Date(now()).toISOString(),
    };
    const fields = checkPartner(record, registry.list().map((p) => p.id));
    if (Object.keys(fields).length) return sendProblem(res, 400, 'VALIDATION_FAILED', 'Some fields need fixing.', { fields });
    await registry.add(record);
    const c = await connect(record);
    connections.set(record.id, c);
    sendJson(res, 201, describe(c));
  }

  /** Server-sent events: every request that reaches any partner's webhook, as it arrives. */
  function events(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    listeners.add(res);
    const beat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(beat);
      listeners.delete(res);
    });
  }

  return { handleApi, handleWebhook, partners: () => registry.list() };
}
