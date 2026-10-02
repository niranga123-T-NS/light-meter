import type { Role } from './types';

export type BrandRow = {
  id: number;
  name: string;
  manufacturer: string | null;
  country: string | null;
  origin: string;
  level: string;
  active: boolean;
  status: 'approved' | 'pending' | 'rejected';
  proposed_by: string | null;
  proposed_at: string;
  reviewed_by: string | null;
  review_note: string | null;
};

export const ORIGINS = [
  { value: 'european', label: 'European' },
  { value: 'chinese', label: 'Chinese' },
  { value: 'other', label: 'Other' },
];
export const LEVELS = [
  { value: 'high', label: 'High end' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low end' },
];

/** Approve, correct, reject and merge brands (the server enforces the same rule). */
export const isBrandManager = (r?: Role | null) => r === 'design_manager' || r === 'sm_estimation' || r === 'gm' || r === 'sys_admin';
/** Add brands while working – new ones are recorded as pending until a manager approves them. */
export const canAddBrand = (r?: Role | null) =>
  isBrandManager(r) ||
  r === 'lighting_designer' ||
  r === 'lighting_engineer' ||
  r === 'am_estimation' ||
  r === 'estimation_exec' ||
  r === 'asm_building' ||
  r === 'asm_infra' ||
  r === 'sm_projects';

export const brandFields = (b?: Partial<BrandRow>) => [
  { key: 'name', label: 'Brand', required: true, initial: b?.name ?? '' },
  { key: 'manufacturer', label: 'Manufacturer', initial: b?.manufacturer ?? '' },
  { key: 'country', label: 'Country of origin', initial: b?.country ?? '' },
  { key: 'origin', label: 'Origin group', type: 'select' as const, required: true, initial: b?.origin ?? '', options: ORIGINS },
  { key: 'level', label: 'Level', type: 'select' as const, required: true, initial: b?.level ?? '', options: LEVELS },
];
