// The server's own settings. Each partner's credentials are read separately (partners.ts), by naming convention.

import { join } from 'node:path';
import type { Settings } from './settings.ts';

export const ROOT = join(import.meta.dirname, '..', '..');
/** The settings file. Another can be named for a test run, so it leaves the real one alone. */
export const ENV_FILE = process.env.ENV_FILE ?? join(ROOT, '.env');

export interface Config {
  port: number;
  /** Where the server keeps what it must remember: staff, partners, and each partner's data. */
  dataDir: string;
  /** Mark the session cookie `Secure`, so it goes only over HTTPS. On wherever the portal is served over HTTPS. */
  secureCookies: boolean;
  /** Behind one reverse proxy: take the caller's address from the last `X-Forwarded-For` entry, which the proxy set. */
  trustProxy: boolean;
}

export function loadConfig(settings: Settings): Config {
  return {
    port: Number(settings.get('PORT') ?? 3000),
    dataDir: settings.get('DATA_DIR') ?? join(ROOT, 'data'),
    secureCookies: settings.get('SECURE_COOKIES') === 'true',
    trustProxy: settings.get('TRUST_PROXY') === 'true',
  };
}
