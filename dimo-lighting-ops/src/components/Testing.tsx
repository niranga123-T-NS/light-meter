import { Text, View } from 'react-native';
import { colors } from './ui';

/**
 * New features were marked "Testing" until the business confirmed them. All features are now confirmed: no marker is
 * shown anywhere (including the ones forced with "always"). Set TESTING_FEATURES to true to show markers again.
 */
export const TESTING_FEATURES = false;

/** Small tag beside a menu item or title */
export function TestingTag({ dark }: { dark?: boolean; always?: boolean }) {
  if (!TESTING_FEATURES) return null;
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: dark ? '#7C2D12' : '#FFF7ED', borderWidth: 1, borderColor: '#F59E0B' }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: dark ? '#FDE68A' : '#B45309', letterSpacing: 0.3 }}>TESTING</Text>
    </View>
  );
}

/** Banner at the top of a new screen */
export function TestingBanner({ what = 'This feature', always }: { what?: string; always?: boolean }) {
  if (!TESTING_FEATURES) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FCD34D' }}>
      <TestingTag always={always} />
      <Text style={{ flex: 1, color: colors.ink, fontSize: 13 }}>{`${what} is new and in testing – report anything that looks wrong to the System Administrator.`}</Text>
    </View>
  );
}
