import { fromBase64, toBase64 } from '@/crypto/bytes';
import type { LocalKeyBinding, LocalKeyCapability, LocalKeyPort, SealedLocalBytes } from './LocalKeyPort';

export type NativeLocalKeyPlugin = {
  lckEnsure(options: { installationId: string; userId: string; deviceId: string; purpose: string; version: number }): Promise<{ present: boolean }>;
  lckHas(options: { installationId: string; userId: string; deviceId: string; purpose: string; version: number }): Promise<{ present: boolean }>;
  lckSeal(options: { installationId: string; userId: string; deviceId: string; purpose: string; version: number; plaintext: string; aad: string }): Promise<{ nonce: string; ciphertext: string }>;
  lckOpen(options: { installationId: string; userId: string; deviceId: string; purpose: string; version: number; nonce: string; ciphertext: string; aad: string }): Promise<{ plaintext: string }>;
  lckDelete(options: { installationId: string; userId: string; deviceId: string; purpose: string; version: number }): Promise<void>;
};

export function createNativeLocalKeyPort(plugin: NativeLocalKeyPlugin): LocalKeyPort {
  const capability = (binding: LocalKeyBinding): LocalKeyCapability => {
    const args = { ...binding };
    const has = async () => (await plugin.lckHas(args)).present;
    return {
      binding,
      has,
      seal: async ({ plaintext, aad }) => {
        const result = await plugin.lckSeal({ ...args, plaintext: toBase64(plaintext), aad: toBase64(aad) });
        return { nonce: fromBase64(result.nonce), ciphertext: fromBase64(result.ciphertext) } satisfies SealedLocalBytes;
      },
      open: async ({ sealed, aad }) => fromBase64((await plugin.lckOpen({ ...args, nonce: toBase64(sealed.nonce), ciphertext: toBase64(sealed.ciphertext), aad: toBase64(aad) })).plaintext),
      delete: () => plugin.lckDelete(args),
    };
  };
  return {
    async load(binding) {
      const result = await plugin.lckHas({ ...binding });
      return result.present ? capability(binding) : null;
    },
    async loadOrCreate(binding) {
      const existing = await this.load(binding);
      if (existing) return existing;
      if (!(await plugin.lckEnsure({ ...binding })).present) return null;
      return capability(binding);
    },
  };
}
