// Small helpers for answering requests with node:http.

import type { IncomingMessage, ServerResponse } from 'node:http';

export class BodyTooLarge extends Error {}

/** The request body as raw bytes, refused once it passes `limit`. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const raw = await readBody(req, limit);
  return raw.length ? JSON.parse(raw.toString('utf8')) : {};
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** An error as RFC 9457 problem details, the same shape CareLink answers with. */
export function sendProblem(res: ServerResponse, status: number, code: string, detail: string, extra: object = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/problem+json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ...extra, status, code, detail }));
}
