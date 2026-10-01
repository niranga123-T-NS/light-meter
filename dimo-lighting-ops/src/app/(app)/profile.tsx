import { Stack } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Avatar, Button, Card, H2, KeyValue, Muted, Row, Screen, Section, Toggle } from '@/components/ui';
import { WebPushCard } from '@/components/WebPushCard';
import { useAuth, useMe } from '@/lib/auth';
import { pickImage, uploadAvatar } from '@/lib/files';
import { clearPeopleCache, usePeople } from '@/lib/hooks';
import { useOfflineSync } from '@/lib/offline';
import { ROLE_LABELS } from '@/lib/roles';
import { supabase } from '@/lib/supabase';

/** Profile page (Section 2): users edit only their picture and notification preferences. */
export default function Profile() {
  const me = useMe();
  const { reloadProfile, signOut } = useAuth();
  const people = usePeople();
  const dialog = useDialog();
  const offline = useOfflineSync();

  const changePicture = async (camera: boolean) => {
    const f = await pickImage(camera, true);
    if (!f) return;
    await dialog.run(async () => {
      await uploadAvatar(me.id, f);
      clearPeopleCache();
      await reloadProfile();
    }, 'Picture updated');
  };

  return (
    <Screen maxWidth={720}>
      <Stack.Screen options={{ title: 'Profile' }} />
      <Card>
        <Row gap={16}>
          <Avatar name={me.full_name} path={me.avatar_path} size={88} />
          <View style={{ flex: 1 }}>
            <H2>{me.full_name}</H2>
            <Muted>{ROLE_LABELS[me.role]}</Muted>
            <Muted>{me.email}</Muted>
          </View>
        </Row>
        <Row wrap gap={8} style={{ marginTop: 12 }}>
          <Button small title={Platform.OS === 'web' ? 'Upload picture' : 'Choose from gallery'} onPress={() => changePicture(false)} />
          {Platform.OS !== 'web' ? <Button small variant="secondary" title="Take photo" onPress={() => changePicture(true)} /> : null}
          {me.avatar_path ? (
            <Button
              small
              variant="ghost"
              title="Remove picture"
              onPress={() =>
                dialog.run(async () => {
                  await supabase.from('profiles').update({ avatar_path: null }).eq('id', me.id);
                  clearPeopleCache();
                  await reloadProfile();
                })
              }
            />
          ) : null}
        </Row>
        <Muted style={{ marginTop: 6 }}>JPG or PNG up to 5 MB, cropped square. Shown to logged-in staff only.</Muted>
      </Card>

      <Section title="Details (maintained by the System Administrator)">
        <Card>
          <Row wrap>
            <KeyValue label="Team" value={me.team} />
            <KeyValue label="Reports to" value={people[me.manager_id ?? '']?.full_name ?? '—'} />
            <KeyValue label="Project types" value={me.project_types.join(', ') || '—'} />
            <KeyValue label="Phone" value={me.phone ?? '—'} />
          </Row>
        </Card>
      </Section>

      <Section title="Password">
        <Card>
          <Button
            small
            variant="secondary"
            title="Change password"
            onPress={async () => {
              const r = await dialog.prompt({
                title: 'Change password',
                fields: [
                  { key: 'p1', label: 'New password (min. 8 characters)', type: 'password', required: true },
                  { key: 'p2', label: 'Repeat new password', type: 'password', required: true },
                ],
              });
              if (!r) return;
              await dialog.run(async () => {
                if (r.p1.length < 8) throw new Error('Use at least 8 characters');
                if (r.p1 !== r.p2) throw new Error('The two passwords do not match');
                const { error } = await supabase.auth.updateUser({ password: r.p1 });
                if (error) throw new Error(error.message);
              }, 'Password changed');
            }}
          />
        </Card>
      </Section>

      {Platform.OS === 'web' ? (
        <Section title="Notifications on this device">
          <WebPushCard />
        </Section>
      ) : null}

      <Section title="Notification preferences">
        <Card>
          <Toggle
            label="Daily digest at 08:30 instead of individual non-critical notices"
            value={me.digest_mode}
            onChange={(v) =>
              dialog.run(async () => {
                const { error } = await supabase.from('profiles').update({ digest_mode: v }).eq('id', me.id);
                if (error) throw new Error(error.message);
                await reloadProfile();
              }, 'Saved')
            }
          />
          <Muted>Critical items (customer deadline at risk, Level 3 escalations, legal hearings) are always sent immediately. Non-critical notices are held during quiet hours (20:00–07:00, Sundays and public holidays).</Muted>
        </Card>
      </Section>

      {Platform.OS !== 'web' ? (
        <Section title="Offline visits">
          <Card>
            <Text>{offline.pending} visit(s) waiting to sync</Text>
            <Button small variant="secondary" title="Sync now" onPress={() => dialog.run(offline.sync, 'Sync finished')} />
          </Card>
        </Section>
      ) : null}

      <Row style={{ marginTop: 24 }}>
        <Button variant="danger" title="Sign out" onPress={signOut} />
      </Row>
    </Screen>
  );
}
