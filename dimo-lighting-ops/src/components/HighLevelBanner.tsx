import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, colors, Row } from '@/components/ui';
import { useAuth } from '@/lib/auth';

const hhmm = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** High level access (view only): offer to switch, and show clearly while viewing as a high level user */
export function HighLevelBanner() {
  const { highLevel, highLevelOn, setHighLevelOn, realRole } = useAuth();
  if (!highLevel) return null;
  const guest = realRole === 'guest';
  const toggle = (on: boolean) => {
    setHighLevelOn(on);
    router.replace('/');
  };
  return (
    <View style={{ backgroundColor: highLevelOn ? colors.ink : '#EEF2FF', paddingHorizontal: 16, paddingVertical: 8 }}>
      <Row wrap gap={10} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: highLevelOn ? '#fff' : colors.ink, fontWeight: '600', flexShrink: 1 }}>
          {highLevelOn
            ? `Viewing as a high level user – DGM view, view only · until ${hhmm(highLevel.ends_at)}`
            : `You have high level access (view only) until ${hhmm(highLevel.ends_at)}`}
        </Text>
        {guest ? null : <Button small variant={highLevelOn ? 'secondary' : 'primary'} title={highLevelOn ? 'Back to my own view' : 'View as high level user'} onPress={() => toggle(!highLevelOn)} />}
      </Row>
    </View>
  );
}
