import type { SecuredProject } from '@/lib/finance';
import { colors } from './ui';

export const SCHEDULE_LABEL: Record<SecuredProject['schedule_status'], string> = {
  missing: 'Schedule missing',
  review: 'Schedule to review',
  approved: 'Schedule approved',
};
export const SCHEDULE_TONE: Record<SecuredProject['schedule_status'], string> = { missing: colors.red, review: colors.amber, approved: colors.green };

/** Green from 90 %, amber from 60 %, red below */
export const pctTone = (p: number) => (p >= 90 ? colors.green : p >= 60 ? colors.amber : colors.red);
