// Signing in to the portal's server, and calling it as the signed-in person.

export interface StaffUser {
  username: string;
  name: string;
  role: string;
}

interface Problem {
  status: number;
  code: string;
  detail?: string;
  /** For a validation failure, each field's problem. */
  fields?: Record<string, string>;
}

/** A refusal from the server, with its problem `code` to branch on and a `detail` to show. */
export class ServerError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(p: Problem) {
    super(p.detail ?? p.code);
    this.status = p.status;
    this.code = p.code;
    this.fields = p.fields ?? {};
  }
}

/** Sent with every request that changes something. The session cookie itself is never readable here. */
let csrfToken = '';

/** Told when the server says the session has ended, so the page can show the sign-in again. */
let onSignedOut: () => void = () => {};
export const whenSignedOut = (fn: () => void): void => {
  onSignedOut = fn;
};

/** A call to the portal's server. Anything but a 2xx throws a ServerError; network failures throw it too. */
export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ServerError({ status: 0, code: 'SERVER_UNREACHABLE', detail: 'The portal’s server could not be reached.' });
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

  const problem = (await res.json().catch(() => ({}))) as Partial<Problem>;
  const err = new ServerError({ status: res.status, code: problem.code ?? `HTTP_${res.status}`, detail: problem.detail, fields: problem.fields });
  if (err.code === 'SIGN_IN_NEEDED' && path !== '/api/session') onSignedOut();
  return Promise.reject(err);
}

interface Signed {
  user: StaffUser;
  csrfToken: string;
}

/** Who is signed in, from the session cookie: after a reload, the same person still is. */
export async function currentUser(): Promise<StaffUser | null> {
  try {
    const s = await serverFetch<Signed>('/api/session');
    csrfToken = s.csrfToken;
    return s.user;
  } catch {
    return null;
  }
}

export async function signIn(username: string, password: string): Promise<StaffUser> {
  const s = await serverFetch<Signed>('/api/session', { method: 'POST', body: JSON.stringify({ username, password }) });
  csrfToken = s.csrfToken;
  return s.user;
}

export async function signOut(): Promise<void> {
  try {
    await serverFetch('/api/session', { method: 'DELETE' });
  } finally {
    csrfToken = '';
  }
}
