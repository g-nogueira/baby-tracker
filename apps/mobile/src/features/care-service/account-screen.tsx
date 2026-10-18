import { Text } from '@/features/shared/tracking-text';
import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIcon } from '@/features/shared/icons/activity-icon';
import type { useCareTracker } from './use-care-tracker';

/** Sign-in UI consumes the session port, independently of a provider's authentication transport. */
export function AccountScreen({ model }: { model: ReturnType<typeof useCareTracker> }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  if (model.stage === 'loading')
    return (
      <View style={styles.content}>
        <ActivityIndicator />
        <Text>Opening shared records…</Text>
      </View>
    );
  if (model.stage === 'profiles')
    return (
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          Choose a profile
        </Text>
        {model.babies.map((baby) => (
          <Pressable
            key={baby.id}
            accessibilityRole="button"
            disabled={model.busy}
            onPress={() => void model.selectBaby(baby)}
            style={styles.button}
          >
            <Text style={styles.white}>{baby.name}</Text>
          </Pressable>
        ))}
        {!model.babies.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void model.loadProfiles()}
            style={styles.link}
          >
            <Text>Reload profiles</Text>
          </Pressable>
        ) : null}
        {model.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {model.error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => void model.signOut()}
          style={styles.link}
        >
          <Text>Sign out</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={styles.content}>
      <ActivityIcon name="nursing" color="#B35D7D" size={40} />
      <Text accessibilityRole="header" style={styles.title}>
        Connect to {model.providerName}
      </Text>
      <Text style={styles.copy}>Use the account with access to your shared baby profile.</Text>
      {model.stage === 'email' ? (
        <>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            editable={!model.busy}
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={model.busy || !email.trim().includes('@')}
            onPress={() => void model.sendOtp(email.trim())}
            style={styles.button}
          >
            <Text style={styles.white}>{model.busy ? 'Please wait…' : 'Send sign-in code'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={model.busy || !email.trim().includes('@')}
            onPress={() => model.enterExistingCode()}
            style={styles.link}
          >
            <Text>Enter a code I already have</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Sign-in code"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            editable={!model.busy}
            value={code}
            onChangeText={setCode}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={model.busy || !code.trim()}
            onPress={() =>
              void model.login(email.trim(), code.trim()).then((ok) => {
                if (ok) setCode('');
              })
            }
            style={styles.button}
          >
            <Text style={styles.white}>{model.busy ? 'Please wait…' : 'Sign in'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={model.busy}
            onPress={() => {
              setCode('');
              void model.signOut();
            }}
            style={styles.link}
          >
            <Text>Use another email</Text>
          </Pressable>
        </>
      )}
      <Link href="/local" style={styles.link}>
        Separate on-device tracker
      </Link>
      {model.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {model.error}
        </Text>
      ) : null}
      {model.error && model.stage === 'email' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void model.signOut()}
          style={styles.link}
        >
          <Text>Clear saved sign-in</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 70, gap: 18 },
  title: { fontSize: 26, fontWeight: '700', color: '#292724' },
  copy: { fontSize: 14, color: '#746F68' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#D8CFC5',
    borderRadius: 14,
    padding: 14,
    fontSize: 17,
    backgroundColor: '#FFFFFF',
  },
  button: {
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#B35D7D',
  },
  white: { color: '#FFFFFF', fontWeight: '700' },
  link: { minHeight: 44, paddingVertical: 12, color: '#5B4C94' },
  error: { color: '#A64444', fontSize: 14 },
});
