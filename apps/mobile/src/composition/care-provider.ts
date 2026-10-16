import { randomUUID } from 'expo-crypto';
import type { CareProvider } from '@/features/care-service/contracts';
import { NapperClient } from '@/features/napper/client';
import { napperProvider } from '@/features/napper/care-service';
import { napperDeviceId, SecureNapperCredentials } from '@/features/napper/secure-credentials';

/** The only UI composition dependency on Napper. Swap this factory for our future service. */
export async function createCareProvider(timezone: string): Promise<CareProvider> {
  return napperProvider(
    new NapperClient(new SecureNapperCredentials(), await napperDeviceId()),
    randomUUID,
    timezone,
  );
}
