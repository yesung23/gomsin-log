import Foundation
import Capacitor

/// The Capacitor bridge for `DeviceKeys`.
///
/// This class is a TRANSLATION LAYER and nothing else. It validates what
/// crosses the JSON boundary, converts base64 to `Data` and back, and delegates
/// every cryptographic decision to `DeviceKeys`. No key material is created,
/// inspected or cached here.
///
/// ## What is deliberately absent
///
/// There is no method that exports a private key, and there must never be one.
/// A Secure Enclave key physically cannot leave the SEP — the Phase 1A-1 spike
/// confirmed the token itself refuses with `errSecUnimplemented` — so such a
/// method would be a promise the platform cannot keep. The surface below is
/// exactly the device-key operations plus the five LCK capability operations;
/// all secret operations remain native and operation-by-handle.
///
/// ## Logging
///
/// Nothing here logs. Not the handle, not the message, not the signature, and
/// above all not the shared secret from `deriveSecret`: that value is the input
/// to the envelope KEK, so a copy in the device console is a copy of the scope
/// key for anyone who can read it. Errors carry a bounded code and a short
/// message, never a payload.
///
/// ## Registration
///
/// `CAPBridgedPlugin` is the Swift-only registration path Capacitor 7 uses, so
/// there is no Objective-C `.m` macro file. `jsName` must match the name
/// `registerPlugin<DeviceKeysPlugin>('GomsinlogDeviceKeys')` uses on the
/// TypeScript side, and each `pluginMethod` name must match a `@objc` selector
/// below — a mismatch fails only at runtime, which is why the structural test
/// in `src/lib/nativeDeviceKeysBridge.test.ts` compares the three lists.
///
/// ## Verification status
///
/// Secure Enclave P-256 signing, key agreement and non-exportability were
/// VERIFIED on real Apple Secure Enclave hardware in Phase 1A-1, through the
/// same Security.framework surface iOS uses. This BRIDGE, the Capacitor call
/// lifecycle, iOS entitlements and app lifecycle (restart, biometric change,
/// reinstall, backup restore) are **DEFERRED TO THE NATIVE INTEGRATION GATE**
/// and have never been built or executed here.
@objc(GomsinlogDeviceKeysPlugin)
public class GomsinlogDeviceKeysPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GomsinlogDeviceKeysPlugin"
    public let jsName = "GomsinlogDeviceKeys"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "generateKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPublicKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sign", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deriveSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAssurance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lckEnsure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lckHas", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lckSeal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lckOpen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lckDelete", returnType: CAPPluginReturnPromise),
    ]

    private let keys = DeviceKeys()
    private let localKeys = LocalKeys()

    /// A P-256 SubjectPublicKeyInfo is exactly this wide.
    private static let spkiP256Bytes = 91

    // MARK: - Generation

    @objc func generateKey(_ call: CAPPluginCall) {
        guard let alias = requireAlias(call) else { return }
        guard let kindText = call.getString("kind"),
              let kind = DeviceKeys.KeyKind(rawValue: kindText) else {
            call.reject("kind must be \"sign\" or \"agree\"", "E_BAD_KIND")
            return
        }
        // Both default to false. A key invalidated by a biometric enrollment
        // change turns an ordinary device change into unrecoverable key loss.
        let requireUserPresence = call.getBool("requireUserPresence", false)
        let invalidateOnBiometricChange = call.getBool("invalidateOnBiometricChange", false)

        runBounded(call) {
            let result = try self.keys.generateKey(
                alias: alias,
                kind: kind,
                requireUserPresence: requireUserPresence,
                invalidateOnBiometricChange: invalidateOnBiometricChange
            )
            guard result.publicKeySpki.count == Self.spkiP256Bytes else {
                throw DeviceKeysError.platform("public key is not a P-256 SPKI")
            }
            return [
                "handle": result.handle,
                "publicKeySpki": result.publicKeySpki.base64EncodedString(),
                "assurance": result.assurance,
            ]
        }
    }

    // MARK: - Operations

    @objc func getPublicKey(_ call: CAPPluginCall) {
        guard let handle = requireHandle(call) else { return }
        runBounded(call) {
            let spki = try self.keys.getPublicKey(handle: handle)
            guard spki.count == Self.spkiP256Bytes else {
                throw DeviceKeysError.platform("public key is not a P-256 SPKI")
            }
            return ["publicKeySpki": spki.base64EncodedString()]
        }
    }

    @objc func sign(_ call: CAPPluginCall) {
        guard let handle = requireHandle(call) else { return }
        guard let message = requireBytes(call, "message"), !message.isEmpty else { return }

        runBounded(call) {
            let signature = try self.keys.sign(handle: handle, message: message)
            return [
                "signature": signature.base64EncodedString(),
                // Security.framework emits X9.62 DER. Declared rather than
                // inferred: a 64-byte DER signature is not always
                // distinguishable from P-1363, and guessing wrong produces an
                // untraceable verification failure.
                "encoding": "der",
            ]
        }
    }

    @objc func deriveSecret(_ call: CAPPluginCall) {
        guard let handle = requireHandle(call) else { return }
        guard let peer = requireBytes(call, "peerPublicKeySpki") else { return }
        // Anything other than a 91-byte P-256 SPKI is not a peer key; handing it
        // to the platform would turn a caller mistake into an opaque error.
        guard peer.count == Self.spkiP256Bytes else {
            call.reject("peer public key must be a 91-byte P-256 SPKI", "E_BAD_PEER_KEY")
            return
        }

        runBounded(call) {
            // The raw ECDH X coordinate. Returned because the protocol needs it,
            // and never written to a log anywhere on this path.
            let secret = try self.keys.deriveSecret(handle: handle, peerPublicKeySpki: peer)
            guard secret.count == 32 else {
                throw DeviceKeysError.platform("shared secret is not 32 bytes")
            }
            return ["secret": secret.base64EncodedString()]
        }
    }

    @objc func deleteKey(_ call: CAPPluginCall) {
        guard let handle = requireHandle(call) else { return }
        runBounded(call) {
            try self.keys.deleteKey(handle: handle)
            return [:]
        }
    }

    @objc func getAssurance(_ call: CAPPluginCall) {
        guard let handle = requireHandle(call) else { return }
        runBounded(call) {
            ["assurance": try self.keys.getAssurance(handle: handle)]
        }
    }

    @objc func hasKey(_ call: CAPPluginCall) {
        guard let alias = requireAlias(call) else { return }
        runBounded(call) {
            ["present": try self.keys.hasKey(alias: alias)]
        }
    }

    // MARK: - LCK capability

    @objc func lckEnsure(_ call: CAPPluginCall) { guard let tag = localTag(call) else { return }; runBounded(call) { [self] in ["present": try localKeys.ensure(tag: tag)] } }
    @objc func lckHas(_ call: CAPPluginCall) { guard let tag = localTag(call) else { return }; runBounded(call) { [self] in ["present": try localKeys.has(tag: tag)] } }
    @objc func lckSeal(_ call: CAPPluginCall) {
        guard let tag = localTag(call), let plaintext = requireBytes(call, "plaintext"), let aad = requireBytes(call, "aad") else { return }
        runBounded(call) { [self] in let sealed = try localKeys.seal(tag: tag, plaintext: plaintext, aad: aad); return ["nonce": sealed.nonce.base64EncodedString(), "ciphertext": sealed.ciphertext.base64EncodedString()] }
    }
    @objc func lckOpen(_ call: CAPPluginCall) {
        guard let tag = localTag(call), let nonce = requireBytes(call, "nonce"), let ciphertext = requireBytes(call, "ciphertext"), let aad = requireBytes(call, "aad") else { return }
        runBounded(call) { [self] in ["plaintext": try localKeys.open(tag: tag, nonce: nonce, ciphertext: ciphertext, aad: aad).base64EncodedString()] }
    }
    @objc func lckDelete(_ call: CAPPluginCall) { guard let tag = localTag(call) else { return }; runBounded(call) { [self] in try localKeys.delete(tag: tag); return [:] } }

    // MARK: - Boundary helpers

    /// Run a delegated operation and translate failures into a bounded rejection.
    ///
    /// `DeviceKeysError` is a rule this package states, so its description is
    /// safe to pass on. Anything else is a platform failure whose text could
    /// carry arbitrary detail, so only a fixed string crosses the boundary.
    /// Neither path can leak a key, because no key is ever in scope here.
    private func runBounded(_ call: CAPPluginCall, _ body: () throws -> [String: Any]) {
        do {
            call.resolve(try body())
        } catch let error as DeviceKeysError {
            call.reject(Self.describe(error), "E_DEVICE_KEYS")
        } catch {
            call.reject("the platform key store rejected the operation", "E_PLATFORM")
        }
    }

    private static func describe(_ error: DeviceKeysError) -> String {
        switch error {
        case .unsupported(let what): return "unsupported: \(what)"
        case .notFound(let what): return "not found: \(what)"
        case .invalidInput(let what): return "invalid input: \(what)"
        case .platform(let what): return "platform: \(what)"
        }
    }

    private func requireHandle(_ call: CAPPluginCall) -> String? {
        guard let handle = call.getString("handle"), !handle.isEmpty else {
            call.reject("handle must be a non-empty string", "E_BAD_HANDLE")
            return nil
        }
        return handle
    }

    private func requireAlias(_ call: CAPPluginCall) -> String? {
        guard let alias = call.getString("alias"), !alias.isEmpty else {
            call.reject("alias must be a non-empty string", "E_BAD_ALIAS")
            return nil
        }
        return alias
    }

    private func requireBytes(_ call: CAPPluginCall, _ name: String) -> Data? {
        guard let encoded = call.getString(name), !encoded.isEmpty else {
            call.reject("\(name) must be a non-empty base64 string", "E_BAD_INPUT")
            return nil
        }
        guard let bytes = Data(base64Encoded: encoded) else {
            call.reject("\(name) is not valid base64", "E_BAD_INPUT")
            return nil
        }
        return bytes
    }

    private func localTag(_ call: CAPPluginCall) -> String? {
        guard let installation = call.getString("installationId"),
              let user = call.getString("userId"),
              let device = call.getString("deviceId"),
              let purpose = call.getString("purpose"),
              let version = call.getInt("version") else {
            call.reject("local capability binding is incomplete", "E_BAD_LOCAL_BINDING")
            return nil
        }
        return "v\(version)|\(installation)|\(user)|\(device)|\(purpose)"
    }
}
