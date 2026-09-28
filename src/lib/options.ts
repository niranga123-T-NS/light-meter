// Option lists for pickers, built from the offline cache.
import type { Option } from '@/components/form';

import { cacheStore } from './cache';

export function customerOptions(): Option[] {
  return cacheStore.get().customers.map((c) => ({
    value: c.id,
    label: c.trading_name ? `${c.trading_name} (${c.legal_name})` : c.legal_name,
    subtitle: [c.code, c.city, c.status === 'provisional' ? 'provisional' : null].filter(Boolean).join(' · '),
  }));
}

export function contactOptions(customerId?: string | null): Option[] {
  return cacheStore.get().contacts
    .filter((c) => !customerId || c.customer_id === customerId)
    .map((c) => ({ value: c.id, label: c.full_name, subtitle: [c.designation, c.code].filter(Boolean).join(' · ') }));
}

export function projectOptions(customerId?: string | null): Option[] {
  const list = cacheStore.get().projects;
  const sorted = customerId
    ? [...list].sort((a, b) => Number(b.customer_id === customerId || b.developer_id === customerId || b.end_user_id === customerId)
      - Number(a.customer_id === customerId || a.developer_id === customerId || a.end_user_id === customerId))
    : list;
  return sorted.map((p) => ({ value: p.id, label: p.name, subtitle: [p.code, p.district, p.status].filter(Boolean).join(' · ') }));
}

export function opportunityOptions(projectIds?: string[]): Option[] {
  const { opportunities, projects, stages } = cacheStore.get();
  return opportunities
    .filter((o) => !projectIds || projectIds.includes(o.project_id))
    .map((o) => ({
      value: o.id,
      label: o.name,
      subtitle: [projects.find((p) => p.id === o.project_id)?.name, stages.find((s) => s.id === o.stage_id)?.name, o.code].filter(Boolean).join(' · '),
    }));
}

export function userOptions(roles?: string[]): Option[] {
  return cacheStore.get().profiles
    .filter((p) => p.active && (!roles || roles.includes(p.role)))
    .map((p) => ({ value: p.id, label: p.full_name || p.email || p.id, subtitle: p.role }));
}

export function stageOptions(openOnly = false): Option[] {
  return cacheStore.get().stages
    .filter((s) => s.active && (!openOnly || s.outcome === 'open'))
    .map((s) => ({ value: s.id, label: s.name, subtitle: `${s.default_probability}%` }));
}

export function territoryOptions(): Option[] {
  return cacheStore.get().territories.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }));
}

export const PRIORITY_OPTIONS: Option[] = [
  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
];
export const CONFIDENCE_OPTIONS: Option[] = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
];
export const ACTION_STATUS_OPTIONS: Option[] = [
  { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' },
];
export const CONTACT_METHOD_OPTIONS: Option[] = [
  { value: 'phone', label: 'Phone' }, { value: 'mobile', label: 'Mobile' }, { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' }, { value: 'in_person', label: 'In person' }, { value: 'other', label: 'Other' },
];
export const CUSTOMER_STATUS_OPTIONS: Option[] = [
  { value: 'provisional', label: 'Provisional' }, { value: 'prospect', label: 'Prospect' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' },
];
export const PROJECT_STATUS_OPTIONS: Option[] = [
  { value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' },
  { value: 'cancelled', label: 'Cancelled' }, { value: 'closed', label: 'Closed' },
];
export const QUOTATION_STATUS_OPTIONS: Option[] = [
  { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' }, { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' }, { value: 'superseded', label: 'Superseded' }, { value: 'expired', label: 'Expired' }, { value: 'withdrawn', label: 'Withdrawn' },
];
export const MILESTONE_STATUS_OPTIONS: Option[] = [
  { value: 'pending', label: 'Pending' }, { value: 'in_progress', label: 'In progress' }, { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' }, { value: 'resubmit', label: 'Resubmit' }, { value: 'rejected', label: 'Rejected' },
  { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' },
];
export const CONSENT_OPTIONS: Option[] = [
  { value: 'unknown', label: 'Unknown' }, { value: 'granted', label: 'Granted' }, { value: 'withdrawn', label: 'Withdrawn' },
];
