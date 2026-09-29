import { useState } from 'react';
import { Image, View } from 'react-native';

import { TextField } from '@/components/form';
import { Banner, Button, Card, Muted, Screen, space } from '@/components/ui';
import { useSession } from '@/lib/session';

const microsoftEnabled = process.env.EXPO_PUBLIC_MICROSOFT_SSO === 'true';

export default function SignIn() {
  const { signIn, signInWithMicrosoft } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setError(await signIn(email, password));
    setBusy(false);
  };

  return (
    <Screen style={{ paddingTop: 80, maxWidth: 460 }}>
      <View style={{ alignItems: 'center', gap: space.sm, marginBottom: space.lg }}>
        <Image source={require('../../assets/logo.png')} accessibilityLabel="DIMO – The Perfect Partner"
          style={{ width: 260, height: 100 }} resizeMode="contain" />
        <Muted>Sales visits, projects and follow-ups</Muted>
      </View>
      <Card>
        {microsoftEnabled ? (
          <>
            <Button title="Sign in with Microsoft" variant="secondary" onPress={async () => setError(await signInWithMicrosoft())} />
            <Muted style={{ textAlign: 'center' }}>or with email</Muted>
          </>
        ) : null}
        <TextField label="Work email" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <TextField label="Password" value={password} onChange={setPassword} secure autoCapitalize="none" />
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
      </Card>
      <Muted style={{ textAlign: 'center' }}>Accounts are created by your administrator.</Muted>
    </Screen>
  );
}
