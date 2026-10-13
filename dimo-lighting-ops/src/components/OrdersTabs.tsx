import { router } from 'expo-router';
import { Segmented } from '@/components/ui';

/** The sub-tabs of Foreign & local orders */
export function OrdersTabs({ value }: { value: 'foreign' | 'local' }) {
  return (
    <Segmented
      value={value}
      onChange={(v) => router.replace(v === 'foreign' ? '/orders/foreign' : '/orders/local')}
      options={[
        { value: 'foreign', label: 'Foreign orders ✈' },
        { value: 'local', label: 'Local orders' },
      ]}
    />
  );
}
