import CryptoKit
import Foundation
import Security

/// AES-GCM capability backed by a ThisDeviceOnly Keychain generic-password item.
/// The symmetric key is never returned to the bridge.
final class LocalKeys {
    private let service = "app.gomsinlog.local-capability"

    private func key(tag: String, create: Bool) throws -> SymmetricKey? {
        let account = Data(tag.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data {
            return SymmetricKey(data: data)
        }
        guard create else { return nil }
        let raw = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: raw,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw DeviceKeysError.platform("local key create") }
        return SymmetricKey(data: raw)
    }

    func ensure(tag: String) throws -> Bool { _ = try key(tag: tag, create: true); return true }
    func has(tag: String) throws -> Bool { try key(tag: tag, create: false) != nil }

    func seal(tag: String, plaintext: Data, aad: Data) throws -> (nonce: Data, ciphertext: Data) {
        guard let key = try key(tag: tag, create: true) else { throw DeviceKeysError.notFound(tag) }
        let sealed = try AES.GCM.seal(plaintext, using: key, authenticating: aad)
        return (Data(sealed.nonce), sealed.ciphertext + sealed.tag)
    }

    func open(tag: String, nonce: Data, ciphertext: Data, aad: Data) throws -> Data {
        guard let key = try key(tag: tag, create: false), ciphertext.count >= 16 else { throw DeviceKeysError.notFound(tag) }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: Data(ciphertext.dropLast(16)), tag: Data(ciphertext.suffix(16)))
        return try AES.GCM.open(box, using: key, authenticating: aad)
    }

    func delete(tag: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: Data(tag.utf8)]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw DeviceKeysError.platform("local key delete") }
    }
}
