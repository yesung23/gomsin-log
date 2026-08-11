// SPIKE ONLY — Java Cryptography Architecture wire-format probe.
//
// SCOPE WARNING, read before quoting any result from this file:
//
//   This runs on a DESKTOP JDK (SunEC / SunJCE providers). Android uses
//   Conscrypt / BoringSSL and, for hardware keys, AndroidKeyStore. This probe
//   therefore establishes JCA *API shape and wire format* only. It is NOT
//   evidence about AndroidKeyStore, operation-by-handle, StrongBox, TEE, key
//   invalidation, or any hardware assurance property. Those remain UNVERIFIED
//   until run on a real Android device.
//
// Consumes the frozen vectors. All keys are TEST ONLY throwaway material.
//
//   javac JcaProbe.java && java JcaProbe <path-to-seckey-vectors.json>

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class JcaProbe {

    record Res(String name, String status, String detail) {}
    static final List<Res> results = new ArrayList<>();

    static void record(String name, String status, String detail) {
        results.add(new Res(name, status, detail));
        System.err.println("[" + status + "] " + name + ": " + detail);
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    static byte[] unhex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    static byte[] cat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] out = new byte[n];
        int o = 0;
        for (byte[] p : parts) { System.arraycopy(p, 0, out, o, p.length); o += p.length; }
        return out;
    }

    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    /** Minimal JSON string-field reader; the vector file is flat and machine-written. */
    static String field(String json, String section, String key) {
        int s = json.indexOf("\"" + section + "\"");
        if (s < 0) throw new IllegalArgumentException("no section " + section);
        int k = json.indexOf("\"" + key + "\"", s);
        if (k < 0) throw new IllegalArgumentException("no key " + key + " in " + section);
        int q1 = json.indexOf('"', json.indexOf(':', k) + 1);
        int q2 = json.indexOf('"', q1 + 1);
        return json.substring(q1 + 1, q2);
    }

    /** The constant 26-byte DER prefix of a P-256 SubjectPublicKeyInfo. */
    static final byte[] P256_SPKI_PREFIX =
            unhex("3059301306072a8648ce3d020106082a8648ce3d030107034200");

    static PublicKey pubFromRaw(byte[] sec1) throws Exception {
        return KeyFactory.getInstance("EC")
                .generatePublic(new X509EncodedKeySpec(cat(P256_SPKI_PREFIX, sec1)));
    }

    static PublicKey pubFromSpki(byte[] spki) throws Exception {
        return KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(spki));
    }

    static PrivateKey privFromPkcs8(byte[] pkcs8) throws Exception {
        return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
    }

    static byte[] p1363ToDer(byte[] sig) {
        byte[] r = derInt(Arrays.copyOfRange(sig, 0, 32));
        byte[] s = derInt(Arrays.copyOfRange(sig, 32, 64));
        byte[] body = cat(r, s);
        return cat(new byte[]{0x30, (byte) body.length}, body);
    }

    static byte[] derInt(byte[] raw) {
        int start = 0;
        while (start < raw.length - 1 && raw[start] == 0) start++;
        byte[] v = Arrays.copyOfRange(raw, start, raw.length);
        boolean pad = (v[0] & 0x80) != 0;
        byte[] out = new byte[2 + v.length + (pad ? 1 : 0)];
        out[0] = 0x02;
        out[1] = (byte) (v.length + (pad ? 1 : 0));
        System.arraycopy(v, 0, out, pad ? 3 : 2, v.length);
        return out;
    }

    static byte[] derToP1363(byte[] der) {
        int i = 2;
        byte[][] parts = new byte[2][];
        for (int p = 0; p < 2; p++) {
            int len = der[i + 1];
            byte[] v = Arrays.copyOfRange(der, i + 2, i + 2 + len);
            i += 2 + len;
            byte[] fixed = new byte[32];
            int copy = Math.min(32, v.length);
            System.arraycopy(v, v.length - copy, fixed, 32 - copy, copy);
            parts[p] = fixed;
        }
        return cat(parts[0], parts[1]);
    }

    /** RFC 5869 HKDF-SHA256. The JDK 21 platform has no built-in KDF API. */
    static byte[] hkdf(byte[] ikm, byte[] salt, byte[] info, int len) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt.length == 0 ? new byte[32] : salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        byte[] out = new byte[len];
        byte[] t = new byte[0];
        int pos = 0;
        for (int c = 1; pos < len; c++) {
            mac.init(new SecretKeySpec(prk, "HmacSHA256"));
            mac.update(t);
            mac.update(info);
            mac.update((byte) c);
            t = mac.doFinal();
            int n = Math.min(t.length, len - pos);
            System.arraycopy(t, 0, out, pos, n);
            pos += n;
        }
        return out;
    }

    public static void main(String[] args) throws Exception {
        String json = Files.readString(Path.of(args.length > 0 ? args[0] : "seckey-vectors.json"));

        record("environment", "INFO",
                "JDK " + System.getProperty("java.version")
                        + " providers=" + Security.getProvider("SunEC") + "/" + Security.getProvider("SunJCE")
                        + " (DESKTOP JDK, NOT AndroidKeyStore)");

        // ---- 1. ECDH, both frozen cases ----
        for (String[] c : new String[][]{{"normal", "ecdhNormal"}, {"leadingZero", "ecdhLeadingZero"}}) {
            PrivateKey priv = privFromPkcs8(unhex(field(json, c[1], "privatePkcs8Hex")));
            PublicKey peer = pubFromSpki(unhex(field(json, c[1], "peerPublicSpkiHex")));
            KeyAgreement ka = KeyAgreement.getInstance("ECDH");
            ka.init(priv);
            ka.doPhase(peer, true);
            byte[] z = ka.generateSecret();
            String expected = field(json, c[1], "expectedSharedSecretHex");
            boolean match = hex(z).equals(expected);
            record("jca.ecdh." + c[0], match && z.length == 32 ? "VERIFIED" : "FAILED",
                    "len=" + z.length + " match=" + match
                            + " first=0x" + String.format("%02x", z[0]));
            if (c[0].equals("leadingZero")) {
                record("jca.ecdh.leadingZero.width", z.length == 32 ? "VERIFIED" : "SUPPORTED WITH LIMITATIONS",
                        z.length == 32
                                ? "SunEC KeyAgreement.generateSecret() returned the full 32 bytes including the leading 0x00."
                                : "SunEC returned " + z.length + " bytes; left-zero-padding is mandatory.");
            }
        }

        // ---- 2. Public key encoding ----
        {
            byte[] spki = unhex(field(json, "ecdhNormal", "peerPublicSpkiHex"));
            byte[] raw = unhex(field(json, "ecdhNormal", "peerPublicRawHex"));
            PublicKey k = pubFromRaw(raw);
            boolean roundTrip = Arrays.equals(k.getEncoded(), spki);
            record("jca.publicKeyEncoding", roundTrip ? "VERIFIED" : "FAILED",
                    "X509EncodedKeySpec(prefix||SEC1 point) re-encodes to the identical 91-byte SPKI: " + roundTrip
                            + "; getEncoded() is SPKI, so the same prefix rule works on Java.");
            byte[] fp = MessageDigest.getInstance("SHA-256").digest(spki);
            record("jca.fingerprint", hex(fp).equals(field(json, "fingerprints", "agreementBSpkiSha256Hex"))
                            ? "VERIFIED" : "FAILED",
                    "SHA-256(SPKI) matches the frozen fingerprint.");
        }

        // ---- 3. ECDSA both directions ----
        {
            PublicKey pub = pubFromSpki(unhex(field(json, "ecdsaVerify", "signerSpkiHex")));
            byte[] msg = utf8(field(json, "ecdsaVerify", "messageUtf8"));
            byte[] p1363 = unhex(field(json, "ecdsaVerify", "signatureP1363Hex"));

            Signature v = Signature.getInstance("SHA256withECDSA");
            v.initVerify(pub);
            v.update(msg);
            boolean rawAccepted;
            try { rawAccepted = v.verify(p1363); } catch (SignatureException e) { rawAccepted = false; }
            record("jca.ecdsa.rejectsRawP1363", !rawAccepted ? "VERIFIED" : "FAILED",
                    "SHA256withECDSA rejects a bare P-1363 signature: " + !rawAccepted + " (conversion is mandatory)");

            v = Signature.getInstance("SHA256withECDSA");
            v.initVerify(pub);
            v.update(msg);
            boolean ok = v.verify(p1363ToDer(p1363));
            record("jca.ecdsa.webToJca", ok ? "VERIFIED" : "FAILED",
                    "WebCrypto P-1363 signature, converted to DER, verified by SunEC: " + ok);

            PrivateKey signer = privFromPkcs8(unhex(field(json, "ecdsaVerify", "signerPkcs8Hex")));
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initSign(signer);
            byte[] jmsg = utf8("gomsinlog/1a1/jca-signs");
            s.update(jmsg);
            byte[] der = s.sign();
            record("jca.ecdsa.nativeEncoding", der[0] == 0x30 ? "VERIFIED" : "FAILED",
                    "SunEC emits X9.62 DER (" + der.length + " bytes, first 0x"
                            + String.format("%02x", der[0]) + "), NOT P-1363.");
            record("jca.ecdsa.jcaToWeb.export", "INFO",
                    "signerSpki=" + field(json, "ecdsaVerify", "signerSpkiHex")
                            + " message=gomsinlog/1a1/jca-signs sigP1363=" + hex(derToP1363(der)));
        }

        // ---- 4. AES-GCM ----
        {
            byte[] key = unhex(field(json, "aesGcm", "keyHex"));
            byte[] nonce = unhex(field(json, "aesGcm", "nonceHex"));
            byte[] pt = unhex(field(json, "aesGcm", "plaintextHex"));
            byte[] aad = utf8(field(json, "aesGcm", "aadUtf8"));
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
            c.updateAAD(aad);
            byte[] sealed = c.doFinal(pt);
            boolean match = hex(sealed).equals(field(json, "aesGcm", "ciphertextWithTagHex"));
            record("jca.aesGcm", match ? "VERIFIED" : "FAILED",
                    "SunJCE returns ciphertext||tag (" + sealed.length + " bytes) identical to the WebCrypto vector: " + match);
        }

        // ---- 5. HKDF ----
        {
            byte[] okm = hkdf(unhex(field(json, "hkdf", "ikmHex")),
                    unhex(field(json, "hkdf", "saltHex")),
                    utf8(field(json, "hkdf", "infoUtf8")), 32);
            boolean match = hex(okm).equals(field(json, "hkdf", "okmHex"));
            record("jca.hkdf", match ? "VERIFIED" : "FAILED",
                    "RFC 5869 HKDF over javax.crypto.Mac matches the WebCrypto vector: " + match
                            + " (JDK 21 has no built-in HKDF; a KDF must be supplied)");
        }

        // ---- 6. Full GLK2 unwrap of the Web-sealed envelope ----
        {
            byte[] env = unhex(field(json, "glk2", "envelopeHex"));
            byte[] H = Arrays.copyOfRange(env, 0, 171);
            byte[] eph = Arrays.copyOfRange(env, 171, 236);
            byte[] nonce = Arrays.copyOfRange(env, 236, 248);
            byte[] wrapped = Arrays.copyOfRange(env, 248, 296);
            byte[] sig = Arrays.copyOfRange(env, 296, 360);

            PublicKey sender = pubFromSpki(unhex(field(json, "glk2", "senderSigSpkiHex")));
            Signature v = Signature.getInstance("SHA256withECDSA");
            v.initVerify(sender);
            v.update(cat(utf8("gomsinlog/glk2/sig/v1"), H, eph, nonce, wrapped));
            boolean sigOk = v.verify(p1363ToDer(sig));

            byte[] recipSpki = unhex(field(json, "glk2", "recipientKemSpkiHex"));
            PrivateKey recip = privFromPkcs8(unhex(field(json, "glk2", "recipientKemPkcs8Hex")));
            KeyAgreement ka = KeyAgreement.getInstance("ECDH");
            ka.init(recip);
            ka.doPhase(pubFromRaw(eph), true);
            byte[] z = ka.generateSecret();
            if (z.length < 32) { // the normalization rule, applied
                byte[] p = new byte[32];
                System.arraycopy(z, 0, p, 32 - z.length, z.length);
                z = p;
            }

            byte[] salt = MessageDigest.getInstance("SHA-256")
                    .digest(cat(utf8("gomsinlog/glk2/salt/v1"), eph, recipSpki));
            byte[] kek = hkdf(z, salt, cat(utf8("gomsinlog/glk2/kek/v1"), H), 32);

            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(kek, "AES"), new GCMParameterSpec(128, nonce));
            c.updateAAD(cat(utf8("gomsinlog/glk2/aad/v1"), H, eph));
            byte[] scope = c.doFinal(wrapped);

            boolean scopeOk = hex(scope).equals(field(json, "glk2", "expectedScopeKeyHex"));
            record("jca.glk2.webToJca", sigOk && scopeOk ? "VERIFIED" : "FAILED",
                    "signature=" + sigOk + " unwrappedScopeKeyMatches=" + scopeOk
                            + " (envelope sealed by WebCrypto, opened by JCA)");

            // Tamper check on the same path.
            byte[] bad = env.clone();
            bad[7] ^= 0x01; // domain byte
            byte[] badH = Arrays.copyOfRange(bad, 0, 171);
            Cipher c2 = Cipher.getInstance("AES/GCM/NoPadding");
            c2.init(Cipher.DECRYPT_MODE, new SecretKeySpec(
                    hkdf(z, MessageDigest.getInstance("SHA-256")
                            .digest(cat(utf8("gomsinlog/glk2/salt/v1"), eph, recipSpki)),
                            cat(utf8("gomsinlog/glk2/kek/v1"), badH), 32), "AES"),
                    new GCMParameterSpec(128, nonce));
            c2.updateAAD(cat(utf8("gomsinlog/glk2/aad/v1"), badH, eph));
            boolean rejected;
            try { c2.doFinal(wrapped); rejected = false; } catch (GeneralSecurityException e) { rejected = true; }
            record("jca.glk2.tamperRejected", rejected ? "VERIFIED" : "FAILED",
                    "flipping the domain byte makes JCA reject the envelope: " + rejected);
        }

        // ---- 7. Verify a signature produced by another platform (optional args) ----
        if (args.length > 3) {
            PublicKey pub = pubFromSpki(unhex(args[1]));
            String label = args.length > 4 ? args[4] : "external";
            Signature v = Signature.getInstance("SHA256withECDSA");
            v.initVerify(pub);
            v.update(utf8(args[2]));
            boolean ok = v.verify(p1363ToDer(unhex(args[3])));
            record("crossPlatform." + label + "ToJca", ok ? "VERIFIED" : "FAILED",
                    "signature from " + label + ", normalized P-1363 -> DER, verified by SunEC: " + ok);
        }

        StringBuilder out = new StringBuilder("{\n  \"probe\": \"jca\",\n  \"results\": [\n");
        for (int i = 0; i < results.size(); i++) {
            Res r = results.get(i);
            out.append("    {\"name\": \"").append(r.name())
               .append("\", \"status\": \"").append(r.status())
               .append("\", \"detail\": \"").append(r.detail().replace("\\", "\\\\").replace("\"", "\\\""))
               .append("\"}").append(i + 1 < results.size() ? "," : "").append("\n");
        }
        out.append("  ]\n}\n");
        System.out.println(out);
    }
}
