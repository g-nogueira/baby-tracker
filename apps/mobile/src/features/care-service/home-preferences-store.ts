import Storage from 'expo-sqlite/kv-store';
import { parseHomePreferences, type HomePreferences } from './home-preferences';
const key = 'connected-home.preferences.v1';
/** Device UI preferences only: no care records, outbox operations, credentials or provider payloads. */
export const homePreferencesStore = {
  async load() {
    const raw = await Storage.getItem(key);
    return parseHomePreferences(raw ? JSON.parse(raw) : null);
  },
  async save(value: HomePreferences) {
    await Storage.setItem(key, JSON.stringify(value));
  },
};
