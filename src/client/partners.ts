// The partner list, through the portal's server (`/api/partners`, `/api/protocols`).

import { serverFetch } from './session.js';
import type { PartnerForm, PartnerInfo, Protocol } from './types.js';

export const listPartners = () => serverFetch<{ partners: PartnerInfo[] }>('/api/partners');
export const getPartner = (id: string) => serverFetch<PartnerInfo>(`/api/partners/${encodeURIComponent(id)}`);
export const listProtocols = () => serverFetch<{ protocols: Protocol[] }>('/api/protocols');

export const addPartner = (p: PartnerForm) => serverFetch<PartnerInfo>('/api/partners', { method: 'POST', body: JSON.stringify(p) });
export const removePartner = (id: string) => serverFetch<void>(`/api/partners/${encodeURIComponent(id)}`, { method: 'DELETE' });
