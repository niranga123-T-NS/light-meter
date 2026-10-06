import { useLocalSearchParams } from 'expo-router';
import { AccessForm } from '@/components/exec/AccessForm';

/** Subcontractor supervisor nomination for one project (SM Projects approves) */
export default function NominateSupervisor() {
  const { project } = useLocalSearchParams<{ project: string }>();
  return <AccessForm nominate={project} />;
}
