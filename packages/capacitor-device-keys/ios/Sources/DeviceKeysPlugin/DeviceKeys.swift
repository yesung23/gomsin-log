import Foundation
import Security
import CryptoKit

/// Operation-by-handle P-256 device keys backed by the Secure Enclave.
///
/// The API surface used here — `SecKeyCreateRandomKey` with
/// `kSecAttrTokenIDSecureEnclave`, `SecKeyCreateSignature`, and
/// `SecKeyCopyKeyExchangeResult` — was exercised on real Apple Secure Enclave
/// hardware during the Phase 1A-1 spike, including the key-agreement path that
/// the architecture had flagged as its highest-risk unknown. Private key export
/// was refused by the token itself (`errSecUnimplemented`, "export not
/// implemented for key com.apple.setoken").
///
/// What remains unverified and is DEFERRED TO THE NATIVE INTEGRATION GATE: iOS
/// app lifecycle (restart, force quit, biometric enrollment change, reinstall,
/// backup restore) and the entitlement requirements for a real iOS app. The
/// spike ran on macOS, which shares the framework and the SEP but not the OS.
///
/// Wire contract with TypeScript:
///   public keys  SPKI DER, base64
///   signatures   DER here; the bridge is told `encoding: "der"` and converts
///   ECDH         exactly 32 bytes, left-zero-padded
///   private keys never cross the boundary
enum DeviceKeysError: Error {
    case unsupported(String)
    case notFound(String)
    case invalidInput(String)
    case platform(String)
}

/// The constant 26-byte DER prefix of a P-256 SubjectPublicKeyInfo.
///
/// Security.framework returns a bare SEC1 point, so the SPKI is assembled here.
/// The prefix was confirmed byte-identical against WebCrypto and JCA in 1A-1,
/// which is why one encoder serves every platform and fingerprints match.
private let p256SpkiPrefix: [UInt8] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]

public final class DeviceKeys {

    public enum KeyKind: String { case sign, agree }

    // MARK: - Generation

    public func generateKey(
        alias: String,
        kind: KeyKind,
        requireUserPresence: Bool,
        invalidateOnBiometricChange: Bool
    ) throws -> (handle: String, publicKeySpki: Data, assurance: String) {
        guard !alias.isEmpty else { throw DeviceKeysError.invalidInput("alias") }
        if try hasKey(alias: alias) { throw DeviceKeysError.invalidInput("alias already exists") }

        // Defaults are permissive on purpose. A key invalidated by a biometric
        // enrollment change turns an ordinary device change into unrecoverable
        // key loss, which is a data-loss path, not a security win.
        var flags: SecAccessControlCreateFlags = [.privateKeyUsage]
        if requireUserPresence { flags.insert(.userPresence) }
        if invalidateOnBiometricChange { flags.insert(.biometryCurrentSet) }

        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            flags,
            &accessError
        ) else {
            throw DeviceKeysError.platform("access control: \(String(describing: accessError))")
        }

        var privateAttrs: [String: Any] = [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tag(for: alias),
            kSecAttrAccessControl as String: access,
        ]
        if kind == .agree { privateAttrs[kSecAttrCanDerive as String] = true }

        var attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: privateAttrs,
        ]

        // Try the Secure Enclave first; fall back to a software Keychain key and
        // report that honestly rather than claiming hardware backing.
        attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        var error: Unmanaged<CFError>?
        var assurance = "secure_enclave"
        var key = SecKeyCreateRandomKey(attributes as CFDictionary, &error)

        if key == nil {
            attributes.removeValue(forKey: kSecAttrTokenID as String)
            error = nil
            assurance = "software_keystore"
            key = SecKeyCreateRandomKey(attributes as CFDictionary, &error)
        }

        guard let privateKey = key else {
            throw DeviceKeysError.platform("key generation: \(String(describing: error))")
        }

        return (alias, try publicSpki(for: privateKey), assurance)
    }

    // MARK: - Operations

    public func getPublicKey(handle: String) throws -> Data {
        try publicSpki(for: try load(handle))
    }

    /// Returns an X9.62 DER signature. The TypeScript bridge converts to P-1363.
    public func sign(handle: String, message: Data) throws -> Data {
        let key = try load(handle)
        guard SecKeyIsAlgorithmSupported(key, .sign, .ecdsaSignatureMessageX962SHA256) else {
            throw DeviceKeysError.unsupported("ecdsaSignatureMessageX962SHA256")
        }
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            key, .ecdsaSignatureMessageX962SHA256, message as CFData, &error
        ) as Data? else {
            throw DeviceKeysError.platform("sign: \(String(describing: error))")
        }
        return signature
    }

    /// Returns exactly 32 bytes: the big-endian X coordinate, left-zero-padded.
    ///
    /// Security.framework was measured to return the full field width already,
    /// including a leading zero. The padding is kept because a provider that
    /// stripped it would derive a different KEK on roughly one envelope in 256
    /// — a failure that shows up only intermittently and nowhere else.
    public func deriveSecret(handle: String, peerPublicKeySpki: Data) throws -> Data {
        let key = try load(handle)
        guard SecKeyIsAlgorithmSupported(key, .keyExchange, .ecdhKeyExchangeStandard) else {
            throw DeviceKeysError.unsupported("ecdhKeyExchangeStandard")
        }
        let peer = try importPeer(spki: peerPublicKeySpki)

        var error: Unmanaged<CFError>?
        guard let raw = SecKeyCopyKeyExchangeResult(
            key, .ecdhKeyExchangeStandard, peer, [String: Any]() as CFDictionary, &error
        ) as Data? else {
            throw DeviceKeysError.platform("deriveSecret: \(String(describing: error))")
        }
        guard raw.count <= 32 else { throw DeviceKeysError.platform("shared secret is \(raw.count) bytes") }
        if raw.count == 32 { return raw }
        return Data(repeating: 0, count: 32 - raw.count) + raw
    }

    public func deleteKey(handle: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag(for: handle),
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DeviceKeysError.platform("delete: \(status)")
        }
    }

    public func getAssurance(handle: String) throws -> String {
        let key = try load(handle)
        guard let attributes = SecKeyCopyAttributes(key) as? [String: Any] else {
            return "software_keystore"
        }
        let token = attributes[kSecAttrTokenID as String] as? String
        return token == (kSecAttrTokenIDSecureEnclave as String) ? "secure_enclave" : "software_keystore"
    }

    public func hasKey(alias: String) throws -> Bool {
        (try? load(alias)) != nil
    }

    // MARK: - Internals

    private func tag(for alias: String) -> Data {
        Data("app.gomsinlog.devicekeys.\(alias)".utf8)
    }

    private func load(_ handle: String) throws -> SecKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag(for: handle),
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        // Fail closed: an unknown handle must never fall through to a fresh key,
        // which would silently orphan every envelope addressed to the old one.
        guard status == errSecSuccess, let key = item else {
            throw DeviceKeysError.notFound(handle)
        }
        return (key as! SecKey)
    }

    private func publicSpki(for privateKey: SecKey) throws -> Data {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw DeviceKeysError.platform("no public key")
        }
        var error: Unmanaged<CFError>?
        guard let point = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw DeviceKeysError.platform("public key export: \(String(describing: error))")
        }
        guard point.count == 65, point.first == 0x04 else {
            throw DeviceKeysError.platform("unexpected public point encoding")
        }
        return Data(p256SpkiPrefix) + point
    }

    private func importPeer(spki: Data) throws -> SecKey {
        guard spki.count == 91 else { throw DeviceKeysError.invalidInput("peer SPKI length") }
        guard Array(spki.prefix(26)) == p256SpkiPrefix else {
            throw DeviceKeysError.invalidInput("peer key is not P-256 SPKI")
        }
        let point = spki.suffix(65)
        guard point.first == 0x04 else { throw DeviceKeysError.invalidInput("peer point not uncompressed") }
        // Reject the identity element. P-256 has cofactor 1, so on-curve plus
        // not-infinity is the complete check; SecKeyCreateWithData does the rest.
        guard point.dropFirst().contains(where: { $0 != 0 }) else {
            throw DeviceKeysError.invalidInput("peer point is the identity")
        }

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrCanDerive as String: true,
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(Data(point) as CFData, attributes as CFDictionary, &error) else {
            throw DeviceKeysError.invalidInput("peer key is not a valid P-256 point")
        }
        return key
    }
}
