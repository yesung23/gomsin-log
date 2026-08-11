# E2EE Phase 1A-1 — Platform & Cryptographic Interoperability Spike Report

- Date: 2026-08-11 (Asia/Seoul); **Native Completion Pass appended the same day**
- Scope: Phase 1A-1 only. No production code, schema, RLS, Storage, Edge Function or Supabase state was modified.
- Architecture under test: V2.1
- Harness: `spike/e2ee-1a1/` (isolated; not reachable from `npm run test`, `npm run build` or `src/`)

> **Two passes.** Sections up to Part J are the first pass and are unchanged. The
> [Native Completion Pass](#native-completion-pass) at the end supersedes the iOS/Android
> UNVERIFIED conclusions **in part**: Apple Security.framework and CryptoKit were subsequently
> executed against real Secure Enclave hardware, and JCA wire formats were executed on a desktop
> JDK. Android hardware remains entirely unverified. Read both.

## Status legend

| Status | Meaning |
|---|---|
| **VERIFIED** | executed in this environment and observed to pass |
| **SUPPORTED WITH LIMITATIONS** | executed and works, but with a measured constraint that changes the design |
| **UNVERIFIED** | not executed here; the environment could not run it. No claim is made |
| **UNSUPPORTED** | executed or authoritatively established to be unavailable |

Nothing below is marked VERIFIED on the basis of documentation.

---

## 0. Environment — what could and could not be executed

| Capability | Present | Consequence |
|---|---|---|
| Node v26.7.0 (darwin/arm64) WebCrypto | yes | Parts A, B, F (Node side), G, H executed |
| Chromium 148 (Electron 42, in-app browser) | yes | Part E and the browser side of F/G executed |
| PostgreSQL 17.10 (throwaway local cluster, port 55432) | yes | Part H executed |
| Xcode / iOS Simulator | **no** — only Command Line Tools; `xcodebuild` unavailable | **Part C entirely UNVERIFIED** |
| Android SDK / adb / emulator | **no** — no SDK, no `adb`, no `ANDROID_HOME` | **Part D entirely UNVERIFIED** |
| Docker / Supabase CLI / PostgREST | **no** | Part H measured against Postgres-side JSON generation, not PostgREST itself |
| Physical iOS or Android device | **no** | Secure Enclave and StrongBox untested |

The absence of the two mobile toolchains is the single largest gap in this spike and is the reason the final verdict is not a clean PASS.

---

## PART A — WebCrypto baseline · **VERIFIED**

19 executable tests, `spike/e2ee-1a1/tests/a-webcrypto.spike.test.ts`. Every primitive was checked against a
published known-answer vector *and* cross-checked against `node:crypto` (OpenSSL), so no result rests on a
single implementation.

| Primitive | Result | Evidence |
|---|---|---|
| SHA-256 | VERIFIED | FIPS 180-4 `"abc"` and empty-string vectors |
| HMAC-SHA-256 | VERIFIED | RFC 4231 test case 1; plus agreement with OpenSSL on random input |
| HKDF-SHA-256 | VERIFIED | RFC 5869 test case 1 (PRK/OKM exact); plus agreement with `crypto.hkdfSync` on GLK2-shaped inputs |
| HKDF empty vs zero salt | VERIFIED | an absent salt and 32 zero bytes derive **identically**, per RFC 5869. Native implementations must match this or they derive a different KEK |
| AES-256-GCM | VERIFIED | 96-bit nonce, 128-bit tag; output is `ciphertext‖tag`, byte-identical to OpenSSL's separate body+tag concatenated |
| AES-GCM negative cases | VERIFIED | modified ciphertext, modified tag, modified AAD and modified nonce all fail |
| P-256 ECDH | VERIFIED | 32-byte shared secret; `deriveBits` agrees with OpenSSL `diffieHellman` |
| P-256 public key encoding | VERIFIED | SPKI = 91 bytes, SEC1 uncompressed = 65 bytes beginning `0x04`; **the SEC1 point is exactly the last 65 bytes of the SPKI** |
| P-256 ECDSA | VERIFIED | SHA-256; WebCrypto returns 64-byte P-1363 |
| BigInt 64-bit fields | VERIFIED | `setBigUint64`/`getBigUint64` round-trip at 0, 2^53±1, 2^63−1, 2^64−1; big-endian; out-of-range fails closed |

### A-critical: ECDH leading-zero X coordinate · **VERIFIED**

A keypair whose shared secret begins with `0x00` was found by brute force after **154 attempts** (consistent with
the expected ~1/256) and frozen at `spike/e2ee-1a1/vectors/generated/ecdh-leading-zero.json`.

- WebCrypto `deriveBits` returns the full **32 bytes including the leading zero**.
- The minimal-length form (31 bytes) is recorded alongside it, so a native implementation that strips leading
  zeros produces a *different KEK* and fails only on ~0.4% of envelopes — the worst possible failure mode.

**Binding rule confirmed for 1A-2:** the native plugin MUST left-zero-pad its key-agreement output to exactly
32 bytes and MUST reject anything longer.

---

## PART B — Strict DER ↔ P-1363 · **VERIFIED**

24 executable tests, `spike/e2ee-1a1/tests/b-ecdsa-format.spike.test.ts`.

**Observed formats:**

| Producer | Native output |
|---|---|
| WebCrypto (`crypto.subtle.sign`) | P-1363, exactly 64 bytes |
| OpenSSL / `node:crypto` default | DER `SEQUENCE{INTEGER r, INTEGER s}`, 70–72 bytes |

A DER signature passed unchanged to `crypto.subtle.verify` **returns false** — verified. This is the interop bug
the conversion layer exists to prevent, and it fails silently as a rejected-signature rather than an error.

**Round-trip evidence:**
- Real OpenSSL DER → P-1363 → **verified by WebCrypto** across every observed integer-width case (`r` needing a
  `0x00` pad, `r` short with a leading zero, plain).
- WebCrypto P-1363 → DER → **verified by OpenSSL**, 100 signatures.
- `DER → P1363 → DER` and `P1363 → DER → P1363` are exact fixed points over 300 real signatures each.

**16 adversarial encodings, all rejected with a distinct error code:** wrong SEQUENCE tag, wrong INTEGER tag,
trailing bytes, truncated body, long-form SEQUENCE length, long-form INTEGER length, negative INTEGER, redundant
leading zero, two leading zeros, zero-length INTEGER, INTEGER > 33 bytes, `r = 0`, `s = 0`, `r ≥ n`, `s ≥ n`,
under-length buffer. The P-1363 decoder additionally rejects any length ≠ 64, zero scalars and scalars ≥ `n`.

> Harness note, recorded for honesty: the first version of this test compared two *separately generated*
> signatures over the same message and failed. ECDSA is randomised, so that comparison was invalid — the test was
> the bug, not the codec. It now signs once and converts, which is the only sound way to test this.

---

## PART C — iOS native device keys · **UNVERIFIED**

Nothing in this section was executed. `xcode-select -p` resolves to `/Library/Developer/CommandLineTools`;
`xcodebuild` is unavailable and no simulator or device is present.

| Item | Status |
|---|---|
| Secure Enclave P-256 signing key generation | UNVERIFIED |
| Secure Enclave P-256 **key agreement** (`SecKeyCopyKeyExchangeResult`) | UNVERIFIED — **highest-risk unknown in the whole spike** |
| Operation-by-handle without private key export | UNVERIFIED |
| Public key serialisation to SPKI matching Web | UNVERIFIED |
| Force quit / restart / OS restart persistence | UNVERIFIED |
| Behaviour on biometric enrollment change | UNVERIFIED |
| Reinstall and backup/restore behaviour | UNVERIFIED |

**Why the agreement question is the risk.** V2.1 gives every device a `dev_kem` ECDH key and assumes it can live
in the Secure Enclave. Secure Enclave signing and Secure Enclave key agreement are separate capabilities with
separate platform histories, and signing support does not imply agreement support. If agreement is unavailable
on the target OS range, `dev_kem` must fall back to a Keychain-stored software key while `dev_sig` stays in the
Enclave — a real, describable assurance split that **changes the 1A-2 interface and the assurance classes in the
DeviceCertificate**. This must be measured on a real device before 1A-2 is designed, not assumed.

---

## PART D — Android native device keys · **UNVERIFIED**

Nothing executed. No Android SDK, no `adb`, no emulator, no `ANDROID_HOME`.

| Item | Status |
|---|---|
| Keystore P-256 signing | UNVERIFIED |
| Keystore P-256 ECDH | UNVERIFIED |
| Operation-by-handle | UNVERIFIED |
| `KeyInfo.getSecurityLevel()` assurance detection | UNVERIFIED |
| Restart persistence, key invalidation, uninstall behaviour | UNVERIFIED |
| **VERIFIED HARDWARE / VERIFIED TEE / VERIFIED SOFTWARE** | none of the three claimed |

No StrongBox, TEE or software-Keystore result is claimed at any level.

---

## PART E — Web / WebView key persistence · **SUPPORTED WITH LIMITATIONS**

Executed in Chromium 148 (Electron 42) via `spike/e2ee-1a1/web/index.html`.

| Check | Result |
|---|---|
| Secure context | VERIFIED (`isSecureContext === true` on `http://127.0.0.1`) |
| Non-extractable ECDSA + ECDH `CryptoKey` stored in IndexedDB | VERIFIED |
| Survives page reload | VERIFIED — second load reported `restored-from-indexeddb` |
| Restored key still usable | VERIFIED — 64-byte signature verified; `deriveBits` returned 32 bytes |
| Private key export refused | VERIFIED — `pkcs8`, `jwk` and `raw` all rejected with `InvalidAccessError`, for both key types |
| Public key export | VERIFIED — 91-byte SPKI |
| **Clear site data** | VERIFIED destructive — after `indexedDB.deleteDatabase`, the next load reported `generated-this-load`. **The key is gone and unrecoverable** |

### The XSS finding — stated as the architecture requires

**VERIFIED by direct demonstration.** A dynamically constructed function (standing in for injected same-origin
script) was handed the non-extractable private key and successfully produced a valid signature over an
attacker-chosen message.

> Non-extractability prevents a key from being **exfiltrated**. It does not prevent same-origin JavaScript from
> **invoking** cryptographic operations with that key and observing the resulting plaintext or signatures. XSS
> capable of executing same-origin code has, in effect, full use of every non-extractable key for as long as it
> runs. Non-extractability must never be described as XSS protection.

The mitigation is CSP and dependency hygiene, not the keystore. This confirms the V2.1 decision to keep Web at a
lower assurance class with health access OFF by default.

**Limitation on scope:** the engine tested is desktop Chromium. **iOS WKWebView and Android WebView were not
tested — both remain UNVERIFIED.** WKWebView in particular is a different engine (JavaScriptCore/WebKit) and
must not be inferred from this result.

---

## PART F — Cross-platform wire interoperability

Frozen vectors: `spike/e2ee-1a1/vectors/generated/interop-vectors.json` and `ecdh-leading-zero.json`.
These are committed so an iOS or Android probe consumes byte-identical inputs later.

### Direction matrix — no missing direction is collapsed into a PASS

| Direction | Vectors 1–5 | GLK2 (Part G) |
|---|---|---|
| Node → Chromium | **VERIFIED** | **VERIFIED** |
| Chromium → Node | **VERIFIED** (same frozen vectors re-derived identically) | not applicable (browser did not seal) |
| Node ↔ OpenSSL | **VERIFIED** | n/a |
| Web → iOS | **UNVERIFIED** | **UNVERIFIED** |
| iOS → Web | **UNVERIFIED** | **UNVERIFIED** |
| Web → Android | **UNVERIFIED** | **UNVERIFIED** |
| Android → Web | **UNVERIFIED** | **UNVERIFIED** |
| iOS → Android | **UNVERIFIED** | **UNVERIFIED** |
| Android → iOS | **UNVERIFIED** | **UNVERIFIED** |

**Six of the nine required directions are UNVERIFIED.** What has been established is that two independent
WebCrypto implementations (Node/OpenSSL and Chromium/BoringSSL) agree byte-for-byte on every vector, and that the
vectors themselves are correct and consumable. The mobile half of the matrix is untouched.

| Vector | Content | Node | Chromium |
|---|---|---|---|
| 1 public keys | SPKI, SEC1 uncompressed, SHA-256 fingerprints | VERIFIED | VERIFIED |
| 2 ECDH | normal + **leading-zero-X** shared secret | VERIFIED | VERIFIED (`len=32 first=0`) |
| 3 HKDF | GLK2-shaped salt/info | VERIFIED | VERIFIED |
| 4 AES-GCM | fixed key/nonce/plaintext/AAD → `ciphertext‖tag` | VERIFIED | VERIFIED (byte-identical) |
| 5 ECDSA | P-1363 signature verified cross-engine | VERIFIED | VERIFIED |

---

## PART G — GLK2 feasibility · **PASS WITH LIMITATIONS**

32 executable tests, `spike/e2ee-1a1/tests/g-glk2.spike.test.ts`. Experimental codec only.

**Structure confirmed against V2.1 §7:** header **171** bytes + ephemeral 65 + nonce 12 + wrapped key 48 +
signature 64 = **360 bytes** exactly. The arithmetic in the architecture document is correct.

- Round-trip of the scope key and every header field: VERIFIED.
- A 64-bit epoch of `2^53 + 1` survives the envelope intact and is provably not equal to its `Number` coercion:
  VERIFIED.
- **Frozen cross-platform vector** written to `vectors/generated/glk2-vector.json` and **opened successfully by
  Chromium** using only the published construction: signature verified, unwrapped scope key matched.

### Mutation resistance — every mutation the task required, plus more

All 11 required mutations fail: `domain`, `scope_key_id`, `owner_user_id`, `scope_id`, `epoch`, sender
fingerprint, recipient fingerprint, ephemeral key, nonce, ciphertext, signature. Additionally: `recipient_id`,
`created_at_ms`, tag byte, non-zero `reserved`, bad magic, bad version, wrong length, and a compressed-point
prefix.

**Defence in depth was tested separately.** Every header mutation was re-run with signature verification
disabled, and each still failed at the AEAD layer (`E_AEAD_FAILED`) because the header is inside the associated
data as well as the signed message. Neither layer alone is load-bearing.

**Cross-domain and cross-scope splicing tested:** a wrapped key sealed under `domain = health` spliced into a
`domain = couple` header fails; likewise a different `scope_id`. Ciphertext cannot be re-homed.

**Limitation:** this is a Web-only result. The envelope has never been produced or opened by an iOS or Android
implementation, so GLK2 cross-*platform* compatibility is **UNVERIFIED**. The verdict is PASS WITH LIMITATIONS,
not PASS.

---

## PART H — 64-bit database transport · **SUPPORTED WITH LIMITATIONS** (mitigation VERIFIED)

Measured against a throwaway PostgreSQL 17.10 cluster on port 55432. Probe:
`tools/pg-bigint-probe.mjs`; recording: `vectors/generated/bigint-transport.json`; regression test:
`tests/h-bigint.spike.test.ts`.

Method: PostgREST builds its response body with Postgres's own JSON generation, so `row_to_json`/`json_agg`
output is the bytes the API sends; `@supabase/supabase-js` then applies `Response.json()`, i.e. `JSON.parse`.
Both halves were run.

| Value | Postgres emits | After `JSON.parse` | Exact? |
|---|---|---|---|
| 2^53 − 1 = 9007199254740991 | `{"v":9007199254740991}` | 9007199254740991 | yes |
| 2^53 = 9007199254740992 | `{"v":9007199254740992}` | 9007199254740992 | yes |
| **2^53 + 1 = 9007199254740993** | `{"v":9007199254740993}` | **9007199254740992** | **NO** |
| **2^63 − 1 = 9223372036854775807** | `{"v":9223372036854775807}` | **9223372036854776000** | **NO** |

**Finding: direct `bigint` transport silently corrupts values above 2^53.** Postgres emits full precision; the
loss happens in `JSON.parse`, with no error, no warning and no exception. A `content_revision` CAS or an `epoch`
comparison built on this would compare wrong numbers and appear to work.

**Mitigation VERIFIED.** Selecting the column cast to `text` gives `{"v":"9223372036854775807"}`, which parses to
a string and converts to `BigInt` exactly, at all four boundaries.

**Binding rule for 1A-4 / the repository layer:** `key_epoch`, `content_revision` and `membership_revision` must
be selected as text and parsed with `BigInt()`. A guard that throws on a non-safe-integer JSON number is included
in the test as the shape the repository layer should adopt.

**Limitation:** PostgREST itself was not installed, so its serializer is assumed to be Postgres-side JSON
generation. Confirming against a real PostgREST instance remains **UNVERIFIED** — though the corruption is in
`JSON.parse`, which is unavoidable regardless of serializer, so the conclusion is robust.

---

## PART I — Media Streaming AEAD · **PHASE 1C STREAMING FORMAT UNRESOLVED**

No product media format was designed, and no chunk-nonce construction was invented.

### Candidate 1 — Google Tink Streaming AEAD (`AES256_GCM_HKDF_*`)

Evidence gathered from the GitHub API and the npm registry:

| Implementation | Repo state | Streaming AEAD | Verdict |
|---|---|---|---|
| `tink-java` (Android) | active, pushed 2026-08-11 | **present** — `AesGcmHkdfStreaming`, `AesGcmHkdfStreamingKeyManager` | available |
| `tink-objc` (iOS) | active, pushed 2026-08-07 | **absent** — primitives are `aead`, `daead`, `hybrid`, `mac`, `signature` only; the only streaming artefacts are unused `.proto` files with no implementation | **UNSUPPORTED** |
| JavaScript / TypeScript | `google/tink` monorepo **archived** 2024-04-17; no `tink-js` repo exists in `tink-crypto`; npm `tink-crypto` is v0.1.1, last published 2023-05-02 | n/a | **UNSUPPORTED** |

The maintained Tink language set is C++, Go, Java, Obj-C and Python. **Tink Streaming AEAD is available on one of
our three targets.** Verdict: **UNSUPPORTED** for a single cross-platform wire format.

### Candidate 2 — age STREAM (ChaCha20-Poly1305)

| Target | Implementation | Verdict |
|---|---|---|
| Web | `typage` (TypeScript, by the age author), active 2025-12-29 | available |
| Android | `kage` (Kotlin, android-password-store), active 2026-08-09 — third party | SUPPORTED WITH LIMITATIONS |
| iOS | no maintained Swift implementation found | **UNVERIFIED / likely UNSUPPORTED** |

Additional constraints: age uses ChaCha20-Poly1305, which **WebCrypto does not provide**, so the Web path would
require a bundled JS crypto library — reintroducing exactly the supply-chain and raw-key-in-JS-heap exposure that
V2.1 avoids by staying on `crypto.subtle`. age is also a file-encryption format with its own recipient/header
model, not a per-object DEK primitive. Verdict: **SUPPORTED WITH LIMITATIONS**, and a poor architectural fit.

### Candidate 3 — WebCrypto single-shot AES-GCM (baseline only, **not a format proposal**)

Measured on desktop (Node v26.7.0, darwin/arm64), 45 MB object — the current per-video ceiling in
`src/lib/records.ts`:

| Metric | Value |
|---|---|
| Encrypt | 33 ms → 1375 MB/s |
| Decrypt | 25 ms → 1780 MB/s |
| RSS baseline → after decrypt | 46.9 MB → 277.3 MB |
| **RSS growth for a 45 MB file** | **230.4 MB (≈5×)** |
| Truncation detected | yes, but only after the entire object is processed |

**Throughput is not the constraint; memory is.** A ~5× resident multiplier on a 45 MB video is a genuine OOM risk
on a low-end Android device, and single-shot also gives no per-chunk authentication, no byte-range playback, and
no resumable-upload story. These numbers are **desktop-only and do not transfer to mobile** — mobile throughput
and memory headroom remain **UNVERIFIED**.

### Part I verdict

| Candidate | Web | iOS | Android | One wire format | Overall |
|---|---|---|---|---|---|
| Tink Streaming AEAD | UNSUPPORTED | UNSUPPORTED | available | no | **UNSUPPORTED** |
| age STREAM | available | UNVERIFIED | third-party | unlikely | **SUPPORTED WITH LIMITATIONS** |
| WebCrypto single-shot | available | available | available | yes | **not a candidate** — baseline only |

**No candidate satisfies the V2.1 requirement of one byte-identical, established, audited Streaming AEAD across
Web, iOS and Android.**

> **PHASE 1C STREAMING FORMAT UNRESOLVED**

Per the 1A-1 brief this is an acceptable successful outcome. It blocks Phase 1C only; it does not block 1A-2
through 1A-11. No cipher format was invented to force a pass.

---

## PART J — Platform assurance matrix

| Capability | Web (Chromium 148) | iOS | Android |
|---|---|---|---|
| Signing key non-exportability | **SUPPORTED WITH LIMITATIONS** — export refused; same-origin script can still use the key | UNVERIFIED | UNVERIFIED |
| Agreement key non-exportability | **SUPPORTED WITH LIMITATIONS** — same as above | UNVERIFIED | UNVERIFIED |
| Hardware backing | **UNSUPPORTED** — none exists on Web | UNVERIFIED | UNVERIFIED |
| ECDH P-256 | **VERIFIED** (incl. leading-zero X) | UNVERIFIED | UNVERIFIED |
| ECDSA P-256 | **VERIFIED** (P-1363, 64 bytes) | UNVERIFIED | UNVERIFIED |
| AES-256-GCM | **VERIFIED** | UNVERIFIED | UNVERIFIED |
| HKDF-SHA-256 | **VERIFIED** | UNVERIFIED | UNVERIFIED |
| Persistent `CryptoKey` | **SUPPORTED WITH LIMITATIONS** — survives reload; destroyed by clear-site-data | UNVERIFIED (WKWebView untested) | UNVERIFIED (WebView untested) |
| BigInt wire compatibility | **SUPPORTED WITH LIMITATIONS** — direct `bigint` lossy; cast-to-text VERIFIED | UNVERIFIED | UNVERIFIED |
| GLK2 cross-platform compatibility | **VERIFIED** Node ↔ Chromium | UNVERIFIED | UNVERIFIED |

---

## Findings that bind later phases

1. **ECDH output must be left-zero-padded to 32 bytes.** Frozen vector proves the ~1/256 case exists. A native
   implementation that strips leading zeros fails on 0.4% of envelopes only. *(binds 1A-2)*
2. **DER ↔ P-1363 conversion is mandatory and must be strict.** A DER signature is silently rejected by
   WebCrypto. 16 malformed encodings must be rejected with distinct errors. *(binds 1A-2, 1A-3)*
3. **`bigint` must be selected as text and parsed with `BigInt()`.** Direct transport silently corrupts
   `content_revision` and `key_epoch` above 2^53 with no error. *(binds 1A-4 and the repository layer)*
4. **Non-extractability is not XSS protection**, demonstrated directly. Web stays lower-assurance with health
   OFF by default. *(confirms V2.1 §5)*
5. **Clearing site data destroys Web device keys irrecoverably.** A Web device must never be a user's only
   provisioned device without an acknowledged recovery kit. *(confirms V2.1 §5)*
6. **The SEC1 uncompressed point is the last 65 bytes of the SPKI**, so one encoder serves both representations.
   *(simplifies 1A-3)*
7. **HKDF with an absent salt equals a 32-zero-byte salt.** Native implementations must match or derive a
   different KEK. *(binds 1A-2)*
8. **Secure Enclave key *agreement* is the highest-risk unknown.** Signing support does not imply agreement
   support; if absent, `dev_kem` needs a documented software fallback and a distinct assurance class.
   *(must be resolved before 1A-2 is designed)*
9. **Media memory, not throughput, is the constraint** — ≈5× resident for single-shot. *(binds 1C)*

---

## Completion gate — item by item

| # | Gate | Status |
|---|---|---|
| 1 | Core WebCrypto primitives have executable known-answer tests | **MET** — 19 tests, published vectors + OpenSSL cross-check |
| 2 | ECDSA representation differences experimentally resolved | **MET** — 24 tests; both native formats observed and converted |
| 3 | ECDH leading-zero behaviour resolved | **MET** — vector frozen, behaviour confirmed on two engines |
| 4 | Native device-key capability measured where environments permit | **NOT MET — no environment permitted it.** iOS and Android entirely UNVERIFIED |
| 5 | Web/WebView persistence measured where environments permit | **PARTIALLY MET** — desktop Chromium measured; WKWebView and Android WebView UNVERIFIED |
| 6 | BigInt/PostgREST behaviour measured | **MET** — corruption measured, mitigation verified |
| 7 | GLK2 experimental cross-platform vectors exist | **MET** — frozen vector opens on a second independent engine |
| 8 | Media Streaming AEAD candidates have an evidence-based verdict | **MET** — UNRESOLVED, with repo-level evidence |
| 9 | Every unavailable environment explicitly marked UNVERIFIED | **MET** |
| 10 | No product or production state modified | **MET** |

Gate 4 is not met and gate 5 is only partially met. Both are environmental, not design, failures.

---

## Production changes

**NOT APPLIED.** No migration was created or applied, no RLS changed, no Edge Function deployed, no Storage
object touched, no user data read or encrypted, no legacy health data accessed. `npm run lint` and
`npm run typecheck` both pass unchanged with the spike present. The only repository addition is `spike/` and this
report.

---

# Native Completion Pass

Second pass, same day. Objective: close as many UNVERIFIED items as the available environments permit.
First-pass results were not re-run except where a native test needed their vectors.

## Environment classification

| Environment | Classification | Evidence |
|---|---|---|
| **Xcode / iOS Simulator** | **UNAVAILABLE** | no `Xcode.app` anywhere (`mdfind` empty), `xcode-select -p` = CommandLineTools, `simctl` absent, no CoreSimulator runtimes on disk |
| **Physical iOS device** | **UNAVAILABLE** | none attached |
| **Android SDK / adb / emulator** | **UNAVAILABLE** | no SDK directory in any standard location, no `adb`/`emulator`/`sdkmanager`, `ANDROID_HOME` unset, no Android Studio |
| **Physical Android device** | **UNAVAILABLE** | none attached |
| **Apple Security.framework + CryptoKit on real Secure Enclave** | **AVAILABLE** | Swift 6.3.3, macOS 26.5.2, **Apple M1 (MacBookPro17,1)**, Secure Boot full, SIP enabled |
| **JCA (desktop JDK)** | **AVAILABLE** | javac/java 21.0.8, SunEC + SunJCE |
| WKWebView / Android WebView | **UNAVAILABLE** | require Xcode and the Android SDK respectively |

The two available environments are **not** iOS and Android. What they permit is stated precisely below, and
the interoperability/assurance distinction is preserved throughout.

## iOS

### Exact environment

Probe: `spike/e2ee-1a1/native/apple/SecKeyProbe.swift` → `swiftc -O`, run against
`vectors/generated/seckey-vectors.json`. Results recorded at `vectors/generated/probe-apple-results.json`
(**23 VERIFIED, 3 INFO, 0 FAILED**).

**This is macOS, not iOS.** It exercises the *same* Security.framework and CryptoKit API surface that iOS uses,
against the *same* Secure Enclave Processor hardware family, under a *different* OS and a *different* entitlement
model. Every result below is therefore evidence about **the Apple API contract**, and must be repeated on a real
iOS device before it is an iOS result.

### Tests executed and results

| Test | Status | Result |
|---|---|---|
| Secure Enclave P-256 **signing** key creation | VERIFIED | `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave` succeeded |
| Secure Enclave **signing** performed | VERIFIED | signed and verified; DER, 71 bytes |
| **Secure Enclave P-256 KEY AGREEMENT — the highest-risk unknown** | **VERIFIED** | `SecKeyIsAlgorithmSupported(.ecdhKeyExchangeStandard) = true`; **`SecKeyCopyKeyExchangeResult` returned 32 bytes from an SE-backed key** |
| SE agreement **cryptographic correctness** | **VERIFIED** | the SE public key was handed to Node, which derived the same secret from the other side; `SHA-256(shared)` matched exactly. Not merely a length check |
| SE private key export | VERIFIED refused | `errSecUnimplemented (-4)` — *"export not implemented for key `<SecKeyRef:('com.apple.setoken')>`"*. True operation-by-handle |
| SE public key retrieval | VERIFIED | SEC1 uncompressed, 65 bytes |
| CryptoKit `SecureEnclave.isAvailable` | VERIFIED | `true` |
| CryptoKit `SecureEnclave.P256.Signing` | VERIFIED | 284-byte opaque handle; signature exposes **both** `rawRepresentation` (64 B P-1363) and `derRepresentation` (72 B) |
| CryptoKit `SecureEnclave.P256.KeyAgreement` | **VERIFIED** | 32-byte shared secret from an SE-backed key; 284-byte handle |
| Software SecKey ECDH, normal vector | VERIFIED | 32 bytes, exact match |
| Software SecKey ECDH, **leading-zero-X vector** | VERIFIED | 32 bytes, **first byte `0x00` preserved** — Security.framework does **not** strip leading zeros |
| SPKI prefix rule | VERIFIED | P-256 SPKI == constant 26-byte prefix ‖ SEC1 point. Apple returns the point only; one encoder serves both |
| ECDSA native encoding | VERIFIED | `SecKeyCreateSignature` emits **X9.62 DER** (71–72 B), not P-1363. Conversion mandatory on the SecKey path |
| Web → Apple ECDSA | VERIFIED | WebCrypto P-1363 → DER → verified by Security.framework |
| Apple → Web ECDSA | VERIFIED | Security.framework DER → P-1363 → verified by WebCrypto |
| CryptoKit AES-GCM | VERIFIED | `ciphertext‖tag` byte-identical to the WebCrypto vector (CryptoKit exposes them separately) |
| CryptoKit HKDF-SHA256 | VERIFIED | matches the WebCrypto vector |
| **GLK2 Web → Apple** | **VERIFIED** | envelope sealed by WebCrypto, signature verified and scope key unwrapped by Security.framework + CryptoKit |

### Assurance level

**HARDWARE ASSURANCE: Apple Secure Enclave, VERIFIED on macOS/M1.** Not a simulator — the key lives behind
`com.apple.setoken` and its export is refused by the token, not by policy.
**iOS hardware assurance: still UNVERIFIED.**

### Remaining iOS unknowns

- Everything OS-specific: app restart, force quit, OS restart, biometric enrollment change, uninstall/reinstall,
  encrypted-backup restore behaviour. **None were testable** — a CLI binary has no iOS app lifecycle.
- iOS entitlement requirements for SE key creation (macOS accepted an unsigned binary with
  `kSecAttrIsPermanent = false`; iOS may differ).
- Keychain persistence of a permanent SE-backed key across reinstall.
- WKWebView WebCrypto/IndexedDB behaviour.

## Android

### Exact environment

Probe: `spike/e2ee-1a1/native/jca/JcaProbe.java` → `javac` 21.0.8, SunEC/SunJCE. Results at
`vectors/generated/probe-jca-results.json` (**12 VERIFIED, 2 INFO, 0 FAILED**).

**This is a desktop JDK, not Android.** Android uses Conscrypt/BoringSSL and, for hardware keys,
`AndroidKeyStore`. This probe establishes **JCA API shape and wire format only**.

### Tests executed and results

| Test | Status | Result |
|---|---|---|
| JCA ECDH, normal vector | VERIFIED | 32 bytes, exact match |
| JCA ECDH, **leading-zero-X vector** | VERIFIED | 32 bytes, first byte `0x00` preserved — SunEC does **not** strip |
| Public key encoding | VERIFIED | `X509EncodedKeySpec(prefix ‖ SEC1 point)` re-encodes to the identical 91-byte SPKI; `getEncoded()` is SPKI |
| SPKI fingerprint | VERIFIED | `SHA-256(SPKI)` matches the frozen fingerprint |
| JCA rejects bare P-1363 | VERIFIED | `SHA256withECDSA` refuses an unconverted P-1363 signature |
| Web → JCA ECDSA | VERIFIED | P-1363 → DER → verified by SunEC |
| JCA native encoding | VERIFIED | SunEC emits DER (70 B), not P-1363 |
| JCA → Web ECDSA | VERIFIED | DER → P-1363 → verified by WebCrypto |
| JCA AES-GCM | VERIFIED | SunJCE returns `ciphertext‖tag`, byte-identical to the WebCrypto vector |
| JCA HKDF | VERIFIED | RFC 5869 over `javax.crypto.Mac` matches the vector. **JDK 21 has no built-in HKDF** — a KDF must be supplied |
| **GLK2 Web → JCA** | **VERIFIED** | envelope sealed by WebCrypto, signature verified and scope key unwrapped by JCA |
| GLK2 tamper rejection on the JCA path | VERIFIED | flipping the `domain` byte causes `AEADBadTagException` |

### Assurance level

**NONE. No hardware assurance of any kind was established.**
Not StrongBox, not TEE, not software `AndroidKeyStore`. No `KeyInfo.getSecurityLevel()` call was made because no
Android runtime exists here.

### Remaining Android unknowns — all of them

`AndroidKeyStore` key generation, operation-by-handle, non-exportability enforcement, `setUserAuthenticationRequired`
behaviour, key invalidation on biometric enrollment change, StrongBox/TEE/software classification, restart and
force-stop persistence, uninstall behaviour, and **whether Conscrypt matches SunEC on the ECDH leading-zero
width** — a genuine known divergence area between JCA providers that must not be assumed from this result.

## WebViews

| Runtime | Status |
|---|---|
| Desktop Chromium | VERIFIED in the first pass (Part E) — unchanged |
| **iOS WKWebView** | **UNVERIFIED** — requires Xcode |
| **Android WebView** | **UNVERIFIED** — requires the Android SDK |

No WebView result is inferred from desktop Chromium.

## Cross-platform matrix

Legend: **W** = WebCrypto (Node + Chromium), **A** = Apple Security.framework/CryptoKit on macOS/M1 SEP,
**J** = JCA on desktop JDK.

| Direction | Public keys / fingerprints | ECDH | HKDF | AES-GCM | ECDSA P-1363 | GLK2 |
|---|---|---|---|---|---|---|
| W → A | VERIFIED | VERIFIED | VERIFIED | VERIFIED | VERIFIED | **VERIFIED** |
| A → W | VERIFIED | VERIFIED (SE secret cross-checked) | n/a | n/a | VERIFIED | UNVERIFIED — Apple never seals |
| W → J | VERIFIED | VERIFIED | VERIFIED | VERIFIED | VERIFIED | **VERIFIED** |
| J → W | VERIFIED | VERIFIED | n/a | n/a | VERIFIED | UNVERIFIED — JCA never seals |
| A → J | n/a | agrees via shared vector | n/a | n/a | **VERIFIED** | UNVERIFIED |
| J → A | n/a | agrees via shared vector | n/a | n/a | **VERIFIED** | UNVERIFIED |
| Web ↔ **iOS** | **UNVERIFIED — no Xcode, no simulator, no device** | same | same | same | same | same |
| Web ↔ **Android** | **UNVERIFIED — no Android SDK, no emulator, no device** | same | same | same | same | same |
| **iOS ↔ Android** | **UNVERIFIED — neither platform available** | same | same | same | same | same |

Apple↔JCA ECDSA was executed directly in both directions, not inferred. GLK2 sealing was only ever performed by
WebCrypto; the native probes validate and unwrap, which is the direction the architecture actually needs first
(a device must open envelopes written by others), but native *sealing* remains untested.

## DeviceKeyPort implications

Concrete interface constraints learned, replacing assumptions in V2.1 §5:

1. **Secure Enclave ECDH works. The feared fallback is not needed on Apple.** V2.1 flagged the possibility that
   `dev_kem` would have to drop to a software key while `dev_sig` stayed in hardware, splitting the assurance
   class. Both `SecKeyCopyKeyExchangeResult` and `SecureEnclave.P256.KeyAgreement` succeeded on SE-backed keys and
   produced cryptographically correct secrets. **Subject to iOS-device confirmation, `dev_sig` and `dev_kem` can
   share one assurance class on Apple.**
2. **`deriveSecret` must still return raw bytes to the caller**, exactly as V2.1 states honestly: both Apple APIs
   hand the 32-byte shared secret back to the app process. Only the private key stays in hardware.
3. **`sign()` must normalize per backend, not per platform.** `SecKey` → DER (conversion required);
   CryptoKit `P256.Signing.ECDSASignature` → `rawRepresentation` is already P-1363. JCA → DER. **Recommendation:
   the port returns P-1363 always and converts internally**; picking CryptoKit on Apple removes one conversion.
4. **`getPublicKey()` should return SPKI, and the port should synthesize it.** Apple returns SEC1 points only.
   The P-256 SPKI is a constant 26-byte prefix followed by the point — verified on Apple, JCA and WebCrypto — so a
   single 26-byte constant covers every platform and fingerprints stay byte-identical.
5. **Left-zero-padding is defensive, not corrective, on the two stacks measured.** Security.framework and SunEC
   both returned the full 32 bytes with the leading `0x00` intact. The padding rule stays mandatory because
   Conscrypt is unmeasured, but no measured stack currently requires it.
6. **Assurance detection is per-platform and has no common API.** Apple: `SecureEnclave.isAvailable` plus the
   `com.apple.setoken` marker. Android: `KeyInfo.getSecurityLevel()` — **untested**. `getAssurance()` must be a
   platform-specific implementation, not a shared abstraction.
7. **Android needs its own KDF.** JDK 21 (and correspondingly older Android API levels) has no built-in HKDF; it
   must be supplied over `javax.crypto.Mac`. The RFC 5869 implementation was verified against the shared vector.
8. **The envelope format itself is sound across stacks.** GLK2 sealed by WebCrypto was opened by two independent
   native cryptographic stacks with no format ambiguity, and tampering was rejected on both.

## Remaining UNVERIFIED

Only what is genuinely still unknown:

1. **All Android hardware and `AndroidKeyStore` behaviour** — generation, operation-by-handle, non-exportability,
   assurance level, invalidation, persistence, uninstall. Nothing is known.
2. **Whether Conscrypt matches SunEC on ECDH output width** (the leading-zero case).
3. **All iOS OS-lifecycle behaviour** — restart, force quit, biometric enrollment change, reinstall, backup/restore.
4. **iOS entitlement requirements** for Secure Enclave key creation in a real app.
5. **iOS WKWebView and Android WebView** `CryptoKey` persistence and export refusal.
6. **Native GLK2 sealing** (Apple → Web, JCA → Web); only unwrapping was tested.
7. **Mobile media throughput/memory**; Phase 1C streaming format remains UNRESOLVED (unchanged, not revisited).

## Production changes

**NOT APPLIED.** This pass added only files under `spike/e2ee-1a1/native/`, two derived vector files, two probe
result records, and this report section. `npm run lint` and `npm run typecheck` pass unchanged. No Supabase,
schema, RLS, Edge Function, Storage or user data was touched. Compiled probe binaries are gitignored.
