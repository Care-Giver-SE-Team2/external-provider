// The partners BrightHands works with, as data (data/partners.json). Adding one needs no code, as long as it
// speaks a protocol this server has a connector for. Each partner's credentials come from settings named after it.

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from './settings.ts';

/** The APIs this server has a connector for. A partner with another API needs its connector written first. */
export const PROTOCOLS = {
  'carelink-open-platform': {
    name: 'CareLink Open Platform',
    /** Providers apply through the API and collect their credentials once approved. */
    canApply: true,
  },
} as const;

export type Protocol = keyof typeof PROTOCOLS;

export interface PartnerRecord {
  /** Lowercase letters, digits and dashes. Names its settings, its webhook URL and its data file. */
  id: string;
  name: string;
  protocol: Protocol;
  /** The partner's address. CareLink's Open API is under /api/open/v1 on it. */
  baseUrl: string;
  addedAt: string;
}

const ID = /^[a-z][a-z0-9-]{1,30}$/;

/** What a new partner needs, field by field. Empty when it is fine. */
export function checkPartner(p: Partial<PartnerRecord>, taken: readonly string[]): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!p.id || !ID.test(p.id)) errs.id = '2 to 31 lowercase letters, digits or dashes, starting with a letter.';
  else if (taken.includes(p.id)) errs.id = 'Another partner has this ID.';
  if (!p.name?.trim() || p.name.trim().length > 100) errs.name = 'Enter a name, up to 100 characters.';
  if (!p.protocol || !Object.hasOwn(PROTOCOLS, p.protocol)) errs.protocol = 'Choose a protocol this portal supports.';
  if (!p.baseUrl || !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(p.baseUrl.trim())) errs.baseUrl = 'Enter a full URL, e.g. https://api.partner.sg';
  return errs;
}

// ---------- Settings named after the partner ----------

/** `carelink` → `PARTNER_CARELINK_`, `home-match` → `PARTNER_HOME_MATCH_`. */
export const settingsPrefix = (id: string): string => `PARTNER_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;

const KEYS = ['CLIENT_ID', 'CLIENT_SECRET', 'WEBHOOK_SECRET'] as const;

export interface PartnerSettings {
  clientId?: string;
  clientSecret?: string;
  /** Any of them verifies a webhook: several, comma-separated, while one is being rotated. */
  webhookSecrets: string[];
  /** Each setting's name and whether it is set. Never its value. */
  names: { name: string; set: boolean }[];
}

export function partnerSettings(settings: Settings, id: string): PartnerSettings {
  const prefix = settingsPrefix(id);
  // The names used before partners were data, kept so an existing .env still works.
  const legacy = id === 'carelink' ? 'CARELINK_' : null;
  const get = (key: (typeof KEYS)[number]) => settings.get(prefix + key) ?? (legacy ? settings.get(legacy + key) : undefined);
  const secrets = (get('WEBHOOK_SECRET') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    clientId: get('CLIENT_ID'),
    clientSecret: get('CLIENT_SECRET'),
    webhookSecrets: secrets,
    names: KEYS.map((k) => ({ name: prefix + k, set: !!get(k) })),
  };
}

// ---------- The registry ----------

export class PartnerRegistry {
  readonly #dir: string;
  #partners: PartnerRecord[] = [];
  #writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.#dir = dataDir;
  }

  get #file(): string {
    return join(this.#dir, 'partners.json');
  }

  /** The data file of one partner: its application, collected credentials and webhook log. */
  dataFile(id: string): string {
    return join(this.#dir, 'partners', `${id}.json`);
  }

  /**
   * Reads the registry. The first time, a server that already worked with CareLink before partners were data
   * gets CareLink as its first partner, with its data moved to where partner data now lives.
   */
  async load(settings: Settings, now = new Date()): Promise<void> {
    try {
      this.#partners = (JSON.parse(await readFile(this.#file, 'utf8')) as { partners: PartnerRecord[] }).partners;
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const oldData = join(this.#dir, 'carelink.json');
    const hadData = await access(oldData).then(() => true, () => false);
    if (hadData || settings.get('CARELINK_CLIENT_ID') || settings.get('PARTNER_CARELINK_CLIENT_ID')) {
      this.#partners = [{
        id: 'carelink',
        name: 'CareLink',
        protocol: 'carelink-open-platform',
        baseUrl: settings.get('CARELINK_URL') ?? 'http://localhost:5173',
        addedAt: now.toISOString(),
      }];
      if (hadData) {
        await mkdir(join(this.#dir, 'partners'), { recursive: true, mode: 0o700 });
        await rename(oldData, this.dataFile('carelink'));
      }
    }
    await this.#save();
  }

  list(): readonly PartnerRecord[] {
    return this.#partners;
  }

  get(id: string): PartnerRecord | undefined {
    return this.#partners.find((p) => p.id === id);
  }

  async add(p: PartnerRecord): Promise<void> {
    this.#partners = [...this.#partners, p];
    await this.#save();
  }

  /** Forgets the partner. Its data file stays, so adding it again with the same ID picks up where it was. */
  async remove(id: string): Promise<void> {
    this.#partners = this.#partners.filter((p) => p.id !== id);
    await this.#save();
  }

  #save(): Promise<void> {
    const snapshot = JSON.stringify({ partners: this.#partners }, null, 2);
    this.#writing = this.#writing.then(async () => {
      await mkdir(this.#dir, { recursive: true, mode: 0o700 });
      await writeFile(`${this.#file}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${this.#file}.tmp`, this.#file);
    });
    return this.#writing;
  }
}
