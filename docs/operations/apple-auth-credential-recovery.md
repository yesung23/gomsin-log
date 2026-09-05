# Apple authentication credential recovery

This runbook is for service operators handling encrypted Sign in with Apple refresh-token custody.
It does not enable Apple login, call Apple, apply a migration, or prove provider revocation.

## Safety boundary

- Never place an authorization code, refresh/access/identity token, Apple private key, client secret,
  encryption key, ciphertext, nonce, user content, email, or real user identifier in a ticket or command log.
- Work from an approved non-sensitive evidence reference and exact internal UUIDs supplied through the
  protected operator console. Do not copy identifiers into chat or this document.
- Take and verify a database backup before any hosted migration or recovery operation. Preserve every
  encryption key referenced by a non-revoked token row.
- The operator RPC can resolve only `manual_required` or `not_required`. It cannot claim `revoked`;
  only a confirmed Apple HTTP 200 completion can do that.
- Use the exact live account-deletion attempt. A stale attempt or mismatched token/key must remain rejected.

## Key rotation

1. Back up and verify the current database and secret-manager configuration.
2. Add the new 32-byte AES key under a new key ID while retaining all old key IDs.
3. Deploy the expanded key map, then switch `APPLE_AUTH_CREDENTIAL_ACTIVE_KEY_ID` to the new ID.
4. Confirm new registrations use the new ID and deletion can still decrypt rows using each old ID.
5. Remove an old key only after a service-only inventory proves that no non-revoked token references it,
   backup retention covers rollback, and the change has passed a separate review.

Missing key material is initially a configuration-recovery condition. Restore the correct secret-manager
version and retry the same deletion fence. Do not classify a temporary omission as permanent loss.

## Permanent key-loss review

Use `KEY_IRRECOVERABLY_LOST` only after backup and secret-manager history have been reviewed and the exact
token row still references the missing key ID. Record a non-sensitive ticket/reference and evidence time.
Invoke `apple_auth_operator_resolve_deletion` through the protected service-role operator path with the exact
user, deletion attempt, token and key bindings. A successful result is `manual_required`, never `revoked`.
The accepted decision is written atomically to that token row: `revoke_attempt_id` retains the original
decision attempt, `last_error_code` retains `KEY_IRRECOVERABLY_LOST`, and the bounded evidence reference and
evidence time remain token-specific. If another token is still unsettled, the RPC returns `retry_required`
after committing this token's evidence; settle every remaining token under the same fence. Token B evidence
must never replace token A evidence.

An identical retry with the exact user, attempt, token, key, reason, reference and evidence time is a
read-only replay. A changed argument or a new deletion attempt is stale and must not change the evidence,
reason or `updated_at`. Resume the same deletion phase and fence; the normal delete handler will replay the
durable aggregate manual outcome only after all provider work has settled.

## Pre-091 deletion inventory

Migration 091 existing in Git or in a catalog is not evidence that an older Apple credential was revoked.
For an advanced deletion fence with no durable Apple result:

1. Pause automatic progression at `operator_review_required`.
2. Verify the exact deletion attempt and inspect approved admin identity/provider evidence without exporting
   token material or personal data.
3. If verified evidence proves there was no Apple provider, resolve `PRE091_NO_APPLE_PROVIDER`; the durable
   outcome is `not_required`.
4. If Apple usage is known or cannot be excluded and no credential exists, resolve `PRE091_NO_TOKEN`; the
   durable outcome is `manual_required` with user guidance.
5. Resume the same advanced phase. Do not rewind to `media_cleanup` and do not make a provider call from an
   advanced phase.

Direct pre-091 decisions store their reference and evidence time on the account state, separately from the
database's actual resolution timestamp. Those account evidence fields are only for direct no-token operator
decisions. Key-loss evidence remains on each token row; aggregate provenance identifies token evidence and
does not copy the last token's reference onto the account.

## Verification and rollback

After any operator resolution, read back only the non-sensitive outcome, reason, provenance, evidence time,
origin attempt and replay attempt. Confirm ciphertext was removed only for rows with confirmed HTTP 200.
The private database evidence is deleted by the Auth-user cascade when account deletion completes. A
protected external ticket/reference is therefore required for any approved post-deletion operational record;
this migration does not create or claim an external ticket service or indefinite database retention.
If validation fails, stop and preserve the fence, rows, keys and backup. Roll back application routing by
disabling the caller; do not drop private tables or delete old keys while any credential remains unsettled.
