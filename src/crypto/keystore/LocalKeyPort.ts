import { GCM_NONCE_BYTES } from '@/crypto/suite';

/** Binding is part of the native alias/capability, not caller metadata. */
export type LocalKeyBinding = {
  installationId: string;
  userId: string;
  deviceId: string;
  purpose: 'lck';
  version: 1;
};

export type SealedLocalBytes = {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

/**
 * A local-key capability. It deliberately has no export/raw-key operation.
 * Native implementations keep the AES key in Keychain/Keystore and perform
 * seal/open inside the platform plugin.
 */
export interface LocalKeyCapability {
  readonly binding: LocalKeyBinding;
  has(): Promise<boolean>;
  seal(input: { plaintext: Uint8Array; aad: Uint8Array }): Promise<SealedLocalBytes>;
  open(input: { sealed: SealedLocalBytes; aad: Uint8Array }): Promise<Uint8Array>;
  delete(): Promise<void>;
}

export interface LocalKeyPort {
  /** Load only; never creates a replacement key. */
  load(binding: LocalKeyBinding): Promise<LocalKeyCapability | null>;
  loadOrCreate(binding: LocalKeyBinding): Promise<LocalKeyCapability | null>;
}

export function assertLocalNonce(nonce: Uint8Array): void {
  if (nonce.length !== GCM_NONCE_BYTES) throw new Error('E_LOCAL_NONCE: wrong nonce width');
}
