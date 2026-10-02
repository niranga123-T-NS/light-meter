import type { ClaimStage, WarrantyStage } from '@/lib/warranty';
import { colors } from './ui';

export const W_TONE: Record<WarrantyStage, string> = {
  active: colors.green,
  expiring: colors.amber,
  partly_expired: colors.blue,
  expired: colors.grey,
  cancelled: colors.grey,
};
export const C_TONE: Record<ClaimStage, string> = {
  verify: colors.amber,
  assign: colors.amber,
  inspect: colors.amber,
  decide: colors.blue,
  goodwill: colors.amber,
  quote: colors.blue,
  rectify: colors.blue,
  close: colors.green,
  closed: colors.grey,
  rejected: colors.grey,
  cancelled: colors.grey,
};
