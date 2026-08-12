# @gomsinlog/capacitor-device-keys

First-party Capacitor plugin providing **operation-by-handle** P-256 device keys.

Nine methods, deliberately. A small surface is auditable; a large one is not.
There is no method that returns a private key, and there must never be one.

## Verification status

| Platform | Status |
|---|---|
| **iOS** | Secure Enclave P-256 signing, **key agreement**, and non-exportability were VERIFIED on real Apple Secure Enclave hardware during Phase 1A-1, through the same Security.framework/CryptoKit API surface iOS uses. iOS *lifecycle* and entitlements are **DEFERRED TO THE NATIVE INTEGRATION GATE**. |
| **Android** | **Nothing verified.** No SDK was available. AndroidKeyStore behaviour, StrongBox/TEE detection, key invalidation and whether Conscrypt matches SunEC on ECDH output width are all **DEFERRED TO THE NATIVE INTEGRATION GATE**. |

Neither implementation has been wired into the app. `getDeviceKeyPort()` falls
back to the web implementation until the plugin is registered.

## Wire contract

| Value | Encoding |
|---|---|
| public keys | SPKI DER (91 bytes for P-256), base64 |
| signatures | DER natively; the plugin declares `encoding` and the TS bridge normalizes to P-1363 |
| ECDH output | exactly 32 bytes, big-endian X, **left-zero-padded** |
| private keys | never cross the boundary |

The padding rule is not optional. A provider that strips a leading zero derives
a different KEK on roughly one envelope in 256 — intermittent, unreproducible,
and invisible until recovery time.

## Assurance reporting

`getAssurance()` returns what the platform actually granted:
`secure_enclave` | `strongbox` | `tee` | `software_keystore`.

An unrecognised value degrades to `software_keystore` on the TypeScript side.
Claiming hardware backing that was never established is the single mistake this
plugin is written to avoid.
