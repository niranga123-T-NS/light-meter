import { Stack, useLocalSearchParams } from 'expo-router';
import { SubPlanView } from '@/components/exec/SubPlanView';
import { Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';

/** Subcontractor weekly / daily plan (the supervisor's "My plan", or a plan the AE opens to approve). */
export default function SubPlanScreen() {
  const params = useLocalSearchParams<{ plan?: string; project?: string; week?: string }>();
  const me = useMe();
  return (
    <Screen maxWidth={980}>
      <Stack.Screen options={{ title: me.role === 'sub_supervisor' ? 'My plan' : 'Subcontractor plan' }} />
      <SubPlanView plan={params.plan} project={params.project} week={params.week} />
    </Screen>
  );
}
