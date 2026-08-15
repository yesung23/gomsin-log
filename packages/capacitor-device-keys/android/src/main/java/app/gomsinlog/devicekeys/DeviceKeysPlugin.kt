package app.gomsinlog.devicekeys

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The Capacitor bridge for [DeviceKeys].
 *
 * This class is a TRANSLATION LAYER and nothing else. It validates what crosses
 * the JSON boundary, converts base64 to bytes and back, and delegates every
 * cryptographic decision to [DeviceKeys]. No key material is created, inspected
 * or cached here.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * There is no method that exports a private key, and there must never be one.
 * On AndroidKeyStore the private key physically cannot leave the hardware, so
 * such a method would be unimplementable; adding one to the bridge would be a
 * promise the platform cannot keep. The device-key surface below is operation-
 * by-handle; the separate LCK methods perform AES-GCM without exporting a key.
 *
 * LOGGING
 *
 * Nothing in this file logs. Not the handle, not the message, not the
 * signature, and above all not the shared secret from [deriveSecret] — that
 * value is the input to the envelope KEK, and a copy in logcat is a copy of the
 * scope key for anyone who can read it. Errors carry a bounded code and a short
 * message, never a payload.
 *
 * VERIFICATION STATUS
 *
 * **Nothing in this file has been executed against a real Android device or
 * emulator, and no Android SDK is available in this environment.** Plugin
 * registration, the Capacitor call lifecycle, AndroidKeyStore behaviour and
 * StrongBox/TEE detection are all
 * DEFERRED TO THE NATIVE INTEGRATION GATE.
 *
 * The assurance string returned here is whatever [DeviceKeys.getAssurance]
 * reads back from `KeyInfo`; this bridge never substitutes a stronger class,
 * and an unrecognised value degrades to the weakest one on the TypeScript side.
 */
@CapacitorPlugin(name = "GomsinlogDeviceKeys")
class DeviceKeysPlugin : Plugin() {

    private val keys = DeviceKeys()
    private val localKeys = LocalKeys()

    // -----------------------------------------------------------------------
    // Generation
    // -----------------------------------------------------------------------

    @PluginMethod
    fun generateKey(call: PluginCall) {
        val alias = call.requireAlias() ?: return
        val kind = when (call.getString("kind")) {
            "sign" -> KeyKind.SIGN
            "agree" -> KeyKind.AGREE
            else -> return call.reject("E_BAD_KIND", "kind must be \"sign\" or \"agree\"")
        }
        // Both default to false. A key invalidated by a biometric enrollment
        // change turns an ordinary device change into unrecoverable key loss.
        val requireUserPresence = call.getBoolean("requireUserPresence", false) ?: false
        val invalidateOnBiometricChange = call.getBoolean("invalidateOnBiometricChange", false) ?: false

        runBounded(call) {
            val (handle, spki, assurance) = keys.generateKey(
                alias, kind, requireUserPresence, invalidateOnBiometricChange,
            )
            JSObject().apply {
                put("handle", handle)
                put("publicKeySpki", encode(spki))
                put("assurance", assurance)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Operations
    // -----------------------------------------------------------------------

    @PluginMethod
    fun getPublicKey(call: PluginCall) {
        val handle = call.requireHandle() ?: return
        runBounded(call) {
            JSObject().put("publicKeySpki", encode(keys.getPublicKey(handle)))
        }
    }

    @PluginMethod
    fun sign(call: PluginCall) {
        val handle = call.requireHandle() ?: return
        val message = call.requireBytes("message") ?: return
        if (message.isEmpty()) return call.reject("E_BAD_MESSAGE", "message must not be empty")

        runBounded(call) {
            JSObject().apply {
                put("signature", encode(keys.sign(handle, message)))
                // JCA emits X9.62 DER. Declared rather than inferred: a 64-byte
                // DER signature is not always distinguishable from P-1363, and
                // guessing wrong produces an untraceable verification failure.
                put("encoding", "der")
            }
        }
    }

    @PluginMethod
    fun deriveSecret(call: PluginCall) {
        val handle = call.requireHandle() ?: return
        val peer = call.requireBytes("peerPublicKeySpki") ?: return
        // A P-256 SPKI is exactly 91 bytes. Anything else is not a peer key, and
        // handing it to the platform would turn a caller mistake into an
        // unpredictable provider error.
        if (peer.size != SPKI_P256_BYTES) {
            return call.reject("E_BAD_PEER_KEY", "peer public key must be a 91-byte P-256 SPKI")
        }

        runBounded(call) {
            // The result is the raw ECDH X coordinate. It is returned because
            // the protocol needs it, and it is never logged anywhere.
            JSObject().put("secret", encode(keys.deriveSecret(handle, peer)))
        }
    }

    @PluginMethod
    fun deleteKey(call: PluginCall) {
        val handle = call.requireHandle() ?: return
        runBounded(call) {
            keys.deleteKey(handle)
            JSObject()
        }
    }

    @PluginMethod
    fun getAssurance(call: PluginCall) {
        val handle = call.requireHandle() ?: return
        runBounded(call) {
            JSObject().put("assurance", keys.getAssurance(handle))
        }
    }

    @PluginMethod
    fun hasKey(call: PluginCall) {
        val alias = call.requireAlias() ?: return
        runBounded(call) {
            JSObject().put("present", keys.hasKey(alias))
        }
    }

    // -----------------------------------------------------------------------
    // LCK capability
    // -----------------------------------------------------------------------

    @PluginMethod
    fun lckEnsure(call: PluginCall) { val binding = call.localBinding() ?: return; runBounded(call) { JSObject().put("present", localKeys.ensure(binding)) } }
    @PluginMethod
    fun lckHas(call: PluginCall) { val binding = call.localBinding() ?: return; runBounded(call) { JSObject().put("present", localKeys.has(binding)) } }
    @PluginMethod
    fun lckSeal(call: PluginCall) {
        val binding = call.localBinding() ?: return; val plaintext = call.requireBytes("plaintext") ?: return; val aad = call.requireBytes("aad") ?: return
        runBounded(call) { val (nonce, ciphertext) = localKeys.seal(binding, plaintext, aad); JSObject().apply { put("nonce", encode(nonce)); put("ciphertext", encode(ciphertext)) } }
    }
    @PluginMethod
    fun lckOpen(call: PluginCall) {
        val binding = call.localBinding() ?: return; val nonce = call.requireBytes("nonce") ?: return; val ciphertext = call.requireBytes("ciphertext") ?: return; val aad = call.requireBytes("aad") ?: return
        runBounded(call) { JSObject().put("plaintext", encode(localKeys.open(binding, nonce, ciphertext, aad))) }
    }
    @PluginMethod
    fun lckDelete(call: PluginCall) { val binding = call.localBinding() ?: return; runBounded(call) { localKeys.delete(binding); JSObject() } }

    // -----------------------------------------------------------------------
    // Boundary helpers
    // -----------------------------------------------------------------------

    /**
     * Run a delegated operation and translate failures into a bounded rejection.
     *
     * Two error classes, and no third: [DeviceKeysException] is a rule this
     * package states, so its message is safe to pass on; anything else is a
     * platform failure whose message could carry arbitrary provider detail, so
     * only a fixed string crosses the boundary. Neither path can leak a key,
     * because no key is ever in scope here.
     */
    private inline fun runBounded(call: PluginCall, body: () -> JSObject) {
        try {
            call.resolve(body())
        } catch (e: DeviceKeysException) {
            call.reject("E_DEVICE_KEYS", e.message ?: "device key operation failed")
        } catch (_: Throwable) {
            call.reject("E_PLATFORM", "the platform key store rejected the operation")
        }
    }

    private fun PluginCall.requireHandle(): String? {
        val handle = getString("handle")
        if (handle.isNullOrEmpty()) {
            reject("E_BAD_HANDLE", "handle must be a non-empty string")
            return null
        }
        return handle
    }

    private fun PluginCall.requireAlias(): String? {
        val alias = getString("alias")
        if (alias.isNullOrEmpty()) {
            reject("E_BAD_ALIAS", "alias must be a non-empty string")
            return null
        }
        return alias
    }

    private fun PluginCall.requireBytes(name: String): ByteArray? {
        val encoded = getString(name)
        if (encoded.isNullOrEmpty()) {
            reject("E_BAD_INPUT", "$name must be a non-empty base64 string")
            return null
        }
        return try {
            Base64.decode(encoded, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            reject("E_BAD_INPUT", "$name is not valid base64")
            null
        }
    }

    private fun PluginCall.localBinding(): String? {
        val installation = getString("installationId")
        val user = getString("userId")
        val device = getString("deviceId")
        val purpose = getString("purpose")
        val version = getInt("version")
        if (installation.isNullOrEmpty() || user.isNullOrEmpty() || device.isNullOrEmpty() || purpose.isNullOrEmpty() || version == null) {
            reject("E_BAD_LOCAL_BINDING", "local capability binding is incomplete")
            return null
        }
        return "v$version|$installation|$user|$device|$purpose"
    }

    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private companion object {
        const val SPKI_P256_BYTES = 91
    }
}
