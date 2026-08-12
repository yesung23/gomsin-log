// SPIKE ONLY — Apple Security.framework / CryptoKit probe.
//
// Runs on macOS (Apple M1, real Secure Enclave). This is NOT an iOS result:
// it exercises the SAME Security.framework and CryptoKit API surface that iOS
// uses, on the same SEP hardware family, but under a different OS and a
// different entitlement model. Every claim below must be repeated on an actual
// iOS device before it counts as an iOS result.
//
// Consumes the frozen vectors. All keys are TEST ONLY throwaway material.
//
//   swiftc -O -framework Security -framework CryptoKit SecKeyProbe.swift -o secprobe
//   ./secprobe <path-to-seckey-vectors.json>

import Foundation
import Security
import CryptoKit

// MARK: - small helpers

func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
func unhex(_ s: String) -> Data {
    var out = Data(); var i = s.startIndex
    while i < s.endIndex {
        let j = s.index(i, offsetBy: 2)
        out.append(UInt8(s[i..<j], radix: 16)!)
        i = j
    }
    return out
}

struct Result: Encodable {
    let name: String
    let status: String
    let detail: String
}
var results: [Result] = []
func record(_ name: String, _ status: String, _ detail: String) {
    results.append(Result(name: name, status: status, detail: detail))
    FileHandle.standardError.write("[\(status)] \(name): \(detail)\n".data(using: .utf8)!)
}

/// P-1363 r||s -> X9.62 DER, which is what Security.framework consumes.
func p1363ToDer(_ sig: Data) -> Data {
    func derInt(_ raw: Data) -> Data {
        var b = Array(raw)
        while b.count > 1 && b[0] == 0 { b.removeFirst() }
        if b[0] & 0x80 != 0 { b.insert(0, at: 0) }
        return Data([0x02, UInt8(b.count)] + b)
    }
    let body = derInt(sig.prefix(32)) + derInt(sig.suffix(32))
    return Data([0x30, UInt8(body.count)]) + body
}

/// X9.62 DER -> P-1363 r||s (minimal; the strict decoder lives in TypeScript).
func derToP1363(_ der: Data) -> Data? {
    let b = Array(der)
    guard b.count > 8, b[0] == 0x30, Int(b[1]) + 2 == b.count else { return nil }
    var i = 2
    func readInt() -> Data? {
        guard i + 2 <= b.count, b[i] == 0x02 else { return nil }
        let len = Int(b[i + 1]); i += 2
        guard i + len <= b.count else { return nil }
        var v = Array(b[i..<(i + len)]); i += len
        while v.count > 32 && v.first == 0 { v.removeFirst() }
        while v.count < 32 { v.insert(0, at: 0) }
        return Data(v)
    }
    guard let r = readInt(), let s = readInt(), i == b.count else { return nil }
    return r + s
}

/// The constant 26-byte DER prefix of a P-256 SubjectPublicKeyInfo.
let P256_SPKI_PREFIX = unhex("3059301306072a8648ce3d020106082a8648ce3d030107034200")

func secKey(fromRaw raw: Data, isPrivate: Bool, canDerive: Bool) -> SecKey? {
    let attrs: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeyClass as String: (isPrivate ? kSecAttrKeyClassPrivate : kSecAttrKeyClassPublic),
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrCanDerive as String: canDerive,
    ]
    var err: Unmanaged<CFError>?
    return SecKeyCreateWithData(raw as CFData, attrs as CFDictionary, &err)
}

// MARK: - load vectors

let vectorPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "seckey-vectors.json"
guard let vdata = FileManager.default.contents(atPath: vectorPath),
      let V = try? JSONSerialization.jsonObject(with: vdata) as? [String: Any] else {
    FileHandle.standardError.write("cannot read \(vectorPath)\n".data(using: .utf8)!)
    exit(2)
}
func sect(_ k: String) -> [String: Any] { V[k] as! [String: Any] }
func str(_ d: [String: Any], _ k: String) -> String { d[k] as! String }

record("environment", "INFO", "macOS \(ProcessInfo.processInfo.operatingSystemVersionString), arch arm64")

// MARK: - 1. Software SecKey: ECDH against the frozen vectors

for (label, key) in [("normal", "ecdhNormal"), ("leadingZero", "ecdhLeadingZero")] {
    let v = sect(key)
    guard let priv = secKey(fromRaw: unhex(str(v, "secKeyPrivateHex")), isPrivate: true, canDerive: true),
          let peer = secKey(fromRaw: unhex(str(v, "peerPublicRawHex")), isPrivate: false, canDerive: true) else {
        record("softwareSecKey.ecdh.\(label)", "FAILED", "key import failed")
        continue
    }
    var err: Unmanaged<CFError>?
    guard let shared = SecKeyCopyKeyExchangeResult(
        priv, .ecdhKeyExchangeStandard, peer, [String: Any]() as CFDictionary, &err
    ) as Data? else {
        record("softwareSecKey.ecdh.\(label)", "FAILED", "\(err!.takeRetainedValue())")
        continue
    }
    let expected = str(v, "expectedSharedSecretHex")
    let match = hex(shared) == expected
    record(
        "softwareSecKey.ecdh.\(label)",
        match ? "VERIFIED" : "FAILED",
        "len=\(shared.count) match=\(match) first=0x\(String(format: "%02x", shared.first ?? 0))"
    )
    if label == "leadingZero" {
        record(
            "softwareSecKey.ecdh.leadingZero.width",
            shared.count == 32 ? "VERIFIED" : "SUPPORTED WITH LIMITATIONS",
            shared.count == 32
                ? "Security.framework returned the full 32 bytes including the leading 0x00; no left-padding needed on this path."
                : "Security.framework returned \(shared.count) bytes; the plugin MUST left-zero-pad to 32."
        )
    }
}

// MARK: - 2. Software SecKey: public key serialization

do {
    let v = sect("ecdhNormal")
    if let priv = secKey(fromRaw: unhex(str(v, "secKeyPrivateHex")), isPrivate: true, canDerive: true),
       let pub = SecKeyCopyPublicKey(priv) {
        var err: Unmanaged<CFError>?
        if let raw = SecKeyCopyExternalRepresentation(pub, &err) as Data? {
            let expectedRaw = str(v, "peerPublicRawHex") // not this key; compare shape only
            let spki = P256_SPKI_PREFIX + raw
            let fp = SHA256.hash(data: spki)
            record(
                "softwareSecKey.publicKeyExport",
                raw.count == 65 && raw.first == 0x04 ? "VERIFIED" : "FAILED",
                "SecKeyCopyExternalRepresentation returns SEC1 uncompressed \(raw.count) bytes (0x\(String(format: "%02x", raw.first ?? 0))), NOT SPKI. SPKI = 26-byte constant prefix + point => \(spki.count) bytes, sha256=\(hex(Data(fp)).prefix(16)). expectedShapeRef=\(expectedRaw.count / 2)B"
            )
        }
    }
}

// Cross-check the prefix rule against a frozen SPKI.
do {
    let v = sect("ecdhNormal")
    let spki = unhex(str(v, "peerPublicSpkiHex"))
    let raw = unhex(str(v, "peerPublicRawHex"))
    let rebuilt = P256_SPKI_PREFIX + raw
    record(
        "spkiPrefixRule",
        rebuilt == spki ? "VERIFIED" : "FAILED",
        "P-256 SPKI == constant 26-byte prefix || SEC1 point. Lets one encoder serve Apple raw keys and Web SPKI."
    )
}

// MARK: - 3. Software SecKey: ECDSA both directions

do {
    let v = sect("ecdsaVerify")
    guard let pub = secKey(fromRaw: unhex(str(v, "signerRawHex")), isPrivate: false, canDerive: false) else {
        record("softwareSecKey.ecdsa.webToApple", "FAILED", "public key import failed")
        exit(0)
    }
    let msg = str(v, "messageUtf8").data(using: .utf8)!
    let der = p1363ToDer(unhex(str(v, "signatureP1363Hex")))
    var err: Unmanaged<CFError>?
    let ok = SecKeyVerifySignature(pub, .ecdsaSignatureMessageX962SHA256, msg as CFData, der as CFData, &err)
    record(
        "softwareSecKey.ecdsa.webToApple",
        ok ? "VERIFIED" : "FAILED",
        "WebCrypto P-1363 signature, converted to DER, verified by Security.framework: \(ok)"
    )
}

do {
    // Apple signs; emit for Node/Web to verify.
    var err: Unmanaged<CFError>?
    let attrs: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
    ]
    if let priv = SecKeyCreateRandomKey(attrs as CFDictionary, &err),
       let pub = SecKeyCopyPublicKey(priv),
       let rawPub = SecKeyCopyExternalRepresentation(pub, &err) as Data? {
        let msg = "gomsinlog/1a1/apple-signs".data(using: .utf8)!
        if let sig = SecKeyCreateSignature(priv, .ecdsaSignatureMessageX962SHA256, msg as CFData, &err) as Data? {
            let isDer = sig.first == 0x30
            let p1363 = derToP1363(sig)
            record(
                "softwareSecKey.ecdsa.nativeEncoding",
                isDer ? "VERIFIED" : "FAILED",
                "Security.framework emits X9.62 DER (\(sig.count) bytes, first byte 0x\(String(format: "%02x", sig.first ?? 0))), NOT P-1363. Conversion is mandatory."
            )
            record(
                "softwareSecKey.ecdsa.appleToWeb.export",
                p1363 != nil ? "INFO" : "FAILED",
                "publicSpki=\(hex(P256_SPKI_PREFIX + rawPub)) message=gomsinlog/1a1/apple-signs sigP1363=\(p1363.map(hex) ?? "nil")"
            )
        }
    }
}

// MARK: - 4. AES-GCM and HKDF vectors on Apple's stack (CryptoKit)

do {
    let v = sect("aesGcm")
    let key = SymmetricKey(data: unhex(str(v, "keyHex")))
    let nonce = try! AES.GCM.Nonce(data: unhex(str(v, "nonceHex")))
    let pt = unhex(str(v, "plaintextHex"))
    let aad = str(v, "aadUtf8").data(using: .utf8)!
    let sealed = try! AES.GCM.seal(pt, using: key, nonce: nonce, authenticating: aad)
    let combined = sealed.ciphertext + sealed.tag
    let expected = str(v, "ciphertextWithTagHex")
    record(
        "cryptoKit.aesGcm",
        hex(combined) == expected ? "VERIFIED" : "FAILED",
        "CryptoKit exposes ciphertext and tag separately; ciphertext||tag matches the WebCrypto vector: \(hex(combined) == expected)"
    )
}

do {
    let v = sect("hkdf")
    let okm = HKDF<SHA256>.deriveKey(
        inputKeyMaterial: SymmetricKey(data: unhex(str(v, "ikmHex"))),
        salt: unhex(str(v, "saltHex")),
        info: str(v, "infoUtf8").data(using: .utf8)!,
        outputByteCount: v["lengthBytes"] as! Int
    )
    let got = okm.withUnsafeBytes { Data($0) }
    record(
        "cryptoKit.hkdf",
        hex(got) == str(v, "okmHex") ? "VERIFIED" : "FAILED",
        "HKDF-SHA256 matches the WebCrypto vector: \(hex(got) == str(v, "okmHex"))"
    )
}

// MARK: - 5. Secure Enclave via Security.framework

do {
    var acErr: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
        nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage], &acErr
    ) else {
        record("secureEnclave.accessControl", "FAILED", "\(acErr!.takeRetainedValue())")
        exit(0)
    }

    for (label, canDerive) in [("signing", false), ("agreement", true)] {
        var privAttrs: [String: Any] = [
            kSecAttrIsPermanent as String: false,
            kSecAttrAccessControl as String: access,
        ]
        if canDerive { privAttrs[kSecAttrCanDerive as String] = true }
        let attrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: privAttrs,
        ]
        var err: Unmanaged<CFError>?
        guard let priv = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else {
            let e = err!.takeRetainedValue()
            record("secureEnclave.\(label).create", "UNSUPPORTED", "SecKeyCreateRandomKey failed: \(e)")
            continue
        }
        record("secureEnclave.\(label).create", "VERIFIED", "Secure Enclave P-256 key created")

        // Non-exportability.
        var expErr: Unmanaged<CFError>?
        let exported = SecKeyCopyExternalRepresentation(priv, &expErr) as Data?
        record(
            "secureEnclave.\(label).privateKeyExport",
            exported == nil ? "VERIFIED" : "FAILED",
            exported == nil
                ? "refused: \(expErr.map { "\($0.takeRetainedValue())" } ?? "nil")"
                : "EXPORTED \(exported!.count) BYTES (BAD)"
        )

        // Public key retrieval.
        if let pub = SecKeyCopyPublicKey(priv) {
            var pErr: Unmanaged<CFError>?
            if let raw = SecKeyCopyExternalRepresentation(pub, &pErr) as Data? {
                record(
                    "secureEnclave.\(label).publicKey",
                    raw.count == 65 && raw.first == 0x04 ? "VERIFIED" : "FAILED",
                    "SEC1 uncompressed \(raw.count) bytes"
                )
            }
        }

        if canDerive {
            // THE highest-risk question: can a Secure Enclave key do ECDH?
            let supported = SecKeyIsAlgorithmSupported(priv, .keyExchange, .ecdhKeyExchangeStandard)
            record("secureEnclave.agreement.algorithmSupported", supported ? "VERIFIED" : "UNSUPPORTED",
                   "SecKeyIsAlgorithmSupported(.ecdhKeyExchangeStandard) = \(supported)")

            let peerRaw = unhex(str(sect("ecdhNormal"), "peerPublicRawHex"))
            if let peer = secKey(fromRaw: peerRaw, isPrivate: false, canDerive: true) {
                var kErr: Unmanaged<CFError>?
                if let shared = SecKeyCopyKeyExchangeResult(
                    priv, .ecdhKeyExchangeStandard, peer, [String: Any]() as CFDictionary, &kErr
                ) as Data? {
                    record(
                        "secureEnclave.agreement.performed",
                        shared.count == 32 ? "VERIFIED" : "SUPPORTED WITH LIMITATIONS",
                        "SecKeyCopyKeyExchangeResult returned \(shared.count) bytes from a Secure-Enclave-backed key"
                    )
                    // Correctness cross-check: emit the SE public key and a DIGEST of the
                    // shared secret (never the secret itself). Node recomputes the same
                    // agreement from the other side and must produce the same digest.
                    if let sePub = SecKeyCopyPublicKey(priv),
                       let sePubRaw = SecKeyCopyExternalRepresentation(sePub, nil) as Data? {
                        record(
                            "secureEnclave.agreement.crossCheckInput",
                            "INFO",
                            "sePublicRaw=\(hex(sePubRaw)) sharedSecretSha256=\(hex(Data(SHA256.hash(data: shared))))"
                        )
                    }
                } else {
                    record("secureEnclave.agreement.performed", "UNSUPPORTED",
                           "SecKeyCopyKeyExchangeResult failed: \(kErr.map { "\($0.takeRetainedValue())" } ?? "nil")")
                }
            }
        } else {
            let supported = SecKeyIsAlgorithmSupported(priv, .sign, .ecdsaSignatureMessageX962SHA256)
            record("secureEnclave.signing.algorithmSupported", supported ? "VERIFIED" : "UNSUPPORTED",
                   "SecKeyIsAlgorithmSupported(.ecdsaSignatureMessageX962SHA256) = \(supported)")
            var sErr: Unmanaged<CFError>?
            let msg = "gomsinlog/1a1/se-sign".data(using: .utf8)!
            if let sig = SecKeyCreateSignature(priv, .ecdsaSignatureMessageX962SHA256, msg as CFData, &sErr) as Data?,
               let pub = SecKeyCopyPublicKey(priv) {
                let ok = SecKeyVerifySignature(pub, .ecdsaSignatureMessageX962SHA256, msg as CFData, sig as CFData, nil)
                record("secureEnclave.signing.performed", ok ? "VERIFIED" : "FAILED",
                       "signed and verified; DER \(sig.count) bytes, first 0x\(String(format: "%02x", sig.first ?? 0))")
            } else {
                record("secureEnclave.signing.performed", "UNSUPPORTED",
                       "\(sErr.map { "\($0.takeRetainedValue())" } ?? "nil")")
            }
        }
    }
}

// MARK: - 6. Secure Enclave via CryptoKit

record("cryptoKit.secureEnclave.isAvailable", SecureEnclave.isAvailable ? "VERIFIED" : "UNSUPPORTED",
       "SecureEnclave.isAvailable = \(SecureEnclave.isAvailable)")

if SecureEnclave.isAvailable {
    do {
        let k = try SecureEnclave.P256.Signing.PrivateKey()
        let sig = try k.signature(for: "gomsinlog/1a1/ck-se-sign".data(using: .utf8)!)
        let ok = k.publicKey.isValidSignature(sig, for: "gomsinlog/1a1/ck-se-sign".data(using: .utf8)!)
        record("cryptoKit.secureEnclave.signing", ok ? "VERIFIED" : "FAILED",
               "rawRepresentation \(sig.rawRepresentation.count) bytes (P-1363), derRepresentation \(sig.derRepresentation.count) bytes; dataRepresentation handle \(k.dataRepresentation.count) bytes")
    } catch {
        record("cryptoKit.secureEnclave.signing", "UNSUPPORTED", "\(error)")
    }

    do {
        let k = try SecureEnclave.P256.KeyAgreement.PrivateKey()
        let peerRaw = unhex(str(sect("ecdhNormal"), "peerPublicRawHex"))
        let peer = try P256.KeyAgreement.PublicKey(x963Representation: peerRaw)
        let shared = try k.sharedSecretFromKeyAgreement(with: peer)
        let bytes = shared.withUnsafeBytes { Data($0) }
        record("cryptoKit.secureEnclave.keyAgreement", bytes.count == 32 ? "VERIFIED" : "SUPPORTED WITH LIMITATIONS",
               "SecureEnclave.P256.KeyAgreement produced a \(bytes.count)-byte shared secret; handle \(k.dataRepresentation.count) bytes")
    } catch {
        record("cryptoKit.secureEnclave.keyAgreement", "UNSUPPORTED", "\(error)")
    }
}

// MARK: - 6b. Full GLK2 unwrap of the Web-sealed envelope

do {
    let g = sect("glk2")
    let env = unhex(str(g, "envelopeHex"))
    let H = env.subdata(in: 0..<171)
    let eph = env.subdata(in: 171..<236)
    let nonce = env.subdata(in: 236..<248)
    let wrapped = env.subdata(in: 248..<296)
    let sigP1363 = env.subdata(in: 296..<360)

    // 1. sender signature
    let senderRaw = unhex(str(g, "senderSigRawHex"))
    var sigOk = false
    if let senderPub = secKey(fromRaw: senderRaw, isPrivate: false, canDerive: false) {
        let signed = "gomsinlog/glk2/sig/v1".data(using: .utf8)! + H + eph + nonce + wrapped
        sigOk = SecKeyVerifySignature(
            senderPub, .ecdsaSignatureMessageX962SHA256, signed as CFData, p1363ToDer(sigP1363) as CFData, nil
        )
    }

    // 2. ECDH -> HKDF -> AES-GCM
    var scopeOk = false
    if let recipPriv = secKey(fromRaw: unhex(str(g, "recipientKemSecKeyPrivateHex")), isPrivate: true, canDerive: true),
       let ephPub = secKey(fromRaw: eph, isPrivate: false, canDerive: true) {
        var kErr: Unmanaged<CFError>?
        if var z = SecKeyCopyKeyExchangeResult(
            recipPriv, .ecdhKeyExchangeStandard, ephPub, [String: Any]() as CFDictionary, &kErr
        ) as Data? {
            if z.count < 32 { z = Data(repeating: 0, count: 32 - z.count) + z } // the normalization rule
            let recipSpki = unhex(str(g, "recipientKemSpkiHex"))
            let salt = Data(SHA256.hash(data: "gomsinlog/glk2/salt/v1".data(using: .utf8)! + eph + recipSpki))
            let kek = HKDF<SHA256>.deriveKey(
                inputKeyMaterial: SymmetricKey(data: z),
                salt: salt,
                info: "gomsinlog/glk2/kek/v1".data(using: .utf8)! + H,
                outputByteCount: 32
            )
            let aad = "gomsinlog/glk2/aad/v1".data(using: .utf8)! + H + eph
            if let box = try? AES.GCM.SealedBox(
                    nonce: try AES.GCM.Nonce(data: nonce),
                    ciphertext: wrapped.prefix(32),
                    tag: wrapped.suffix(16)),
               let scope = try? AES.GCM.open(box, using: kek, authenticating: aad) {
                scopeOk = hex(scope) == str(g, "expectedScopeKeyHex")
            }
        }
    }

    record("apple.glk2.webToApple", sigOk && scopeOk ? "VERIFIED" : "FAILED",
           "signature=\(sigOk) unwrappedScopeKeyMatches=\(scopeOk) (envelope sealed by WebCrypto, opened by Security.framework + CryptoKit)")
}

// MARK: - 7. Verify a signature produced by another platform (optional args)

if CommandLine.arguments.count > 4 {
    let spki = unhex(CommandLine.arguments[2])
    let msg = CommandLine.arguments[3].data(using: .utf8)!
    let sigP1363 = unhex(CommandLine.arguments[4])
    let label = CommandLine.arguments.count > 5 ? CommandLine.arguments[5] : "external"
    // Security.framework takes a raw SEC1 point, not SPKI: strip the 26-byte prefix.
    let raw = spki.count == 91 ? spki.suffix(65) : spki
    if let pub = secKey(fromRaw: Data(raw), isPrivate: false, canDerive: false) {
        let ok = SecKeyVerifySignature(
            pub, .ecdsaSignatureMessageX962SHA256, msg as CFData, p1363ToDer(sigP1363) as CFData, nil
        )
        record("crossPlatform.\(label)ToApple", ok ? "VERIFIED" : "FAILED",
               "signature from \(label), normalized P-1363 -> DER, verified by Security.framework: \(ok)")
    } else {
        record("crossPlatform.\(label)ToApple", "FAILED", "public key import failed")
    }
}

// MARK: - emit

let payload = try! JSONSerialization.data(
    withJSONObject: ["probe": "apple-seckey", "results": results.map { ["name": $0.name, "status": $0.status, "detail": $0.detail] }],
    options: [.prettyPrinted]
)
FileHandle.standardOutput.write(payload)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
