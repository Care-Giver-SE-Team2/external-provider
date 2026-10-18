// BrightHands' own records, from the design handoff: its customers, staff, schedule and billing. Every name, address
// and ID here is made up. Nothing about partners is here: partners are data on the server, and their jobs come
// from them.

import { T } from './format.js';
import type { ApplicationForm, BadgeColour, CustomerFilter, CustomerStatus } from './types.js';

/** The application form, as it opens. The webhook URL is filled in from where the portal runs. */
export const APPLY_DEFAULTS: Readonly<ApplicationForm> = {
  company: 'BrightHands Home Services Pte. Ltd.',
  name: '',
  email: '',
  phone: '',
  webhookUrl: '',
  password: '',
  services: ['Light housekeeping'],
  terms: false,
};

/** The housekeeper (schedule row) who takes each kind of job from a partner or the website. */
export const JOB_STAFF_ROW: Record<string, string> = {
  'Home cleaning': 'huimin',
  'Light housekeeping': 'ana',
  'Turnover clean': 'mary',
  'Deep cleaning': 'crew',
  'Move-in clean': 'crew',
};

// ---------- BrightHands' own business (static) ----------

export interface Visit {
  start: number;
  dur: number;
  service: string;
  client: string;
  staff: string;
  area: string;
}

export const TODAY_VISITS: readonly Visit[] = [
  { start: T(12, 9, 0), dur: 180, service: 'Light housekeeping', client: 'Ms Aisha Rahman', staff: 'Ana Santos', area: 'Pasir Ris' },
  { start: T(12, 9, 0), dur: 240, service: 'Move-out clean', client: 'Kovalenko family', staff: 'Kumar Velu, Jason Koh', area: 'Holland Village' },
  { start: T(12, 9, 30), dur: 180, service: 'Light housekeeping', client: 'Mr & Mrs Gupta', staff: 'Mary Joy Reyes', area: 'Bukit Timah' },
  { start: T(12, 13, 0), dur: 240, service: 'Light housekeeping', client: 'Mr & Mrs Chen', staff: 'Wati Suryani', area: 'Bedok Reservoir' },
  { start: T(12, 14, 0), dur: 240, service: 'Light housekeeping', client: 'Tan household', staff: 'Ana Santos', area: 'Siglap' },
  { start: T(12, 14, 0), dur: 120, service: 'Laundry & ironing', client: 'Ms Priscilla Yeo', staff: 'Mary Joy Reyes', area: 'Bishan' },
];

export const CUSTOMER_FILTERS: readonly { key: CustomerFilter; label: string; count: number }[] = [
  { key: 'all', label: 'All', count: 63 },
  { key: 'regular', label: 'Regular', count: 48 },
  { key: 'one-off', label: 'One-off', count: 9 },
  { key: 'paused', label: 'Paused', count: 4 },
  { key: 'ended', label: 'Ended', count: 2 },
];

export interface Customer {
  name: string;
  since: string;
  plan: string;
  home: string;
  next: string;
  nextMuted?: boolean;
  status: CustomerStatus;
  /** Only the Lim family has a detail page. */
  detail?: boolean;
}

export const CUSTOMERS: readonly Customer[] = [
  { name: 'Lim family', since: 'since Mar 2024', plan: 'Weekly, 4 h incl. ironing', home: 'Tampines · HDB', next: 'Tue 13 Oct, 09:00', status: 'regular', detail: true },
  { name: 'Tan household', since: 'since Jan 2023', plan: 'Twice a week, 4 h', home: 'Siglap · landed', next: 'Today, 14:00', status: 'regular' },
  { name: 'Mr & Mrs Chen', since: 'since Jul 2025', plan: 'Twice a week, 3–4 h', home: 'Bedok Reservoir · condo', next: 'Today, 13:00', status: 'regular' },
  { name: 'Ms Aisha Rahman', since: 'since Feb 2026', plan: 'Weekly, 3 h', home: 'Pasir Ris · HDB', next: 'Today, 09:00', status: 'regular' },
  { name: 'Mr & Mrs Gupta', since: 'since Oct 2024', plan: 'Three times a week, 3–4 h', home: 'Bukit Timah · condo', next: 'Today, 09:30', status: 'regular' },
  { name: 'Mr David Ng', since: 'since May 2025', plan: 'Weekly, 3 h', home: 'Marine Parade · condo', next: 'Tue 13 Oct, 10:00', status: 'regular' },
  { name: 'Kovalenko family', since: 'booked Sep 2026', plan: 'Move-out clean, 2-person crew', home: 'Holland Village · condo', next: 'Today, 09:00', status: 'one-off' },
  { name: 'Ms Joanne Teo', since: 'booked Oct 2026', plan: 'Post-renovation clean', home: 'Toa Payoh · HDB', next: 'Wed 14 Oct, 10:00', status: 'one-off' },
  { name: 'Ms Sharon Lee', since: 'since Aug 2023', plan: 'Weekly, 3 h', home: 'Clementi · HDB', next: 'Overseas until 2 Nov', nextMuted: true, status: 'paused' },
  { name: 'Mr Hafiz Osman', since: 'Jan–Sep 2026', plan: 'Fortnightly, 3 h', home: 'Jurong West · HDB', next: '—', nextMuted: true, status: 'ended' },
];

/** Customer status → [badge colour, label]. */
export const CUSTOMER_STATUS: Record<CustomerStatus, [BadgeColour, string]> = {
  regular: ['completed', 'Regular'],
  'one-off': ['accepted', 'One-off'],
  paused: ['pending', 'Paused'],
  ended: ['declined', 'Ended'],
};

export interface StaffMember {
  name: string;
  role: string;
  does: string;
  training: string;
  trainingExpiring?: boolean;
  week: string;
  today: 'on' | 'leave' | 'off';
  note?: string;
}

export const STAFF: readonly StaffMember[] = [
  { name: 'Alan Tan', role: 'Operations manager', does: 'Bookings, rosters, CareLink jobs', training: '—', week: '—', today: 'on' },
  { name: 'Grace Lim', role: 'Team lead · East', does: 'Quality checks, new-customer visits', training: 'WSQ housekeeping · Lvl 2', week: '18 h', today: 'on' },
  { name: 'Ana Santos', role: 'Housekeeper · East', does: 'Housekeeping, ironing', training: 'WSQ housekeeping', week: '34 h', today: 'on' },
  { name: 'Wati Suryani', role: 'Housekeeper · East', does: 'Housekeeping', training: 'WSQ housekeeping', week: '31 h', today: 'on' },
  { name: 'Mary Joy Reyes', role: 'Housekeeper · Central', does: 'Housekeeping, ironing', training: 'WSQ housekeeping', week: '29 h', today: 'on' },
  { name: 'Lakshmi Devi', role: 'Housekeeper · West', does: 'Housekeeping', training: 'WSQ housekeeping', week: '0 h', today: 'leave', note: 'Back Mon 19 Oct' },
  { name: 'Hui Min Ong', role: 'Housekeeper · West', does: 'Housekeeping, CareLink jobs', training: 'Elder-care awareness course', week: '22 h', today: 'on' },
  { name: 'Kumar Velu', role: 'Deep-clean crew lead', does: 'Deep, move-out, post-renovation', training: 'Work-at-height · expires 14 Nov', trainingExpiring: true, week: '36 h', today: 'on' },
  { name: 'Jason Koh', role: 'Deep-clean crew, driver', does: 'Deep cleaning, van driver', training: 'Class 3 licence', week: '28 h', today: 'on', note: 'With Kumar today' },
];

export interface Service {
  name: string;
  desc: string;
  min: string;
  price: string;
  /** How it is offered on CareLink, if it is. */
  carelink?: { as: string; terms: string };
}

export const SERVICES: readonly Service[] = [
  { name: 'Light housekeeping', desc: 'Sweep, mop, dust, bathrooms, kitchen, bed sheets', min: '3 h', price: 'S$28 / h', carelink: { as: 'Light housekeeping', terms: 'At CareLink’s rate in the provider terms' } },
  { name: 'Laundry & ironing', desc: 'Wash, fold, iron. Add-on or on its own', min: '1 h', price: 'S$28 / h' },
  { name: 'Deep cleaning', desc: 'Two-person crew, behind appliances, grout, cabinets', min: '4 h', price: 'S$48 / h' },
  { name: 'Move-in / move-out clean', desc: 'Empty home, top to bottom, for handover', min: 'Per home', price: 'from S$380' },
  { name: 'Post-renovation clean', desc: 'Dust, paint marks, cement residue', min: 'Per home', price: 'from S$520' },
  { name: 'Window & grille cleaning', desc: 'Inside and reachable outside panes', min: 'Per home', price: 'from S$120' },
  { name: 'Sofa & mattress steam clean', desc: 'Steam and vacuum, dries in 4 hours', min: 'Per item', price: 'from S$90' },
];

export type InvoiceStatus = 'draft' | 'sent' | 'overdue' | 'paid';

export interface Invoice {
  no: string;
  to: string;
  what: string;
  period: string;
  amount: number;
  status: InvoiceStatus;
  note?: string;
  carelink?: boolean;
}

export const INVOICES: readonly Invoice[] = [
  { no: 'INV-2026-2208', to: 'Tan household', what: '8 visits, 4 h each', period: 'Oct 2026', amount: 896, status: 'draft' },
  { no: 'INV-2026-2207', to: 'Lim family', what: '4 visits, GIRO', period: 'Oct 2026', amount: 448, status: 'sent', note: 'GIRO on Thu 15 Oct' },
  { no: 'INV-2026-2195', to: 'Mr David Ng', what: 'Extra visits, 8 h', period: 'Sep 2026', amount: 224, status: 'overdue', note: 'Due Wed 30 Sep' },
  { no: 'INV-2026-2190', to: 'Kovalenko family', what: 'Move-out clean, deposit 50%', period: 'Oct 2026', amount: 190, status: 'paid', note: 'Mon 5 Oct' },
  { no: 'INV-2026-2188', to: 'Mr & Mrs Gupta', what: '13 visits', period: 'Sep 2026', amount: 896, status: 'paid', note: 'Fri 2 Oct' },
  { no: 'INV-2026-2186', to: 'Ms Aisha Rahman', what: '5 visits + ironing', period: 'Sep 2026', amount: 560, status: 'paid', note: 'Thu 1 Oct' },
];

/** Invoice status → [badge colour, label]. */
export const INVOICE_STATUS: Record<InvoiceStatus, [BadgeColour, string]> = {
  draft: ['declined', 'Draft'],
  sent: ['accepted', 'Sent'],
  overdue: ['cancelled', 'Overdue'],
  paid: ['completed', 'Paid'],
};

// ---------- Schedule ----------

export interface ScheduleRow {
  key: string;
  name: string;
  sub: string;
}

export const SCHEDULE_ROWS: readonly ScheduleRow[] = [
  { key: 'ana', name: 'Ana Santos', sub: 'East' },
  { key: 'wati', name: 'Wati Suryani', sub: 'East' },
  { key: 'mary', name: 'Mary Joy Reyes', sub: 'Central' },
  { key: 'lakshmi', name: 'Lakshmi Devi', sub: 'West' },
  { key: 'huimin', name: 'Hui Min Ong', sub: 'West' },
  { key: 'crew', name: 'Deep-clean crew', sub: 'Kumar, Jason' },
];

/** The two weeks the schedule can show, by the day of October each starts on. */
export const SCHEDULE_WEEKS: readonly number[] = [12, 19];

export const LEAVE: readonly { row: string; from: number; to: number; label: string }[] = [{ row: 'lakshmi', from: 12, to: 16, label: 'On leave until Fri 16 Oct' }];

export interface ScheduleVisit {
  /** Day of October. */
  d: number;
  row: string;
  time: string;
  what: string;
  who: string;
  /** Set when the visit is a job from the Jobs page. */
  jobId?: string;
  carelink?: boolean;
}

const v = (d: number, row: string, time: string, what: string, who: string): ScheduleVisit => ({ d, row, time, what, who });

export const SCHEDULE_VISITS: readonly ScheduleVisit[] = [
  v(12, 'ana', '09:00', '3 h', 'Ms Aisha Rahman'),
  v(12, 'ana', '14:00', '4 h', 'Tan household'),
  v(13, 'ana', '09:00', '4 h', 'Lim family'),
  v(15, 'ana', '09:00', '4 h', 'Tan household'),
  v(12, 'wati', '13:00', '4 h', 'Mr & Mrs Chen'),
  v(13, 'wati', '10:00', '3 h', 'Mr David Ng'),
  v(14, 'wati', '09:00', '3 h', 'Mr & Mrs Chen'),
  v(15, 'wati', '09:00', '3 h', 'Ms Sabrina Low'),
  v(12, 'mary', '09:30', '3 h', 'Mr & Mrs Gupta'),
  v(12, 'mary', '14:00', 'Ironing', 'Ms Priscilla Yeo'),
  v(14, 'mary', '10:00', '3 h', 'Dr Wendy Foo'),
  v(15, 'mary', '13:00', '3 h', 'Mr & Mrs Gupta'),
  v(17, 'mary', '09:00', '4 h', 'Mr & Mrs Gupta'),
  v(13, 'huimin', '14:00', '3 h', 'Ms Farah Iskandar'),
  v(16, 'huimin', '09:00', '3 h', 'Mrs Nadia Karim'),
  v(12, 'crew', '09:00', 'Move-out', 'Kovalenko family'),
  v(14, 'crew', '10:00', 'Post-reno', 'Ms Joanne Teo'),
  v(16, 'crew', '09:00', 'Deep clean', 'Mr Benjamin Sim'),
  v(17, 'crew', '09:00', 'Windows', 'Mr & Mrs Chen'),
  // Next week: the regulars again, with Lakshmi back and taking her own customers.
  v(19, 'ana', '09:00', '3 h', 'Ms Aisha Rahman'),
  v(19, 'ana', '14:00', '4 h', 'Tan household'),
  v(20, 'ana', '09:00', '4 h', 'Lim family'),
  v(22, 'ana', '09:00', '4 h', 'Tan household'),
  v(19, 'wati', '13:00', '4 h', 'Mr & Mrs Chen'),
  v(20, 'wati', '10:00', '3 h', 'Mr David Ng'),
  v(21, 'wati', '09:00', '3 h', 'Mr & Mrs Chen'),
  v(19, 'mary', '09:30', '3 h', 'Mr & Mrs Gupta'),
  v(19, 'mary', '14:00', 'Ironing', 'Ms Priscilla Yeo'),
  v(21, 'mary', '10:00', '3 h', 'Dr Wendy Foo'),
  v(22, 'mary', '13:00', '3 h', 'Mr & Mrs Gupta'),
  v(24, 'mary', '09:00', '4 h', 'Mr & Mrs Gupta'),
  v(20, 'lakshmi', '14:00', '3 h', 'Ms Farah Iskandar'),
  v(22, 'lakshmi', '09:00', '3 h', 'Ms Sabrina Low'),
  v(23, 'lakshmi', '09:00', '3 h', 'Mrs Nadia Karim'),
  v(21, 'crew', '09:00', 'Deep clean', 'Mr Peter Wong'),
  v(23, 'crew', '10:00', 'Post-reno', 'Ms Carol Seah'),
];
