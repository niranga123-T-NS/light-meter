import { router } from 'expo-router';

import { SyncBar } from '@/components/SyncBar';
import { Badge, Button, Card, KeyValue, ListItem, Muted, Screen, SectionTitle } from '@/components/ui';
import { useCache } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function More() {
  const { profile, isManager, isAdmin, signOut } = useSession();
  const territories = useCache('territories');
  const refreshedAt = useCache('refreshedAt');
  return (
    <Screen>
      <Card>
        <KeyValue label="Signed in as" value={profile?.full_name} />
        <KeyValue label="Email" value={profile?.email} />
        <KeyValue label="Role" value={<Badge label={profile?.role ?? ''} tone="primary" />} />
        <KeyValue label="Territories" value={territories.filter((t) => profile?.territory_ids?.includes(t.id)).map((t) => t.name).join(', ') || '–'} />
        <KeyValue label="Offline lists refreshed" value={fmtDateTime(refreshedAt)} />
        <SyncBar />
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListItem title="Sync status and offline visits" onPress={() => router.push('/sync')} />
        <ListItem title="Excel export" subtitle="Download or schedule the workbook" onPress={() => router.push('/export')} />
        <ListItem title="Plan a visit" onPress={() => router.push('/visit/plan')} />
        <ListItem title="Visit corrections" subtitle={isManager ? 'Approve or reject requested corrections' : 'Your correction requests'} onPress={() => router.push('/corrections')} />
      </Card>
      {isManager ? (
        <>
          <SectionTitle>Management</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <ListItem title="Pipeline stages" subtitle="Names, probabilities and required fields" onPress={() => router.push('/admin/stages')} />
            <ListItem title="Exchange rates" onPress={() => router.push('/admin/settings')} />
            <ListItem title="Audit log" onPress={() => router.push('/admin/audit')} />
          </Card>
        </>
      ) : null}
      {isAdmin ? (
        <>
          <SectionTitle>Administration</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <ListItem title="Users and roles" subtitle="Invite, assign territories, deactivate" onPress={() => router.push('/admin/users')} />
            <ListItem title="Dropdown lists" subtitle="Visit types, categories, segments, reasons…" onPress={() => router.push('/admin/lists')} />
            <ListItem title="Territories" onPress={() => router.push('/admin/territories')} />
            <ListItem title="Settings" subtitle="Currency, GPS policy, margin visibility, retention" onPress={() => router.push('/admin/settings')} />
            <ListItem title="Import customers" subtitle="Paste CSV from Excel" onPress={() => router.push('/admin/import')} />
          </Card>
        </>
      ) : null}
      <Button variant="danger" title="Sign out" onPress={async () => {
        try {
          await signOut();
        } catch (e) {
          notify('Cannot sign out yet', (e as Error).message);
        }
      }} />
      <Muted style={{ textAlign: 'center' }}>DIMO Sales · times shown in Asia/Colombo</Muted>
    </Screen>
  );
}
