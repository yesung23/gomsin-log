package app.gomsinlog.devicekeys

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.KeyAgreement

/**
 * Operation-by-handle P-256 device keys backed by AndroidKeyStore.
 *
 * VERIFICATION STATUS — read before relying on anything here.
 *
 * **Nothing in this file has been executed against a real Android device or
 * emulator.** The Phase 1A-1 spike had no Android SDK available, so
 * AndroidKeyStore behaviour, operation by handle, key invalidation, uninstall
 * semantics and StrongBox/TEE detection are all
 * DEFERRED TO THE NATIVE INTEGRATION GATE.
 *
 * What *was* verified in 1A-1 is the JCA wire format on a desktop JDK
 * (SunEC/SunJCE): DER signature output, `X509EncodedKeySpec` producing the same
 * 91-byte SPKI, `ciphertext||tag` AES-GCM layout, and — importantly —
 * `KeyAgreement.generateSecret()` returning the full 32 bytes including a
 * leading zero. Android uses Conscrypt, a *different* provider, and whether it
 * matches SunEC on that last point is exactly the kind of thing that must be
 * measured rather than assumed. Hence the unconditional left-padding below.
 *
 * The protocol does not depend on how these questions resolve: assurance is a
 * reported value carried inside the signed certificate, so a correction here
 * changes a classification, not the protocol.
 *
 * Wire contract with TypeScript:
 *   public keys  SPKI DER, base64
 *   signatures   DER here; the bridge is told `encoding = "der"` and converts
 *   ECDH         exactly 32 bytes, left-zero-padded
 *   private keys never cross the boundary
 */
class DeviceKeysException(message: String) : Exception(message)

private const val PROVIDER = "AndroidKeyStore"
private const val ALIAS_PREFIX = "app.gomsinlog.devicekeys."

/** The constant 26-byte DER prefix of a P-256 SubjectPublicKeyInfo. */
private val P256_SPKI_PREFIX = byteArrayOf(
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a.toByte(), 0x86.toByte(), 0x48, 0xce.toByte(),
    0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a.toByte(), 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d,
    0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
)

enum class KeyKind { SIGN, AGREE }

class DeviceKeys {

    private val keyStore: KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

    private fun alias(handle: String) = ALIAS_PREFIX + handle

    fun generateKey(
        handle: String,
        kind: KeyKind,
        requireUserPresence: Boolean,
        invalidateOnBiometricChange: Boolean,
    ): Triple<String, ByteArray, String> {
        if (handle.isEmpty()) throw DeviceKeysException("alias must not be empty")
        if (hasKey(handle)) throw DeviceKeysException("alias already exists")

        val purposes = if (kind == KeyKind.SIGN) {
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        } else {
            KeyProperties.PURPOSE_AGREE_KEY
        }

        // AGREE_KEY arrived in API 31. Below that a hardware-backed ECDH key
        // cannot be created at all, and the honest outcome is to say so rather
        // than silently fall back to a software key while reporting hardware.
        if (kind == KeyKind.AGREE && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            throw DeviceKeysException("AndroidKeyStore key agreement requires API 31+")
        }

        val builder = KeyGenParameterSpec.Builder(alias(handle), purposes)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            // Defaults are permissive on purpose: a key invalidated by a
            // biometric enrollment change turns an ordinary device change into
            // unrecoverable key loss.
            .setUserAuthenticationRequired(requireUserPresence)

        if (invalidateOnBiometricChange && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.setInvalidatedByBiometricEnrollment(true)
        }

        // Ask for StrongBox where the platform offers it, then report what was
        // actually granted. Never claim StrongBox without asking KeyInfo.
        var requestedStrongBox = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                builder.setIsStrongBoxBacked(true)
                requestedStrongBox = true
            } catch (_: Exception) {
                requestedStrongBox = false
            }
        }

        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
        try {
            generator.initialize(builder.build())
            generator.generateKeyPair()
        } catch (e: Exception) {
            if (!requestedStrongBox) throw DeviceKeysException("key generation failed: ${e.message}")
            // StrongBox unavailable on this device; retry without it.
            val fallback = KeyGenParameterSpec.Builder(alias(handle), purposes)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(requireUserPresence)
                .build()
            generator.initialize(fallback)
            generator.generateKeyPair()
        }

        return Triple(handle, getPublicKey(handle), getAssurance(handle))
    }

    fun getPublicKey(handle: String): ByteArray {
        val certificate = keyStore.getCertificate(alias(handle))
            ?: throw DeviceKeysException("no key for handle $handle")
        val encoded = certificate.publicKey.encoded
        if (encoded.size != 91) throw DeviceKeysException("unexpected SPKI length ${encoded.size}")
        return encoded
    }

    /** Returns an X9.62 DER signature. The TypeScript bridge converts to P-1363. */
    fun sign(handle: String, message: ByteArray): ByteArray {
        val key = loadPrivate(handle)
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(key)
        signature.update(message)
        return signature.sign()
    }

    /**
     * Returns exactly 32 bytes: the big-endian X coordinate, left-zero-padded.
     *
     * The padding is unconditional. Conscrypt's behaviour on a shared secret
     * whose X coordinate begins with a zero byte is unmeasured, and a stripped
     * byte would derive a different KEK on roughly one envelope in 256 — a
     * failure that appears intermittently and nowhere else.
     */
    fun deriveSecret(handle: String, peerPublicKeySpki: ByteArray): ByteArray {
        val key = loadPrivate(handle)
        val peer = importPeer(peerPublicKeySpki)
        val agreement = KeyAgreement.getInstance("ECDH", PROVIDER)
        agreement.init(key)
        agreement.doPhase(peer, true)
        val raw = agreement.generateSecret()
        if (raw.size > 32) throw DeviceKeysException("shared secret is ${raw.size} bytes")
        if (raw.size == 32) return raw
        val padded = ByteArray(32)
        System.arraycopy(raw, 0, padded, 32 - raw.size, raw.size)
        return padded
    }

    fun deleteKey(handle: String) {
        if (keyStore.containsAlias(alias(handle))) keyStore.deleteEntry(alias(handle))
    }

    /**
     * Report the security level the platform actually granted.
     *
     * `software_keystore` is the answer whenever the platform does not clearly
     * state otherwise. Calling storage hardware-backed when that was never
     * established is the one mistake this function exists to prevent.
     */
    fun getAssurance(handle: String): String {
        val key = loadPrivate(handle)
        return try {
            val factory = KeyFactory.getInstance(key.algorithm, PROVIDER)
            val info = factory.getKeySpec(key, KeyInfo::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                when (info.securityLevel) {
                    KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
                    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
                    else -> "software_keystore"
                }
            } else {
                @Suppress("DEPRECATION")
                if (info.isInsideSecureHardware) "tee" else "software_keystore"
            }
        } catch (_: Exception) {
            "software_keystore"
        }
    }

    fun hasKey(handle: String): Boolean = keyStore.containsAlias(alias(handle))

    private fun loadPrivate(handle: String): PrivateKey {
        // Fail closed: an unknown handle must never fall through to a fresh key.
        val entry = keyStore.getEntry(alias(handle), null) as? KeyStore.PrivateKeyEntry
            ?: throw DeviceKeysException("no key for handle $handle")
        return entry.privateKey
    }

    private fun importPeer(spki: ByteArray): java.security.PublicKey {
        if (spki.size != 91) throw DeviceKeysException("peer SPKI length ${spki.size}")
        for (i in P256_SPKI_PREFIX.indices) {
            if (spki[i] != P256_SPKI_PREFIX[i]) throw DeviceKeysException("peer key is not P-256 SPKI")
        }
        if (spki[26] != 0x04.toByte()) throw DeviceKeysException("peer point not uncompressed")
        // Reject the identity element.
        if ((27 until 91).all { spki[it] == 0.toByte() }) {
            throw DeviceKeysException("peer point is the identity")
        }
        val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
        // Explicit on-curve check: y^2 == x^3 - 3x + b (mod p). Not every JCA
        // provider validates this on import, and an off-curve point can leak
        // information about the private key through the agreement result.
        val point = (publicKey as java.security.interfaces.ECPublicKey).w
        val params = publicKey.params
        val p = (params.curve.field as java.security.spec.ECFieldFp).p
        val a = params.curve.a
        val b = params.curve.b
        val x = point.affineX
        val y = point.affineY
        if (x < BigInteger.ZERO || x >= p || y < BigInteger.ZERO || y >= p) {
            throw DeviceKeysException("peer coordinates out of field range")
        }
        val left = y.modPow(BigInteger.TWO, p)
        val right = x.modPow(BigInteger.valueOf(3), p).add(a.multiply(x)).add(b).mod(p)
        if (left != right) throw DeviceKeysException("peer point is not on the curve")
        return publicKey
    }
}
