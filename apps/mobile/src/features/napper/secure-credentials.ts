import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { type CredentialStore, type NapperCredentials, NapperError, object } from './contracts';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const key = 'napper.client.auth.v1';
/** One secure value keeps ID/refresh rotation together; no tokens in SQLite or AsyncStorage. */
export class SecureNapperCredentials implements CredentialStore {
  async load(): Promise<NapperCredentials | null> {
    try {
      const text = await SecureStore.getItemAsync(key, options);
      if (!text) return null;
      const row = object(JSON.parse(text));
      if (
        typeof row.idToken !== 'string' ||
        typeof row.refreshToken !== 'string' ||
        typeof row.accountId !== 'string' ||
        (row.expiresAt !== null && typeof row.expiresAt !== 'number') ||
        (row.babyId !== null && typeof row.babyId !== 'string')
      )
        throw new Error();
      return row as unknown as NapperCredentials;
    } catch {
      throw new NapperError(
        'auth',
        'Saved sign-in could not be read. Sign out, then sign in again.',
      );
    }
  }
  async save(value: NapperCredentials | null) {
    try {
      if (value) await SecureStore.setItemAsync(key, JSON.stringify(value), options);
      else await SecureStore.deleteItemAsync(key, options);
    } catch {
      throw new NapperError(
        'auth',
        'Sign-in could not be saved securely on this device. Try again.',
      );
    }
  }
}
export async function napperDeviceId() {
  const key = 'napper.client.device.v1';
  const stored = await SecureStore.getItemAsync(key, options);
  if (stored) return stored;
  const id = randomUUID();
  await SecureStore.setItemAsync(key, id, options);
  return id;
}
