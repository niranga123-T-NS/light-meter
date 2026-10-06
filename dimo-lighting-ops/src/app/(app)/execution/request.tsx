import { useLocalSearchParams } from 'expo-router';
import { AccessForm } from '@/components/exec/AccessForm';

/** Temporary Assistant Engineer / Trainee request */
export default function RequestTempStaff() {
  const { nominate } = useLocalSearchParams<{ nominate?: string }>();
  return <AccessForm nominate={nominate} />;
}
