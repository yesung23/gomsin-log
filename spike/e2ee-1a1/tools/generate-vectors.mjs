/**
 * SPIKE ONLY — generate and freeze the shared cross-platform test vectors.
 *
 * Run once; the output is committed so that an iOS or Android probe written
 * later consumes byte-identical inputs. Re-running overwrites the vectors and
 * invalidates any result already recorded against them, so do not re-run
 * casually.
 *
 *   node spike/e2ee-1a1/tools/generate-vectors.mjs
 *
 * Every private key produced here is a THROWAWAY TEST KEY. It protects nothing
 * and must never appear in application code.
 */

import { webcrypto as wc } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const subtle = wc.subtle;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'vectors', 'generated');
mkdirSync(outDir, { recursive: true });

const hex = (b) => Buffer.from(b).toString('hex');
const enc = (s) => new TextEncoder().encode(s);
const cat = (...p) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of p) { out.set(x, o); o += x.length; }
  return out;
};

function write(name, value) {
  const path = join(outDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

async function ecdhPair() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    kp,
    pkcs8: new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey)),
    spki: new Uint8Array(await subtle.exportKey('spki', kp.publicKey)),
    raw: new Uint8Array(await subtle.exportKey('raw', kp.publicKey)),
  };
}

/* ------------------------------------------------------------------ */
/* Vector: ECDH shared secret whose X coordinate begins with 0x00.     */
/* Roughly 1 keypair in 256. This is the case that catches a native    */
/* implementation which strips leading zeros instead of padding.       */
/* ------------------------------------------------------------------ */
async function leadingZeroEcdh() {
  const a = await ecdhPair();
  for (let attempt = 1; attempt <= 20000; attempt += 1) {
    const b = await ecdhPair();
    const secret = new Uint8Array(
      await subtle.deriveBits({ name: 'ECDH', public: b.kp.publicKey }, a.kp.privateKey, 256),
    );
    if (secret[0] === 0x00) {
      return {
        _comment: 'TEST ONLY throwaway keys. Shared secret X coordinate starts with 0x00.',
        attempts: attempt,
        privatePkcs8Hex: hex(a.pkcs8),
        publicSpkiHex: hex(a.spki),
        peerPrivatePkcs8Hex: hex(b.pkcs8),
        peerPublicSpkiHex: hex(b.spki),
        peerPublicRawHex: hex(b.raw),
        sharedSecretHex: hex(secret),
        sharedSecretMinimalHex: hex(secret.subarray(1)),
        rule: 'Native ECDH output MUST be left-zero-padded to exactly 32 bytes.',
      };
    }
  }
  throw new Error('no leading-zero shared secret found; rerun');
}

/* ------------------------------------------------------------------ */
/* Vectors 1-5: the cross-platform interoperability matrix inputs.     */
/* ------------------------------------------------------------------ */
async function interopVectors() {
  const sigKp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const sigPkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', sigKp.privateKey));
  const sigSpki = new Uint8Array(await subtle.exportKey('spki', sigKp.publicKey));
  const sigRaw = new Uint8Array(await subtle.exportKey('raw', sigKp.publicKey));

  const kemA = await ecdhPair();
  const kemB = await ecdhPair();
  const sharedNormal = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: kemB.kp.publicKey }, kemA.kp.privateKey, 256),
  );

  const sigFp = new Uint8Array(await subtle.digest('SHA-256', sigSpki));
  const kemFpA = new Uint8Array(await subtle.digest('SHA-256', kemA.spki));
  const kemFpB = new Uint8Array(await subtle.digest('SHA-256', kemB.spki));

  // HKDF with GLK2-shaped labels.
  const ikm = await subtle.importKey('raw', sharedNormal, 'HKDF', false, ['deriveBits']);
  const salt = new Uint8Array(
    await subtle.digest('SHA-256', cat(enc('gomsinlog/glk2/salt/v1'), kemB.raw, kemB.spki)),
  );
  const info = enc('gomsinlog/glk2/kek/v1');
  const okm = new Uint8Array(
    await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, 256),
  );

  // AES-256-GCM with a fixed key/nonce/plaintext/AAD.
  const aesKeyRaw = new Uint8Array(32).map((_, i) => (i * 7 + 13) & 0xff);
  const nonce = new Uint8Array(12).map((_, i) => i);
  const plaintext = new Uint8Array(32).map((_, i) => (255 - i * 3) & 0xff);
  const aad = enc('gomsinlog/glk2/aad/v1');
  const aesKey = await subtle.importKey('raw', aesKeyRaw, { name: 'AES-GCM' }, false, ['encrypt']);
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, aesKey, plaintext),
  );

  const sigMessage = enc('gomsinlog/1a1/interop-signature-vector/v1');
  const signature = new Uint8Array(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sigKp.privateKey, sigMessage),
  );

  return {
    _comment: 'TEST ONLY throwaway keys. Consumed by Web, iOS and Android probes.',
    vector1_publicKeys: {
      signing: { pkcs8Hex: hex(sigPkcs8), spkiHex: hex(sigSpki), sec1UncompressedHex: hex(sigRaw), spkiSha256Hex: hex(sigFp) },
      agreementA: { pkcs8Hex: hex(kemA.pkcs8), spkiHex: hex(kemA.spki), sec1UncompressedHex: hex(kemA.raw), spkiSha256Hex: hex(kemFpA) },
      agreementB: { pkcs8Hex: hex(kemB.pkcs8), spkiHex: hex(kemB.spki), sec1UncompressedHex: hex(kemB.raw), spkiSha256Hex: hex(kemFpB) },
      rule: 'Fingerprints are SHA-256 over the SPKI DER, byte-identical on every platform.',
    },
    vector2_ecdh: {
      privatePkcs8Hex: hex(kemA.pkcs8),
      peerPublicSpkiHex: hex(kemB.spki),
      sharedSecretHex: hex(sharedNormal),
      leadingZeroCase: 'see ecdh-leading-zero.json',
    },
    vector3_hkdf: {
      ikmHex: hex(sharedNormal),
      saltHex: hex(salt),
      infoUtf8: 'gomsinlog/glk2/kek/v1',
      lengthBytes: 32,
      okmHex: hex(okm),
    },
    vector4_aesGcm: {
      keyHex: hex(aesKeyRaw),
      nonceHex: hex(nonce),
      plaintextHex: hex(plaintext),
      aadUtf8: 'gomsinlog/glk2/aad/v1',
      ciphertextWithTagHex: hex(sealed),
      note: 'WebCrypto returns ciphertext||tag. Platforms returning them separately must concatenate at the protocol boundary.',
    },
    vector5_ecdsa: {
      signerSpkiHex: hex(sigSpki),
      messageUtf8: 'gomsinlog/1a1/interop-signature-vector/v1',
      signatureP1363Hex: hex(signature),
      note: 'ECDSA is randomised; every platform must VERIFY this signature and may produce different bytes when signing.',
    },
  };
}

const leadingZero = await leadingZeroEcdh();
write('ecdh-leading-zero.json', leadingZero);
console.log(`  found after ${leadingZero.attempts} keypair(s)`);

write('interop-vectors.json', await interopVectors());
