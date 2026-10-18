// The shapes the portal's state is made of.

import type { StaffUser } from './session.js';

export type JobStatus = 'new' | 'accepted' | 'completed' | 'cancelled' | 'declined';

/** A badge's colours: the job statuses, plus amber for anything pending. */
export type BadgeColour = JobStatus | 'pending';

/** Declined jobs sit in the Cancelled tab, so there is no Declined tab. */
export type Tab = Exclude<JobStatus, 'declined'>;

export type ApplicationStatus = 'none' | 'pending' | 'approved' | 'rejected';

/** How the last call to CareLink with the server's credentials went. */
export type ConnectionState = 'unknown' | 'connected' | 'token_error' | 'unreachable' | 'suspended';

/** All partners' jobs, or one partner's, by its ID. */
export type SourceFilter = 'all' | string;

export type Screen =
  | 'login'
  | 'overview'
  | 'customers'
  | 'customer'
  | 'schedule'
  | 'staff'
  | 'services'
  | 'billing'
  | 'partners'
  | 'partnerNew'
  | 'apply'
  | 'status'
  | 'connection'
  | 'jobs'
  | 'webhooks';

/** The server call in flight. */
export type Busy =
  | 'signin'
  | 'submit'
  | 'check'
  | 'portal'
  | 'reissue'
  | 'addPartner'
  | 'removePartner'
  | 'test'
  | 'ping'
  | 'webhookUrl'
  | 'accept'
  | 'decline'
  | 'complete';

export interface TimelineStep {
  label: string;
  at: number;
  status: JobStatus;
  sub?: string;
}

/** What a job has under CareLink's Open Platform protocol, as the partner's job API gives it. */
export interface CareLinkJob {
  version: number;
  /** Until when a new job can be accepted or declined; null once it is not new. */
  respondBy: number | null;
  areaName: string;
  cancelReason: string | null;
  /** The rest comes from reading the job on its own, not from the list. */
  detailed: boolean;
  elderSummary?: string;
  languages?: string;
  bookedBy?: string;
  accessNotes?: string | null;
  declineNote?: string | null;
  actualStart?: number;
}

export interface Job {
  id: string;
  /** The partner that sent it, by ID, and its name as shown. */
  partnerId: string;
  source: string;
  service: string;
  start: number;
  /** Minutes. */
  dur: number;
  district: string;
  received: number;
  status: JobStatus;
  /** Arrived by webhook and not opened yet. */
  fresh: boolean;
  /** The elder as the partner describes them, never by name. */
  elder: string;
  /** Empty until the job is accepted. */
  address: string;
  instr: string;
  timeline: TimelineStep[];
  completedAt?: number;
  notes?: string;
  declineReason?: string;
  cancelledAt?: number;
  cancelReason?: string;
  cancelledAfterAccept?: boolean;
  carelink?: CareLinkJob;
}

/** A webhook as the server logged it (`GET /api/partners/<id>/webhooks`). */
export interface WebhookDelivery {
  /** Set on deliveries that arrive live, from every partner. */
  partnerId?: string;
  id: string | null;
  event: string;
  jobId: string | null;
  version: number | null;
  receivedAt: string;
  outcome: 'processed' | 'duplicate' | 'stale' | 'rejected';
  status: number;
  detail: string;
}

/** The application as CareLink last answered about it. */
export interface Application {
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

/** The server's credentials for CareLink. The secrets themselves never reach the browser. */
export interface Credentials {
  clientId: string;
  source: 'settings' | 'collected';
  webhookSecrets: number;
  collectedAt: string | null;
}

/** A partner as the server describes it (`GET /api/partners`). Secrets never; which settings are set, yes. */
export interface PartnerInfo {
  id: string;
  name: string;
  protocol: string;
  protocolName: string;
  /** The partner's protocol lets providers apply through its API. */
  canApply: boolean;
  baseUrl: string;
  addedAt: string;
  /** Where this partner's webhooks arrive on this server, e.g. /webhooks/carelink. */
  webhookPath: string;
  application: Application | null;
  credentials: Credentials | null;
  settings: { name: string; set: boolean }[];
  /** Who is signed in to the partner's own portal through this server, if anyone. */
  portal: { email: string } | null;
}

/** A partner, with what this page has learnt of it. */
export interface Partner extends PartnerInfo {
  app: ApplicationStatus;
  /** The partner showed the credentials once already, and not to this server: only new ones help. */
  credentialsLost: boolean;
  conn: ConnectionState;
  connMsg: string | null;
  lastTest: { at: number; ms: number } | null;
  checkErr: string | null;
  lastChecked: number | null;
  /** Why its jobs could not be loaded, if they could not. */
  jobsErr: string | null;
}

export interface Protocol {
  id: string;
  name: string;
  canApply: boolean;
}

export interface PartnerForm {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
}

export interface ApplicationForm {
  company: string;
  name: string;
  email: string;
  phone: string;
  webhookUrl: string;
  password: string;
  services: string[];
  terms: boolean;
}

export type TextField = 'company' | 'name' | 'email' | 'phone' | 'webhookUrl' | 'password';

export type FormErrors = Partial<Record<TextField | 'services' | 'terms', string>>;

export type CustomerStatus = 'regular' | 'one-off' | 'paused' | 'ended';

export type CustomerFilter = 'all' | CustomerStatus;

export type BillFilter = 'all' | 'customers' | 'partners';

export interface Toast {
  text: string;
  kind: 'success' | 'info';
}

export interface JobError {
  lead: string;
  text: string;
  /** The action the Try again button repeats, if trying again can help. */
  retry?: 'acceptJob' | 'confirmDecline' | 'completeJob';
}

export interface State {
  loggedIn: boolean;
  /** Who is signed in, as the server knows them. */
  user: StaffUser | null;
  signInUser: string;
  signInErr: string | null;
  screen: Screen;
  toast: Toast | null;
  busy: Busy | null;

  // Partners
  partners: Partner[];
  protocols: Protocol[];
  /** The partner whose page is open. */
  partnerId: string | null;
  partnerForm: PartnerForm;
  partnerErrs: Partial<Record<keyof PartnerForm, string>>;
  partnerErr: string | null;
  confirmRemove: boolean;

  // The open partner's page: joining it and the connection
  portalEmailInput: string;
  portalErr: string | null;
  form: ApplicationForm;
  errs: FormErrors;
  submitErr: string | null;
  webhookUrlInput: string;
  webhookMsg: { kind: 'success' | 'error'; text: string } | null;

  // Jobs and webhooks
  jobs: Job[];
  hooks: WebhookDelivery[];
  loading: boolean;
  tab: Tab;
  srcFilter: SourceFilter;
  sel: string | null;
  /** The job the decline and completion forms belong to. */
  draftFor: string | null;
  mode: 'decline' | null;
  declineReason: string;
  declineNote: string;
  declineErr: string | null;
  compStart: string;
  compEnd: string;
  compNotes: string;
  compErr: string | null;
  jobErr: JobError | null;

  // Day-to-day pages
  custFilter: CustomerFilter;
  custQuery: string;
  billFilter: BillFilter;
  week: number;
}
