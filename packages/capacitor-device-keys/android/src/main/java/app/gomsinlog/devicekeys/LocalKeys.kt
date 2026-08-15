package app.gomsinlog.devicekeys

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Non-exportable AndroidKeyStore AES-GCM capability for local ciphertext. */
class LocalKeys {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun alias(binding: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(binding.toByteArray())
        return "gomsinlog.lck.v1." + Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }
    private fun key(binding: String, create: Boolean): SecretKey? {
        val name = alias(binding)
        if (store.containsAlias(name)) return (store.getEntry(name, null) as KeyStore.SecretKeyEntry).secretKey
        if (!create) return null
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) throw DeviceKeysException("Android local capability requires API 31+")
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false)
            .build())
        return generator.generateKey()
    }
    fun ensure(binding: String): Boolean { key(binding, true); return true }
    fun has(binding: String): Boolean = key(binding, false) != null
    fun seal(binding: String, plaintext: ByteArray, aad: ByteArray): Pair<ByteArray, ByteArray> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(binding, true)); cipher.updateAAD(aad)
        return cipher.iv to cipher.doFinal(plaintext)
    }
    fun open(binding: String, nonce: ByteArray, ciphertext: ByteArray, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(binding, false), GCMParameterSpec(128, nonce)); cipher.updateAAD(aad)
        return cipher.doFinal(ciphertext)
    }
    fun delete(binding: String) { val name = alias(binding); if (store.containsAlias(name)) store.deleteEntry(name) }
}
