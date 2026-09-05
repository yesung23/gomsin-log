# [GOMSINLOG CONTROL TOWER]

## Current State

- Worktree: `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`
- Branch: `codex/rc-v5-final-fixes`
- Implementation HEAD: `9cd0686d86b83b062301fc0dcb9e2e00f7235b03`
- Scope: app repository Apple IAP refund/consumption evidence and reconciliation safety only
- Production/Supabase/Apple remote actions: **NOT APPLIED / UNVERIFIED**
- Customer sales: closed by database sale hold

## Findings

1. Commit `5a76bdd` had evolved historical migration 079 in place. That is unsafe for an already-applied migration because fresh installs and upgraded databases can diverge.
2. The previous reconciliation cursor was attached to an app billing account even though one app account can present transactions from more than one Apple customer. That creates a cross-account attribution and missed-history risk.
3. Per-item writes followed by a separate cursor update allowed partial page success or response loss to create an ambiguous retry state.
4. Consumption and reconciliation workers needed ingress-based time budgets and real abort signals so irreversible Apple calls are not started too close to Edge termination.
5. App account token hashing was implemented in more than one path and needed one lowercase UUID contract.

## Decision

- Restore 079 exactly and move every schema/contract change to migration 082.
- Treat `(environment, original transaction chain)` as the durable reconciliation unit.
- Resolve each verified transaction through its own pseudonymous appAccountToken hash; isolate missing, unknown, deleted, or conflicting identity as review evidence instead of guessing.
- Apply a complete Apple history page and advance its revision in one database transaction, with deterministic same-page response-loss replay.
- Limit each Edge invocation to one target/job and reserve enough time for durable finalization.
- Keep all product sale gates closed until Production, Apple, legal, and operational gates are separately verified.

## Changes

- Added forward migration 082 with predecessor preflight, checkpointing, atomic settlement, review facts, replay state, RLS, role revocation, and service-only RPCs.
- Restored migration 079 byte-for-byte to SHA-256 `cda1defda9d197c91a997d0ff4e6f669e5edaa65dbd0fd5737ec69505d5dc132`.
- Reworked reconciliation and consumption workers around monotonic ingress budgets, one-unit execution, bounded Apple calls, and bounded Supabase RPCs.
- Centralized lowercase UUID account-token hashing.
- Expanded the real PostgreSQL actor harness and Edge/static tests.

## Verification

- `npm run test:iap:ledger`: **PASS — 500 assertions** on PostgreSQL 17.
- `npm run check:iap && npm run test:iap`: **PASS — 83 tests**, four IAP entrypoints checked.
- Focused Vitest security/migration/admin timeout set: **PASS — 215 tests**.
- `npm run typecheck`, scoped ESLint, Node harness syntax, staged diff check: **PASS**.
- Migration 079 parent comparison/hash: **PASS**.
- Remote Supabase, deployed Edge, Apple Sandbox/Production, StoreKit/device refund flow: **NOT APPLIED / UNVERIFIED**.

## Risks

- This is security- and money-sensitive code; an exact-HEAD independent Sol Max review is mandatory before remote application.
- Production schema fingerprint and migration order have not been read from the remote project in this gate.
- Apple credentials, products, Server Notifications V2, scheduler, Sandbox refund, and device behavior remain external/manual gates.
- Sale must remain disabled until those gates, legal notice/retention, customer support, and rollback operations are proven.

## Current Score

- Product: 7.8/10 — purchase value direction exists, but customer IAP remains intentionally unavailable.
- UX: 7.7/10 — no customer-visible flow changed in this gate.
- Design: 7.8/10 — no visual changes in this gate.
- Engineering: 8.6/10 — forward-only migration history, atomic page semantics, and bounded workers now have strong local evidence.
- Security: 8.4/10 — cross-account attribution and service authorization are substantially hardened; remote and independent review remain open.
- Release readiness: 7.4/10 — local IAP gate is strong, but Production/Apple/device and remaining whole-app blockers are not complete.

## Next Highest-ROI Goal

Run an independent exact-HEAD Sol Max review. If it reports no CRITICAL/HIGH issue, close any lower-severity correctness deltas and move to the next app data-integrity blocker: atomic record/media deletion with recoverable Storage cleanup, without exposing private media or rewriting existing migrations.
