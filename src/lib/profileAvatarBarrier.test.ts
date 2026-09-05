import { afterEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: (name: string, params: unknown) => ({ abortSignal: () => rpc(name, params) }),
} }));
import { registerServerCallGate, type ServerCallGateRegistration } from './accountDeletion';
import { saveProfileAvatar } from './profileAvatars';
const OWNER = '10000000-0000-4000-8000-000000000001';
const OPERATION = '20000000-0000-4000-8000-000000000001';
let registration: ServerCallGateRegistration | undefined;
afterEach(() => { registration?.unregister(); rpc.mockReset(); });

it.each(['unknown', 'pending', 'clear'] as const)('checks fresh %s status through the actual deletion barrier', async (kind) => {
  registration = registerServerCallGate({ expectedUserId: OWNER, getCurrentUserId: () => OWNER, gate: async () => ({ kind }) });
  rpc.mockResolvedValue({ error: null, data: { user_id: OWNER, version: OPERATION } });
  const result = await saveProfileAvatar({ ownerId: OWNER, expectedVersion: null, operationId: OPERATION, dataUrl: null });
  expect(result.ok).toBe(kind === 'clear');
  expect(rpc).toHaveBeenCalledTimes(kind === 'clear' ? 1 : 0);
});
