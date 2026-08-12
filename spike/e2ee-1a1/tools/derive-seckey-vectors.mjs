/**
 * SPIKE ONLY — re-express the frozen vectors in the representations that
 * Security.framework and JCA consume.
 *
 * The frozen vectors are the source of truth and are NOT modified. Apple's
 * `SecKeyCreateWithData` wants the raw EC form (0x04||X||Y for a public key,
 * 0x04||X||Y||K for a private key), and JCA wants PKCS#8 / X.509 SPKI, so this
 * derives both from the same bytes rather than generating anything new.
 *
 *   node spike/e2ee-1a1/tools/derive-seckey-vectors.mjs
 */

import { webcrypto as wc } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const subtle = wc.subtle;
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'generated');
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const unhex = (s) => new Uint8Array(s.match(/../g).map((x) => parseInt(x, 16)));
const hex = (b) => Buffer.from(b).toString('hex');
const b64uToBytes = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

/** PKCS#8 -> { x, y, d } via a JWK export, then the Apple raw forms. */
async function appleForms(pkcs8Hex, usage) {
  const alg = usage === 'ECDH' ? { name: 'ECDH', namedCurve: 'P-256' } : { name: 'ECDSA', namedCurve: 'P-256' };
  const ops = usage === 'ECDH' ? ['deriveBits'] : ['sign'];
  const key = await subtle.importKey('pkcs8', unhex(pkcs8Hex), alg, true, ops);
  const jwk = await subtle.exportKey('jwk', key);
  const x = b64uToBytes(jwk.x);
  const y = b64uToBytes(jwk.y);
  const d = b64uToBytes(jwk.d);
  if (x.length !== 32 || y.length !== 32 || d.length !== 32) {
    throw new Error('unexpected P-256 coordinate width');
  }
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  pub.set(x, 1);
  pub.set(y, 33);
  const priv = new Uint8Array(97);
  priv.set(pub, 0);
  priv.set(d, 65);
  return { xHex: hex(x), yHex: hex(y), dHex: hex(d), secKeyPublicHex: hex(pub), secKeyPrivateHex: hex(priv) };
}

const interop = read('interop-vectors.json');
const lz = read('ecdh-leading-zero.json');
const glk2 = read('glk2-vector.json');

const out = {
  _comment:
    'TEST ONLY throwaway keys, derived from the frozen vectors. Apple raw EC form is 0x04||X||Y(||K). Not production material.',
  derivedFrom: ['interop-vectors.json', 'ecdh-leading-zero.json', 'glk2-vector.json'],

  ecdhNormal: {
    ...(await appleForms(interop.vector2_ecdh.privatePkcs8Hex, 'ECDH')),
    privatePkcs8Hex: interop.vector2_ecdh.privatePkcs8Hex,
    peerPublicSpkiHex: interop.vector2_ecdh.peerPublicSpkiHex,
    peerPublicRawHex: interop.vector1_publicKeys.agreementB.sec1UncompressedHex,
    expectedSharedSecretHex: interop.vector2_ecdh.sharedSecretHex,
  },

  ecdhLeadingZero: {
    ...(await appleForms(lz.privatePkcs8Hex, 'ECDH')),
    privatePkcs8Hex: lz.privatePkcs8Hex,
    peerPublicSpkiHex: lz.peerPublicSpkiHex,
    peerPublicRawHex: lz.peerPublicRawHex,
    expectedSharedSecretHex: lz.sharedSecretHex,
    note: 'X coordinate begins with 0x00. Native output MUST be left-zero-padded to 32 bytes.',
  },

  ecdsaVerify: {
    signerSpkiHex: interop.vector1_publicKeys.signing.spkiHex,
    signerRawHex: interop.vector1_publicKeys.signing.sec1UncompressedHex,
    signerPkcs8Hex: interop.vector1_publicKeys.signing.pkcs8Hex,
    messageUtf8: interop.vector5_ecdsa.messageUtf8,
    signatureP1363Hex: interop.vector5_ecdsa.signatureP1363Hex,
  },

  hkdf: interop.vector3_hkdf,
  aesGcm: interop.vector4_aesGcm,

  fingerprints: {
    signingSpkiSha256Hex: interop.vector1_publicKeys.signing.spkiSha256Hex,
    agreementASpkiSha256Hex: interop.vector1_publicKeys.agreementA.spkiSha256Hex,
    agreementBSpkiSha256Hex: interop.vector1_publicKeys.agreementB.spkiSha256Hex,
  },

  glk2: {
    envelopeHex: glk2.envelopeHex,
    senderSigSpkiHex: glk2.senderSigSpkiHex,
    recipientKemSpkiHex: glk2.recipientKemSpkiHex,
    recipientKemPkcs8Hex: glk2.recipientKemPkcs8Hex,
    expectedScopeKeyHex: glk2.expectedScopeKeyHex,
    ...(await (async () => {
      const f = await appleForms(glk2.recipientKemPkcs8Hex, 'ECDH');
      return { recipientKemSecKeyPrivateHex: f.secKeyPrivateHex, recipientKemRawHex: f.secKeyPublicHex };
    })()),
    senderSigRawHex: hex(unhex(glk2.senderSigSpkiHex).slice(-65)),
  },
};

const path = join(dir, 'seckey-vectors.json');
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${path}`);
