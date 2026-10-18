// Every time is Singapore wall-clock time held as a UTC timestamp, so it formats the same on any machine.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SGT_OFFSET_MS = 8 * 3600_000;

/** A time in October 2026, Singapore time. */
export const T = (d: number, h: number, m: number, s = 0): number => Date.UTC(2026, 9, d, h, m, s);

/** Now, in Singapore. CareLink's jobs and webhooks run on the real clock. */
export const now = (): number => Date.now() + SGT_OFFSET_MS;

// BrightHands' own pages are static, laid out around Mon 12 Oct 2026, 09:16. Their clock runs on from there.
const DEMO_START = T(12, 9, 16);
const loadedAt = Date.now();
export const demoNow = (): number => DEMO_START + (Date.now() - loadedAt);

const p2 = (n: number): string => String(n).padStart(2, '0');
const at = (t: number): Date => new Date(t);

export const dayOfMonth = (t: number): number => at(t).getUTCDate();
export const day = (t: number): string => `${DAYS[at(t).getUTCDay()]} ${at(t).getUTCDate()} ${MONTHS[at(t).getUTCMonth()]}`;
export const hm = (t: number): string => `${p2(at(t).getUTCHours())}:${p2(at(t).getUTCMinutes())}`;
export const hms = (t: number): string => `${hm(t)}:${p2(at(t).getUTCSeconds())}`;
export const when = (t: number): string => `${day(t)}, ${hm(t)}`;
export const whenSeconds = (t: number): string => `${day(t)}, ${hms(t)}`;

/** "09:14" for today, otherwise "Sun 11 Oct, 16:05". */
export const received = (t: number): string => (day(t) === day(now()) ? hm(t) : when(t));

export const schedule = (start: number, minutes: number): string =>
  `${day(start)}, ${hm(start)}–${hm(start + minutes * 60_000)}`;

export const durationShort = (m: number): string => (m < 60 ? `${m} min` : `${+(m / 60).toFixed(1)} h`);

export const durationLong = (m: number): string => {
  if (m < 60) return `${m} minutes`;
  if (m === 60) return '1 hour';
  return `${+(m / 60).toFixed(1)} hours`;
};

/** The value a datetime-local input takes. */
export const toLocalInput = (t: number): string =>
  `${at(t).getUTCFullYear()}-${p2(at(t).getUTCMonth() + 1)}-${p2(at(t).getUTCDate())}T${hm(t)}`;

export const fromLocalInput = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};

/** A time CareLink sent (`2026-10-17T10:00:00+08:00`, or UTC), as this portal holds times. */
export const fromIso = (iso: string): number => Date.parse(iso) + SGT_OFFSET_MS;

/** A datetime-local value, which is Singapore time, as CareLink takes times. */
export const localInputToIso = (s: string): string => `${s}:00+08:00`;

export const money = (n: number): string =>
  `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
