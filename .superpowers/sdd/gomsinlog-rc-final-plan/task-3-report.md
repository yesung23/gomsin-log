# Task 3 report — Apple IAP consumption/refund state-machine hardening

- Status: `DONE_WITH_CONCERNS`
- Worktree: `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`
- Branch: `codex/rc-v5-final-fixes`
- Required starting committed HEAD: `d9c5d3899ef5e8e90eb1261dc4d053cd5fe3204c`
- Implementation commit: `b30c2303b3e5536b7fe980b1590e071fd56f8253`
- Date: 2026-09-05 KST
- Remote/Production/App Store action: `NOT APPLIED / UNVERIFIED`

Task 3의 로컬 구현, SQL actor 검증, Edge/app 경계, frozen Deno lock과 운영 문서를
완료했다. 판매는 앱·DB에서 계속 기본 OFF이며 sale-activation migration은 만들지 않았다.
법적 notice 값, retention 기간, scheduler secret/cron 활성화, 실제 fulfillment caller,
원격 migration/Edge canary, Apple Sandbox/TestFlight/Production 증거는 의도적으로 만들거나
추정하지 않았으므로 상태를 `DONE_WITH_CONCERNS`로 둔다.

## Direction and scope check

- Product source checked: `docs/PRODUCT_V5_MASTER_DECISION.md`,
  `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`, Task 3 brief and architecture
- Current-state checked: repository, exact branch/HEAD/status, `docs/CURRENT_STATE.md`
- Latest relevant Work Log checked: 2026-09-04 RC reliability/IAP predecessor entry
- Canonical direction conflict: `NO`
- Book Studio, Garden, unrelated auth/E2EE, visual design, global product state: unchanged
- Forbidden build/offline, migration-080 and Control Tower paths: neither edited by Task 3 nor staged
- Subagents and remote services: not used

## Exact changed files and why

| File | Task 3 reason |
|---|---|
| `.gitignore` | Keep nested incidental Deno locks ignored while narrowly unignoring root `deno.lock`. |
| `deno.lock` | Pin the direct `npm:node-fetch@2.7.0` specifier and all frozen IAP entrypoint resolution. |
| `package.json` | Make `check:iap`/`test:iap` use the committed frozen lock and include all four IAP entrypoints and covering tests. |
| `scripts/phase0/apple-iap-ledger-harness.mjs` | Add PostgreSQL actor tests for V2 ledger, authorization, races, unknown transport, tokenless/deleted identities, consent, fulfillment, operations, mixed-version rollout and rollback. |
| `src/lib/iap/adapters.ts` | Add the exact reviewed notice version/hash consent port; no notice content or account identity is accepted from callers. |
| `src/lib/iap/adapters.test.ts` | Exercise real adapter request/response behavior for consent state and decision. |
| `src/lib/iap/runtime.ts` | Expose the consent adapter only through the existing iOS-native IAP runtime boundary. |
| `supabase/config.toml` | Register the new consumption Edge function; this does not configure or activate cron. |
| `supabase/functions/_shared/appleIapContract.ts` | Bound quantity, revocation and consumption-reason claims; reject unsupported Non-Renewing Subscription. |
| `supabase/functions/_shared/appleIapVerifier.ts` | Normalize only the bounded verified Apple claims needed by the V2 ledger. |
| `supabase/functions/_shared/appleIapVerifier_test.ts` | Cover unsupported product type and valid/invalid bounded quantity, revocation and reason claims. |
| `supabase/functions/_shared/appleIapServerApi.ts` | Add bounded Apple consumption sender, real request cancellation and epoch-millisecond/HTTP-date Retry-After parsing. |
| `supabase/functions/_shared/appleIapServerApi_test.ts` | Cover Apple hosts, Retry-After edge cases, timeout cancellation, credential and environment rejection. |
| `supabase/functions/apple-iap-entrypoints_test.ts` | Include the consumption entrypoint in real Deno fail-closed startup/auth coverage. |
| `supabase/functions/apple-iap-notifications/handler.ts` | Capture trusted ingress time and return retryable non-2xx for required missing/unverified nested transactions. |
| `supabase/functions/apple-iap-notifications/handler_test.ts` | Cover required/informational notifications, ingress timing, verification, idempotency and retry behavior. |
| `supabase/functions/apple-iap-notifications/index.ts` | Persist the bounded verified notification through the V2 atomic RPC. |
| `supabase/functions/apple-iap-notifications/rpc.ts` | Map verified tokenless transaction identity without inventing an account binding. |
| `supabase/functions/apple-iap-notifications/rpc_test.ts` | Cover bounded consumption/refund mapping and tokenless identity preservation. |
| `supabase/functions/apple-iap-reconcile/handler.ts` | Isolate each target and return aggregate counts so one target failure does not stop later targets. |
| `supabase/functions/apple-iap-reconcile/handler_test.ts` | Cover per-target continuation, target-list failure, authentication and deduplication. |
| `supabase/functions/apple-iap-reconcile/index.ts` | Ingest verified history through V2 and propagate quantity/revocation claims. |
| `supabase/functions/apple-iap-sync/handler.ts` | Add exact notice consent state/decision actions while preserving authenticated transaction verification. |
| `supabase/functions/apple-iap-sync/handler_test.ts` | Cover consent action validation and existing sync failure/identity behavior. |
| `supabase/functions/apple-iap-sync/index.ts` | Wire authenticated consent RPCs and V2 transaction ingestion. |
| `supabase/functions/apple-iap-consumption/handler.ts` | Implement secret-gated claim/authorize/send/complete drain, bounded alerts and no-action review acknowledgement. |
| `supabase/functions/apple-iap-consumption/handler_test.ts` | Cover immutable body, deadline, retry/unknown outcomes, authorization expiry, bounded alerts and acknowledgement. |
| `supabase/functions/apple-iap-consumption/index.ts` | Wire service-only V2 RPCs and Apple sender, including attempt/body completion credentials. |
| `supabase/migrations/079_apple_iap_refund_consumption.sql` | Add the additive V2 ledger/state machine, sale hold, exact credit lots, consent/evidence/review paths, lock ordering and mixed-version quarantine. |
| `supabase/migrations/081_retire_apple_iap_v1_entrypoints.sql` | Contract only the two V1 external service-role signatures after V2 canary; retain their functions/internal use. |
| `supabase/migrations/README.md` | Record 079/081 semantics and `NOT APPLIED / UNVERIFIED` state. |
| `docs/operations/apple-iap-rollout-runbook.md` | Define expand/deploy/contract, forward-only recovery and external activation gates. |
| `docs/operations/rollback-runbook.md` | Link the IAP-specific recovery rules and unknown-result resend prohibition. |
| `.superpowers/sdd/gomsinlog-rc-final-plan/task-3-report.md` | This factual implementation and verification report. |
| `docs/WORK_LOG.md` | Mandatory session ledger entry for the committed Task 3 gate. |

## TDD RED evidence

Each item below was observed before its corresponding production/SQL behavior change. Existing
green tests were not counted as RED.

| Behavior test added first | Intended RED observed |
|---|---|
| Numeric Retry-After at `now + 120s`, past, malformed and far-future values | Focused Deno run: 5 passed, 1 failed; expected `120`, got `43200`. |
| Reject Non-Renewing Subscription at the Edge contract | Verifier run: 8 passed, 1 failed; unsupported type returned `true`. |
| Required REFUND/REVOKE/REFUND_REVERSED/CONSUMPTION_REQUEST nested transaction | Notification run: 10 passed, 1 failed; REFUND returned `200` instead of retryable `503`; unverified nested path initially returned `400` instead of `503`. |
| DB actor rejects required notification without a nested transaction | Ledger harness failed after 237 assertions because the REFUND call succeeded. |
| Reconcile continues to the next target after one target fails | Reconcile run: 3 passed, 1 failed; whole request returned `503` instead of aggregate `200`. |
| Edge RPC keeps verified tokenless refund identity | RPC run: 2 passed, 1 failed; mapped transaction identity was `null`. |
| DB resolves only an exact unique tokenless server transaction | Ledger harness failed after 252 assertions with `Assignable verified transaction claims are incomplete`. |
| Exact late completion and attempt-1/attempt-2 isolation | Ledger harness failed after 327 assertions because the required 8-argument completion RPC did not exist. |
| Edge completion propagates attempt number and immutable body hash | Consumption handler run: 11 passed, 1 failed; completion fields were missing. |
| 079 expand preserves V1 service-role compatibility | Ledger harness failed after 229 assertions with V1 privileges `false|false`. |
| Database sale hold cannot be opened by catalog edit | Ledger harness failed after 234 assertions because `sale_enabled = true` succeeded. |
| V1 consumable input cannot create a pooled grant | Ledger harness failed after 233 assertions because a pooled credit was granted. |
| 081 contract retires only V1 external service entrypoints | Ledger harness failed after 407 assertions with V1 privileges still `true|true`. |
| Consent state and decision actions | Sync runs failed first at 9 passed/1 failed and then 10 passed/1 failed, each returning `400` instead of `200`. |
| Authenticated DB consent state | Ledger harness failed after 274 assertions because the state RPC did not exist. |
| App consent adapter | Vitest: 3 passed, 1 failed; `loadRefundDataConsent` was absent. |
| Bounded operational alerts and review acknowledgement | Consumption runs failed first at 12 passed/1 failed and then 13 passed/1 failed; alerts returned drain counts and acknowledgement returned `400`. |
| Service-only DB operations RPCs | Ledger harness failed after 269 assertions because `iap_list_operational_alerts` did not exist. |
| Frozen lock for all IAP entrypoints | Frozen `deno check` exited 1: lockfile out of date, requiring direct `npm:node-fetch@2.7.0`. |
| Deleted-account token-bound refund/revoke/reversal leaves bounded evidence | Final actor audit failed after 377 assertions: `deleted token-bound account refund/revoke evidence was not durably bounded`. |

The last RED was fixed minimally by inserting an `ACCOUNT_DELETED` review fact for a matched,
deleted token-bound account before acknowledging the notification. The same actor test then passed
without changing or regranting its transaction.

## GREEN verification

| Command | Result | What it proves |
|---|---|---|
| `npm run check:iap` | PASS | Frozen-lock Deno type resolution for sync, notifications, reconcile and consumption entrypoints. |
| `npm run test:iap` | PASS — 59 passed, 0 failed | Edge/shared runtime behavior for verification, sync, notifications/RPC mapping, reconcile, consumption, Retry-After and fail-closed entrypoints. |
| `npm run test:iap:ledger` | PASS — 435 PostgreSQL actor assertions | Local migration 077→079→081 behavior, actor privileges, state/lock races, exact accounting, sale hold, mixed versions and forward rollback simulation. Expected denied SQL probes appear as PostgreSQL errors and count as negative-test evidence. |
| `npx vitest run src/lib/iap/adapters.test.ts src/lib/iap/runtime.test.ts` | PASS — 2 files, 7 tests | App adapter/runtime contract, including exact notice state/decision wiring. |
| `npm run typecheck` | PASS | Current dirty worktree's TypeScript graph, including separately owned pre-existing changes. |
| `npx eslint src/lib/iap/adapters.ts src/lib/iap/adapters.test.ts src/lib/iap/runtime.ts` | PASS | Scoped ESLint policy for changed application files. |
| `deno fmt --check --single-quote --line-width 100` on the 20 changed IAP Deno files | PASS — Checked 20 files | Scoped Deno formatting. An earlier formatting check failed on 18 files; formatting was applied only to Task 3 files and the check was rerun green. |
| `node --check scripts/phase0/apple-iap-ledger-harness.mjs` | PASS | Harness JavaScript syntax. |
| `git diff --check` | PASS | Working patch whitespace before staging. |
| `git diff --cached --stat`; `git diff --cached --check`; explicit forbidden-path match | PASS — 33 implementation files; no whitespace error; no forbidden path staged | Exact implementation staging boundary before commit `b30c2303b3e5536b7fe980b1590e071fd56f8253`. |

Not executed: the full web Vitest suite, full repository ESLint and production build. They are outside
the focused Task 3 acceptance commands and this worktree contains separately owned forbidden
build/offline changes. No result from those paths is represented as Task 3 evidence.

## State machine and lock order

### Notification and identity boundary

- HTTP ingress time is captured before JWS verification and becomes the immutable consumption
  `received_at`; Sandbox gets five minutes and non-Xcode server environments get twelve hours.
- REFUND, REVOKE, REFUND_REVERSED and CONSUMPTION_REQUEST require a cryptographically verified
  nested transaction. Missing/unverifiable nested data returns retryable non-2xx and writes nothing.
- TEST and transactionless summary notifications remain informational 200 paths.
- A verified tokenless refund/revoke/reversal can use only one exact existing server-owned
  environment + transaction/original identity + product + bundle binding. Zero/multiple matches
  create a service-only bounded review fact and grant nothing.
- Deleted-account tokenless and token-bound refund/revoke/reversal events append only bounded
  `ACCOUNT_DELETED` review evidence and never restore entitlement or credits.

### Consumption states

```text
pending_evidence -> queued -> in_flight -> send_started
                    |             |            |
                    |             |            +-> accepted
                    |             |            +-> retryable_failed (known retryable result)
                    |             |            +-> terminal_failed (known definitive 4xx)
                    |             |            +-> send_result_unknown (never auto-resend)
                    |             +-> retryable_failed (lease expired before send)
                    +-> skipped/cancelled/expired/manual_review
```

- The first authorized send recomputes server-owned consent, transaction, fulfillment and exact
  usage evidence, freezes one canonical body hash, and only then enters `send_started`.
- Known-result retries reuse the frozen body. A new attempt replaces completion credentials rather
  than inheriting them with `COALESCE`.
- Sweeper quarantine stores only hashes of the current attempt number, lease, authorization and
  immutable body, then clears plaintext tokens. `send_result_unknown` is not claimable.
- A late result converges only when all four current-attempt values match. Wrong/stale lease,
  authorization, body or attempt is rejected; attempt 1 cannot complete attempt 2.
- Evidence or exact transaction arrival wakes matching `pending_evidence` work. Consent withdrawal,
  notice replacement and deletion cancel or skip before a new send authorization.

### Canonical lock order

Account-sensitive writers first acquire
`pg_advisory_xact_lock(hashtextextended(user_id::text, 15013))`, then lock the account binding, then
the operation-specific request/reservation/transaction/lot rows. Original-transaction serialization
is acquired only after the account lock. Consent, fulfillment, reserve/release, transaction apply,
send authorization and account deletion therefore share one account ordering. `send_started` is the
external-I/O linearization point; no transaction/request row lock is held before waiting on the
canonical account lock.

## Expand / deploy / contract and recovery

1. Apply 079 only after a remote read-only preflight and backup/recovery check. It is additive,
   forces all catalog rows to `sale_enabled = false`, keeps both V1 service entrypoints executable,
   quarantines V1 consumables, and adds V2 private state/RPCs.
2. Deploy exact V2 sync, notifications, reconcile and consumption artifacts. Keep the scheduler OFF
   and canary all V2 paths without opening sales.
3. Apply 081 only after V2 canary evidence. It revokes `service_role` execute from the two V1 external
   signatures only; it does not drop helpers, V2 grants, history or the sale hold.
4. No 082 exists in this task. Any future sale activation requires a separately approved migration.

Recovery is forward-only. Before 081, stop scheduler and restore a compatible Edge artifact while
leaving additive DB evidence intact. After 081, keep sales/scheduler stopped and restore V2-compatible
Edge. If V1 Edge is unavoidable, a new reviewed migration may temporarily restore only the two V1
grants while retaining the sale hold and V1-consumable quarantine, followed by another forward revoke.
Never drop or rewrite ledger history.

## Real call paths versus external gates

Implemented local call paths:

- iOS IAP runtime -> app adapter -> authenticated `apple-iap-sync` -> exact notice consent state/set RPC.
- Apple notification POST -> outer/nested JWS verification -> bounded V2 atomic notification RPC.
- Secret-gated consumption worker -> claim -> account-locked authorization/body freeze -> Apple V2
  Server API -> exact completion; the same operator boundary exposes bounded alerts and no-action
  review acknowledgement.
- Secret-gated reconcile -> per-target Apple history -> verification -> V2 ingest with aggregate-only
  results.
- Authenticated reserve -> authoritative artifact generation/storage by a trusted service ->
  service-only `iap_export_credit_commit_after_fulfillment`; failure uses release and cannot record
  `DELIVERED`.

External activation gates deliberately left open:

- approved legal notice text, exact version/hash and retention decision;
- an actual UI presenting that reviewed notice;
- authoritative artifact generation/storage caller (Book Studio was explicitly out of scope);
- scheduler secret, one-minute single-flight cron, alert delivery and operator rehearsal;
- remote migration catalog/preflight, backup/PITR and 079/081 rehearsal/application;
- deployed Edge artifact versions and canary;
- Apple credentials, App Store Connect contracts/products, Sandbox/TestFlight and real-device
  purchase/restore/refund behavior;
- Production migration/provider/sale activation and Apple's actual refund outcome.

## Evidence boundaries and remaining risks

- `LOCAL REPOSITORY`: implementation commit exists and sale activation is absent.
- `LOCAL TEST`: the commands/counts above are verified on an ephemeral local PostgreSQL 17.10 and
  local Deno/Vitest/TypeScript tools.
- `REMOTE SUPABASE / EDGE`: `NOT APPLIED / UNVERIFIED`; neither read nor changed.
- `PRODUCTION`: `NOT APPLIED / UNVERIFIED`; no deploy, secret, cron, provider or sale action.
- `APP STORE / SANDBOX / DEVICE`: `UNVERIFIED`; no credentials or external console/device used.
- `LEGAL / RETENTION`: `UNVERIFIED`; no text, version, hash or duration was fabricated.
- `FULFILLMENT`: DB service boundary is verified locally, but no live artifact delivery caller is
  connected or claimed.
- `REVIEW`: this critical DB/authorization diff has not received a fresh independent exact-HEAD
  security review because the controller explicitly prohibited subagents in Task 3. Earlier reviews
  are stale for these changed semantics.
- The Deno tests emit an upstream `punycode` deprecation warning; tests pass and no runtime failure
  was observed, but dependency replacement was outside this narrow task.
- The separately owned migration-080 file remains uncommitted and untouched. Any remote rollout must
  preflight the actual migration catalog rather than infer order from this worktree.

No Sandbox or Production purchase is safe to enable until every external gate above has direct,
current evidence and a fresh exact-HEAD critical security review reports no blocking finding.
