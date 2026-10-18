// Questions the views and actions both ask of the state.

import type { Job, JobStatus, Partner, Screen, State, Tab } from './types.js';

/** The partner whose page is open. */
export const openPartner = (s: State): Partner | null => s.partners.find((p) => p.id === s.partnerId) ?? null;

export const isApproved = (p: Partner | null): boolean => p?.app === 'approved';

/** Connected: approved, holding credentials, and the partner answered the last call. */
export const isConnected = (p: Partner): boolean => isApproved(p) && !!p.credentials && p.conn === 'connected';

export const connectedPartners = (s: State): Partner[] => s.partners.filter(isConnected);

const TAB_STATUSES: Record<Tab, JobStatus[]> = {
  new: ['new'],
  accepted: ['accepted'],
  completed: ['completed'],
  cancelled: ['cancelled', 'declined'],
};

/** Jobs from partners still on the list. A removed partner's jobs go with it. */
export const visibleJobs = (s: State): Job[] => s.jobs.filter((j) => s.partners.some((p) => p.id === j.partnerId));

/** The jobs in a tab, newest first, within the partner filter unless `allSources`. */
export const jobsIn = (s: State, tab: Tab, allSources = false): Job[] =>
  visibleJobs(s)
    .filter((j) => TAB_STATUSES[tab].includes(j.status) && (allSources || s.srcFilter === 'all' || j.partnerId === s.srcFilter))
    .sort((a, b) => b.received - a.received);

export const tabOf = (job: Job): Tab => (job.status === 'declined' ? 'cancelled' : job.status);

/** The selected job, or the first one in the tab, since the panel layout always shows one. */
export function currentJob(s: State): Job | null {
  const list = jobsIn(s, s.tab);
  return list.find((j) => j.id === s.sel) ?? list[0] ?? null;
}

/** Screens that sit on one partner's page. */
export const PARTNER_SCREENS: ReadonlySet<Screen> = new Set(['apply', 'status', 'connection', 'webhooks']);

/**
 * Where a partner's page opens. A partner one applies to through its API starts with the application; any other
 * is joined outside this portal, so its page opens on the connection and the settings it needs.
 */
export function connectionScreen(p: Partner): Screen {
  if (!p.canApply) return 'connection';
  switch (p.app) {
    case 'none':
      return 'apply';
    case 'pending':
    case 'rejected':
      return 'status';
    case 'approved':
      return 'connection';
  }
}

/** A partner's own address in the portal. */
export const partnerHref = (p: { id: string }, tab = ''): string => `#/partners/${encodeURIComponent(p.id)}${tab ? `/${tab}` : ''}`;

/**
 * The webhook URL to give a partner: this portal's address with the partner's path. Locally, a partner running in
 * Docker cannot reach "localhost" on this machine, so it is given host.docker.internal instead.
 */
export function webhookUrlFor(p: { webhookPath: string }): string {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return local ? `http://host.docker.internal:${location.port || '80'}${p.webhookPath}` : `${location.origin}${p.webhookPath}`;
}
