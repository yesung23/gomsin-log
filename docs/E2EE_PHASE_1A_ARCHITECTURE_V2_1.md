# GomsinLog E2EE Phase 1A — Architecture V2.1 (canonical)

**Status: canonical. This file, not any conversation history, is the security
specification.** V1 and V2 were superseded after independent review; the
findings that produced each correction are recorded so the reasoning survives.

## Phase 1A development freeze

| | |
|---|---|
| Phase 1A | **DEVELOPMENT COMPLETE / FROZEN** |
| Phase 1B development | **ALLOWED** |
| Production deployment | **NOT APPROVED** |
| Phase 1A migrations in production | **NOT APPLIED** |

Development-gate evidence at the freeze, all against PostgreSQL 17.10 with the
real migrations, grants, RLS and `authenticated` actors:

| Gate | Result |
|---|---|
| `npm run test:p0` | PASS — 76 assertions |
| `npm run test:rollback` | PASS — `031→032→034→035→036→033` restores the pre-031 inventory |
| typecheck / lint / build | PASS |
| `npm run test` | PASS — 2088 |
| CI (PR #45) | PASS — 14/14 |
| Phase-1B-blocking P0 | **NONE** |

The gate that closed last was G2: `devices.status` had been guarded by a custom
GUC, which is not a privilege — any session can set one. It is now guarded by a
column-level `GRANT`, so `status` is unwritable by an authenticated session
before any trigger runs. See `036_e2ee_device_status_privilege.sql`.

**Frozen means frozen for feature development, not verified for production.**
Known non-blocking backlog, none of which gates Phase 1B:

- P2 — `app.trip_item_reorder` is a forgeable GUC with no role conjunct, but it
  gates an ordering column behind RLS, so it authorises nothing.
- P2 — the four `set_config('gomsinlog.e2ee_status_transition', …)` calls in
  035 are inert; 036 removed the only reader. Left in place rather than rewrite
  four security-critical function bodies to delete a no-op.
- The P1 production blockers in §12 and §13 remain open, and an independent
  security review is still required before any launch.

Related: `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md` (scope and
legal framing), `docs/E2EE_1A1_SPIKE_REPORT.md` (measured platform facts),
`docs/E2EE_IMPLEMENTATION_PLAN.md` (SUPERSEDED — single-couple-key design).

---

## 1. Executive decision

A four-domain, hardware-handle-rooted key hierarchy with per-object DEKs, signed
and fully bound key envelopes, an asymmetric challenge-response recovery
identity, and pairing that gates couple-key creation behind two independent
human verifications.

1. **Device identity private keys never enter TypeScript.** `dev_sig` (ECDSA
   P-256) and `dev_kem` (ECDH P-256) are opaque handles in Secure Enclave,
   StrongBox/TEE, or — on web — a non-extractable `CryptoKey`.
2. **Scope keys are portable and are described as such.** PMK, HRK and CSK must
   reach new devices, so they are never called non-exportable. At rest they
   exist only as envelopes wrapped to a `dev_kem` handle.
3. **No bearer credential exists in the recovery path.** Recovery is an ECDSA
   signature over a fresh server challenge transcript.
4. **CSK cannot exist before both partners confirm the same transcript.**
5. **Every envelope is fully bound and signed** with an exact canonical byte
   layout — no JSON.
6. **Rotation is domain-aware**, driven by a per-scope epoch state machine.
7. **Plaintext-overwrite protection lives in the database.** A row written
   encrypted can never be written plaintext again.

Not claimed: forward secrecy for envelope recipients, guaranteed JS
zeroization, rollback resistance after device loss, operator-assisted recovery.

## 2. Key hierarchy

```
Device (hardware handles; private material never crosses into TypeScript)
  dev_sig  P-256 ECDSA      device authentication, all protocol signatures
  dev_kem  P-256 ECDH       envelope recipient
  LCK      AES-256          local cache/draft/outbox encryption
       │ unwraps (GLK2: ephemeral-static ECDH → HKDF-SHA-256 → AES-256-GCM, ECDSA-signed)
       ▼
Portable scope keys (independently random, wrap-only, epoched)
  PMK[user, epoch]   HRK[user, epoch] ──derives──▶ HIdxK[table.field, epoch]
  CSK[couple, epoch]
       │ wraps
       ▼
DEK (AES-256, fresh per object) ── encrypts content (GLE1)

Recovery identity (per user)
  rec_sig P-256 ECDSA   challenge-response authentication, certificate root
  rec_kem P-256 ECDH    recovery envelope recipient
  private material = AES-256-GCM(RKEK, priv); RKEK = HKDF(256-bit kit secret)
```

PMK, HRK and CSK are drawn independently; none derives from or reaches another.

## 3. Device trust — the certificate graph

`devices.status` is **operational metadata only** and has no cryptographic
authority anywhere. Trust is a signature chain terminating at the account's
`rec_sig` key, whose fingerprint the verifier has pinned — locally at
provisioning, or via a SAS-confirmed pairing transcript for a partner.

**GLDC1** — 317-byte canonical body + 64-byte issuer signature + 64-byte subject
proof-of-possession = **445 bytes**. Fields: magic, cert/protocol/suite version,
issuer kind, subject assurance, subject platform, granted-domain mask, reserved,
user id, server origin id, recovery identity id, recovery version, root
`rec_sig` fingerprint, issuer id and fingerprint, subject device id and both key
fingerprints, validity window, ceremony nonce, ceremony transcript hash.

Verification: structure → chain consistency (user, origin, recovery identity and
version, root) → validity at the time of interest → revocation → subject PoP →
issuer signature → granted-domain non-escalation. Depth ≤ 8.

**This is the fix for the attack that broke V2**: a `service_role` inserting a
device row with `status = 'ACTIVE'` gains nothing, because no honest client
consults status when choosing envelope recipients.

## 4. GLK2 — key envelope

Fixed **360 bytes**: 171-byte canonical header, 65-byte ephemeral point,
12-byte nonce, 48-byte wrapped scope key, 64-byte signature.

```
Z    = ECDH_P256(eph_priv, recipient_kem_pub)      32-byte X coordinate
salt = SHA-256("gomsinlog/glk2/salt/v1" ‖ ephemeral_pub ‖ recipient_kem_spki)
info = "gomsinlog/glk2/kek/v1" ‖ H(171)
KEK  = HKDF-SHA-256(Z, salt, info, 32)
wrapped = AES-256-GCM(KEK, nonce, scope_key, aad = "gomsinlog/glk2/aad/v1" ‖ H ‖ eph)
sig     = ECDSA-P256-SHA256(dev_sig, "gomsinlog/glk2/sig/v1" ‖ H ‖ eph ‖ nonce ‖ wrapped)
```

Ephemeral-static ECDH gives **sender-side** forward secrecy and per-envelope KEK
independence. It gives the recipient none: an attacker with an archived envelope
who later compromises `dev_kem` recovers the scope key. That is why revoking a
compromised device requires epoch rotation, not envelope deletion.

## 5. GLE1 — content envelope

Header **92 bytes** (magic 4, format 1, protocol 1, suite 1, domain 1, flags 1,
reserved 3, key_epoch 8, dek_wrap_nonce 12, wrapped_dek 48, content_nonce 12),
then `ciphertext ‖ tag`. Total = 92 + plaintext + 16.

AAD binds protocol, suite, format, domain, epoch, owner, scope, object type and
id, field id, and a server-validated monotonic `content_revision`. It does not
bind `record_date`, `is_private` or `updated_at`, which are mutable; visibility
is enforced by the key domain, and the database refuses a private record wrapped
under a couple key outright.

Streaming is undefined. Phase 1A-1 found Tink Streaming AEAD on one of three
targets, so no chunking construction is specified. **Phase 1C remains
UNRESOLVED.**

## 6. SAS

Six zero-padded 3-digit groups — `123-004-998-231-042-551`. Space 10^18,
entropy **59.79 bits**, random-match probability 10^-18 per attempt. Derived
with rejection sampling above 18×10^18 to remove modulo bias. QR carries the
full 32-byte transcript hash. No auto-accept, no partial match.

## 7. Recovery kit

32 random bytes → **52** Crockford Base32 symbols + a 4-symbol, 20-bit checksum,
displayed as 14 groups of 4. Decoder rejects `U`, maps `I`/`L`→1 and `O`→0, and
rejects non-zero padding bits. The checksum is a typo detector, not integrity.

The kit is the external trust anchor: it carries `recovery_identity_id`,
`recovery_version` and `recovery_bundle_fp`, so a server serving an older
genuine bundle is detected. AEAD AAD binds identity, version and salt.

## 8. Epoch state machine

`PREPARING → READY → ACTIVE → RETIRED`, plus `PREPARING/READY → ABANDONED`.
`RETIRED` and `ABANDONED` are terminal — **`RETIRED → ACTIVE` is the
resurrection attack and is impossible**. Exactly one ACTIVE epoch per
(domain, scope), enforced by a partial unique index. Transitions occur only
through `e2ee_mark_epoch_ready`, `e2ee_activate_epoch` and `e2ee_abandon_epoch`;
`authenticated` has no UPDATE grant on `scope_keys`.

Retired epochs stay readable forever and are never deleted: historical
ciphertext needs them.

## 9. Ownership and deletion

| Class | Tables | On deletion of A |
|---|---|---|
| DEVICE OWNED | `devices`, `device_enrollments` | deleted |
| USER OWNED | `recovery_identities`, personal/health `scope_keys`, `migration_ledger` | deleted |
| RECIPIENT OWNED | `key_envelopes` | only rows whose recipient is A's device or recovery identity |
| **COUPLE OWNED** | couple `scope_keys` (`owner_couple_id`), `couple_key_epochs`, `crypto_pairings` | **retained while B remains** |
| HISTORICAL | `device_certificates`, `revocation_statements` | retained while referenced |

Couple scope keys carry **no foreign key to `auth.users`**. This is structural:
when they hung off `auth.users(id) ON DELETE CASCADE`, deleting A's Auth row
cascaded away the couple epochs and every envelope B held.

Certificate retention is a real FK — `key_envelopes.sender_certificate_id`
`ON DELETE RESTRICT` — not a cached counter that can drift.

Deletion aborts rather than orphan a surviving partner.

## 10. Write floor

Irreversible per scope, activated **before** the first encrypted write for that
scope (an encrypted write with no floor is refused, which forces the ordering).

Protected `daily_records` content: `log_text`, `reaction`, `attachments`,
`emotion_flow`, `record_time`. Accepted leakage: `record_date` (ordering),
`emotion_updated_at`, `talk_about`. Server metadata: ids, `is_private`,
timestamps, cipher routing columns.

After activation: an old client cannot INSERT plaintext, cannot modify a legacy
row while leaving any protected field plaintext, and no client can downgrade
ciphertext to plaintext. `is_private = true` ⇒ personal domain;
`is_private = false` ⇒ couple domain. Legacy plaintext stays readable.

## 11. Rollback guarantees — precisely

**Prevented**: ciphertext moved between objects, users, couples, domains,
epochs, fields or suites; envelopes re-addressed; replay of enrollment, pairing
or recovery transcripts; downgrade to a retired recovery bundle.

**Prevented only while local state survives**: replay of an older revision of
the same object.

**Not prevented**: after reinstall or recovery onto a new device, the server can
serve revision N−1 undetected; omission is indistinguishable from absence;
independent objects can be reordered. There is no authenticated history root in
Phase 1A. A per-scope signed manifest is the Phase 2 fix and is not claimed here.

## 12. Honest limits

- Revocation **withholding** by a malicious server is undetectable until the
  next ceremony. The hash-chained log detects deletion and reordering behind a
  pinned head, nothing more.
- Rotation protects content written after the new epoch is ACTIVE. Plaintext
  already read, keys already held, and ciphertext already copied stay exposed.
- Non-extractability prevents key export, **not** key use by same-origin script.
  Web is the weakest assurance class and health is off by default there.
- JavaScript offers no guaranteed zeroization; buffer overwrites are defence in
  depth, not a memory-safety guarantee.
- Losing every device and the recovery kit means the data is unrecoverable. The
  operator cannot help, ever.

## 13. Production operational requirement — issuer-device revocation

Revocation is **chain-wide**. `verifyCertificateChain` refuses any chain
containing a revoked link, so revoking a device also distrusts every device that
device certified. That is the conservative reading and it is deliberate: a
compromised device's issuances are suspect. It is not being changed here.

The consequence is operational, and it must be understood before Phase 1B ships
a revocation UI:

> **Re-rooting descendants through the recovery kit is required before an issuer
> device can be revoked, when doing so would strand surviving devices.**

Concretely: if A1 enrolled A2, revoking A1 leaves A2 with no valid chain. A
rotation performed in that state would build epochs only the recovery kit could
open — a lockout dressed up as a security action.

`revokeDeviceAndRotate` therefore performs a pre-flight and refuses with
`E_REVOCATION_WOULD_STRAND_ACCOUNT` **before persisting anything**, leaving the
account exactly as it was. The way out is a kit recovery, which issues a
recovery-rooted certificate for the surviving device and supersedes the rest.

This does not block Phase 1B development. It is a flow Phase 1B must present
honestly rather than a protocol defect, and the guard means the unsafe path
cannot be taken by accident in the meantime.
