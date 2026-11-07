import { randomUUID } from 'expo-crypto';
import Constants from 'expo-constants';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';
import { createMobileDiagnostics } from '@/features/telemetry/mobile-diagnostics';

const platform = Platform.OS;
const key = 'mobile-diagnostics.settings.v1';

export const diagnostics =
  platform === 'android' || platform === 'ios'
    ? createMobileDiagnostics(
        {
          read: () => Storage.getItem(key),
          write: (value) => Storage.setItem(key, value),
        },
        { platform, version: Constants.expoConfig?.version, randomId: randomUUID },
      )
    : undefined;
