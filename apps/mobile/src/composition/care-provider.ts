import { randomUUID } from 'expo-crypto';
import type { CareProvider } from '@/features/care-service/contracts';
import { NapperClient } from '@/features/napper/client';
import { napperProvider } from '@/features/napper/care-service';
import { napperDeviceId, SecureNapperCredentials } from '@/features/napper/secure-credentials';
import { diagnostics } from './diagnostics';

/** The only UI composition dependency on Napper. Swap this factory for our future service. */
export async function createCareProvider(timezone: string): Promise<CareProvider> {
  // Diagnostics preferences must never delay or prevent access to care records.
  void diagnostics?.load().catch(() => undefined);
  return napperProvider(
    new NapperClient(
      new SecureNapperCredentials(),
      await napperDeviceId(),
      undefined,
      undefined,
      diagnostics?.telemetry,
    ),
    randomUUID,
    timezone,
  );
}
