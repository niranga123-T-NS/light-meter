import { Banner, Button, Card, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Pending() {
  const { session, reloadProfile, signOut } = useSession();
  return (
    <Screen style={{ paddingTop: 80, maxWidth: 460 }}>
      <Title>Waiting for access</Title>
      <Card>
        <Muted>Signed in as {session?.user.email}.</Muted>
        <Banner tone="warning" message="Your account is not active yet, or has been deactivated. Ask your administrator to activate it and assign your role and territory." />
        <Button title="Check again" onPress={reloadProfile} />
        <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}
