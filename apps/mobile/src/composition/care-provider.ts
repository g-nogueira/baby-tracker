import { randomUUID } from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { CareProvider } from '@/features/care-service/contracts';
import { NapperClient } from '@/features/napper/client';
import { napperProvider } from '@/features/napper/care-service';
import { napperDeviceId, SecureNapperCredentials } from '@/features/napper/secure-credentials';
import { createOtlpSyncTelemetry } from '@/features/telemetry/otlp-sync-telemetry';

/** The only UI composition dependency on Napper. Swap this factory for our future service. */
export async function createCareProvider(timezone: string): Promise<CareProvider> {
  const platform = Platform.OS;
  const telemetry =
    platform === 'android' || platform === 'ios'
      ? createOtlpSyncTelemetry({
          endpoint: process.env.EXPO_PUBLIC_BABY_TRACKER_OTLP_URL,
          verbose: process.env.EXPO_PUBLIC_BABY_TRACKER_TELEMETRY_VERBOSE === '1',
          version: Constants.expoConfig?.version,
          platform,
          randomId: randomUUID,
        })
      : undefined;
  return napperProvider(
    new NapperClient(
      new SecureNapperCredentials(),
      await napperDeviceId(),
      undefined,
      undefined,
      telemetry,
    ),
    randomUUID,
    timezone,
  );
}
