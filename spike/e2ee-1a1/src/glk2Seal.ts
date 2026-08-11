/**
 * SPIKE ONLY — experimental GLK2 seal/open built on `glk2.ts`.
 *
 * Single-sourced so the mutation tests and the frozen cross-platform vector
 * exercise exactly the same bytes. NOT production code.
 */

import { concat, equal } from './bytes.ts';
import {
  ENVELOPE_LENGTH,
  Glk2Error,
  type Glk2Header,
  aad,
  decodeHeader,
  deriveKek,
  encodeHeader,
  sha256,
  signedMessage,
  splitEnvelope,
} from './glk2.ts';

const subtle = crypto.subtle;

export type SealInput = {
  header: Omit<Glk2Header, 'senderSigPubFp' | 'recipientKemPubFp'>;
  scopeKey: Uint8Array;
  senderSigPrivate: CryptoKey;
  senderSigSpki: Uint8Array;
  recipientKemSpki: Uint8Array;
  /**
   * Fixed nonce and ephemeral key, for frozen vectors only.
   *
   * A deterministic envelope is what lets iOS and Android verify against bytes
   * this machine produced. Never do this outside vector generation: reusing an
   * ephemeral key and nonce across two different wrapped keys is a nonce reuse.
   */
  fixed?: { nonce: Uint8Array; ephemeralPkcs8: Uint8Array; ephemeralPublicRaw: Uint8Array };
};

export async function seal(input: SealInput): Promise<Uint8Array> {
  if (input.scopeKey.length !== 32) throw new Glk2Error('E_SCOPE_KEY_WIDTH', 'scope key must be 32 bytes');

  const senderSigPubFp = await sha256(input.senderSigSpki);
  const recipientKemPubFp = await sha256(input.recipientKemSpki);
  const header = encodeHeader({ ...input.header, senderSigPubFp, recipientKemPubFp });

  const recipientKem = await subtle.importKey(
    'spki',
    input.recipientKemSpki as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  let ephemeralPrivate: CryptoKey;
  let ephemeralPub: Uint8Array;
  if (input.fixed) {
    ephemeralPrivate = await subtle.importKey(
      'pkcs8',
      input.fixed.ephemeralPkcs8 as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    // Derive the public point from the frozen pair supplied by the caller.
    ephemeralPub = input.fixed.ephemeralPublicRaw;
  } else {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    ephemeralPrivate = kp.privateKey;
    ephemeralPub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  }

  const z = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: recipientKem }, ephemeralPrivate, 256),
  );
  const kek = await deriveKek(z, ephemeralPub, input.recipientKemSpki, header);

  const nonce = input.fixed ? input.fixed.nonce : crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = new Uint8Array(
    await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: aad(header, ephemeralPub) as BufferSource,
        tagLength: 128,
      },
      kek,
      input.scopeKey as BufferSource,
    ),
  );

  const signature = new Uint8Array(
    await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      input.senderSigPrivate,
      signedMessage(header, ephemeralPub, nonce, wrappedKey) as BufferSource,
    ),
  );

  const envelope = concat(header, ephemeralPub, nonce, wrappedKey, signature);
  if (envelope.length !== ENVELOPE_LENGTH) {
    throw new Glk2Error('E_ENVELOPE_LENGTH', `built ${envelope.length} bytes, expected ${ENVELOPE_LENGTH}`);
  }
  return envelope;
}

export type OpenInput = {
  envelope: Uint8Array;
  recipientKemPrivate: CryptoKey;
  recipientKemSpki: Uint8Array;
  senderSigSpki: Uint8Array;
  /** Skip signature verification to prove the AEAD layer independently fails. */
  skipSignature?: boolean;
};

export async function open(input: OpenInput): Promise<{ scopeKey: Uint8Array; header: Glk2Header }> {
  const parts = splitEnvelope(input.envelope);
  const header = decodeHeader(parts.header);

  const expectedRecipientFp = await sha256(input.recipientKemSpki);
  if (!equal(header.recipientKemPubFp, expectedRecipientFp)) {
    throw new Glk2Error('E_RECIPIENT_FP_MISMATCH', 'envelope is not addressed to this key');
  }
  const expectedSenderFp = await sha256(input.senderSigSpki);
  if (!equal(header.senderSigPubFp, expectedSenderFp)) {
    throw new Glk2Error('E_SENDER_FP_MISMATCH', 'sender fingerprint does not match the registered key');
  }

  if (!input.skipSignature) {
    const senderKey = await subtle.importKey(
      'spki',
      input.senderSigSpki as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      senderKey,
      parts.signature as BufferSource,
      signedMessage(parts.header, parts.ephemeralPub, parts.nonce, parts.wrappedKey) as BufferSource,
    );
    if (!ok) throw new Glk2Error('E_BAD_SIGNATURE', 'sender signature did not verify');
  }

  const ephemeral = await subtle.importKey(
    'raw',
    parts.ephemeralPub as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const z = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: ephemeral }, input.recipientKemPrivate, 256),
  );
  const kek = await deriveKek(z, parts.ephemeralPub, input.recipientKemSpki, parts.header);

  let scopeKey: Uint8Array;
  try {
    scopeKey = new Uint8Array(
      await subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: parts.nonce as BufferSource,
          additionalData: aad(parts.header, parts.ephemeralPub) as BufferSource,
          tagLength: 128,
        },
        kek,
        parts.wrappedKey as BufferSource,
      ),
    );
  } catch {
    throw new Glk2Error('E_AEAD_FAILED', 'wrapped key failed authentication');
  }
  if (scopeKey.length !== 32) throw new Glk2Error('E_SCOPE_KEY_WIDTH', 'unwrapped key is not 32 bytes');
  return { scopeKey, header };
}
