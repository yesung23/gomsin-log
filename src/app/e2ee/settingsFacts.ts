import type { SupabaseClient } from '@supabase/supabase-js';
import { getDeviceKeyPort, getLocalKeyPort } from '@/crypto/keystore';
import { createSupabaseE2eeRepository } from '@/data/e2ee/SupabaseE2eeRepository';
import { createProtectedE2eeLocalState } from './protectedLocalState';
import { produceBootstrapFacts } from './bootstrapFacts';
import type { BootstrapFacts } from './bootstrapStateMachine';

/** Composition boundary for Settings; the component consumes facts only. */
export async function loadSettingsBootstrapFacts(input: {
  userId: string;
  coupleId: string | null;
  installationId: string;
  supabaseClient: SupabaseClient | null;
}): Promise<BootstrapFacts | null> {
  if (!input.supabaseClient) return null;
  const deviceKeys = getDeviceKeyPort();
  const localKeyPort = getLocalKeyPort();
  if (!deviceKeys || !localKeyPort) return null;
  const localState = await createProtectedE2eeLocalState({
    installationId: input.installationId,
    userId: input.userId,
    localKeys: localKeyPort,
  });
  if (!localState) return null;
  return produceBootstrapFacts({
    userId: input.userId,
    coupleId: input.coupleId,
    repository: createSupabaseE2eeRepository(input.supabaseClient),
    localState,
    deviceKeys,
  });
}
