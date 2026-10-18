// What the server must remember of one partner across restarts, in one JSON file (data/partners/<id>.json). It
// holds secrets, so only the owner can read it.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
/** CareLink signs with the old and the new secret for a day after a rotation. */
const SECRET_OVERLAP_MS = DAY_MS;
/** CareLink can resend a delivery for 30 days, so its ID is kept that long. */
const DELIVERY_KEEP_MS = 30 * DAY_MS;
const MAX_REJECTED = 200;

/** The application as CareLink last answered about it. */
export interface StoredApplication {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  organisationName: string;
  contactEmail: string;
  services: string[];
  webhookUrl: string;
  submittedAt: string;
  reviewedAt: string | null;
  reason: string | null;
  suspended: boolean;
}

export interface WebhookSecret {
  secret: string;
  /** When it was issued. Once a newer one is a day old, this one is dropped. */
  issuedAt: string;
}

export interface StoredCredentials {
  clientId: string;
  clientSecret: string;
  /** Newest first. */
  webhookSecrets: WebhookSecret[];
  collectedAt: string;
}

/** What became of a webhook. Every one except `rejected` was answered 2xx. */
export type DeliveryOutcome = 'processed' | 'duplicate' | 'stale' | 'rejected';

export interface DeliveryRecord {
  /** The delivery ID, or null when a rejected request did not name one. */
  id: string | null;
  event: string;
  jobId: string | null;
  version: number | null;
  receivedAt: string;
  outcome: DeliveryOutcome;
  /** The HTTP status the server answered with. */
  status: number;
  detail: string;
}

export interface StoreData {
  application: StoredApplication | null;
  credentials: StoredCredentials | null;
  /** The webhook log, newest first. */
  deliveries: DeliveryRecord[];
  /** The highest version seen of each job, so an older event arriving late is ignored. */
  jobVersions: Record<string, number>;
}

const empty = (): StoreData => ({ application: null, credentials: null, deliveries: [], jobVersions: {} });

export class Store {
  readonly #file: string;
  #data: StoreData = empty();
  #writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<void> {
    try {
      this.#data = { ...empty(), ...(JSON.parse(await readFile(this.#file, 'utf8')) as Partial<StoreData>) };
      // Kept before the status was: pending until CareLink is asked again.
      const a = this.#data.application;
      if (a && !a.status) {
        const defaults: Omit<StoredApplication, 'id' | 'contactEmail' | 'submittedAt'> =
          { status: 'PENDING', organisationName: '', services: [], webhookUrl: '', reviewedAt: null, reason: null, suspended: false };
        this.#data.application = Object.assign(defaults, a);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }

  get data(): Readonly<StoreData> {
    return this.#data;
  }

  /** Changes the data and writes it out. Writes run one at a time, each replacing the file whole. */
  update(fn: (data: StoreData) => void, at = Date.now()): Promise<void> {
    fn(this.#data);
    this.#prune(at);
    const snapshot = JSON.stringify(this.#data, null, 2);
    this.#writing = this.#writing.then(async () => {
      await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 });
      const tmp = `${this.#file}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.#file);
    });
    return this.#writing;
  }

  hasDelivery(id: string): boolean {
    return this.#data.deliveries.some((d) => d.id === id && d.outcome !== 'rejected');
  }

  #prune(at: number): void {
    // Rejected requests are kept only to show in the log, and anyone can send them, so only the latest are kept.
    const keepAfter = at - DELIVERY_KEEP_MS;
    let rejected = 0;
    this.#data.deliveries = this.#data.deliveries.filter(
      (d) => Date.parse(d.receivedAt) > keepAfter && (d.outcome !== 'rejected' || ++rejected <= MAX_REJECTED),
    );

    const creds = this.#data.credentials;
    if (creds && creds.webhookSecrets.length > 1) {
      const newest = Date.parse(creds.webhookSecrets[0].issuedAt);
      if (at - newest > SECRET_OVERLAP_MS) creds.webhookSecrets = creds.webhookSecrets.slice(0, 1);
    }
  }
}
