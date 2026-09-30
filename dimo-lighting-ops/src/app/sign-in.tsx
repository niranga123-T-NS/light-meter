import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Button, Card, colors, ErrorBanner, Field, Muted, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { isConfigured } from '@/lib/supabase';

export default function SignIn() {
  const { signIn, resetPassword, error: authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#15171C', justifyContent: 'center', padding: 16 }}>
      <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center' }}>
        <Text style={{ color: colors.brand, fontSize: 40, fontWeight: '800', letterSpacing: 2, textAlign: 'center' }}>DIMO</Text>
        <Text style={{ color: '#D1D5DB', textAlign: 'center', marginBottom: 24 }}>Lighting Solutions · Operations System</Text>
        <Card>
          {!isConfigured ? (
            <Notice tone={colors.red}>
              Supabase is not configured. Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.
            </Notice>
          ) : null}
          <ErrorBanner message={error ?? authError} />
          {info ? <Notice>{info}</Notice> : null}
          <Field label="Work email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Field label="Password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} onSubmitEditing={() => signIn(email, password).catch((e) => setError(e.message))} />
          <Button
            title="Sign in"
            disabled={!email || !password}
            onPress={async () => {
              setError(null);
              try {
                await signIn(email, password);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
          <View style={{ height: 8 }} />
          <Button
            title="Forgot password"
            variant="ghost"
            small
            disabled={!email}
            onPress={async () => {
              try {
                await resetPassword(email);
                setInfo('A password reset link has been sent to your email.');
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
          <Muted style={{ textAlign: 'center', marginTop: 8 }}>Accounts are created by the System Administrator.</Muted>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}
