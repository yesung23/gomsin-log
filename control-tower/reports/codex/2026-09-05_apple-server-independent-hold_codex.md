# Apple credential lifecycle independent review — HOLD

Reviewer Franklin SolMax; base `1c7503e620b9958adf3dad0b30f037bfea6b46c0` plus13-path server WIP.
Reviewed aggregate SHA `36bef70ca7227fa3c9f43909b02ff0d9d638245d3ee0bdd6baec31fe61de385a`.
Verdict: CRITICAL0 / HIGH3 / MEDIUM3 / LOW1. No remote change or release approval.

## Findings

1. HIGH: `/auth/token` success followed by verification/sub failure drops the obtained refresh token without
   durable encrypted retention or proven revoke (`apple-auth-credentials/handler.ts:232–257`). Re-registration
   overwrites prior encrypted generation (`091:329`), while deletion claims only the current row (`091:451`).
   Do not assume revoking a newer token revokes all prior sessions.
2. HIGH: second attempt-pruning DELETE includes `exchange_uncertain` (`091:168`) and defeats the earlier
   newest-marker preservation. Reviewer actual PG reproduction removed the only11-minute-old marker.
3. HIGH: deletion handler resumes advanced phases but Apple RPC accepts only `media_cleanup` (`091:426/520`).
   Reviewer PG reproduction at `e2ee_prepared` returned illegal phase; retry becomes503 even for Google-only
   users. Must preserve exact attempt fencing and idempotent terminal results, including pre091 advanced rows.
4. MEDIUM: permanently lost encryption key has no operator-reviewed manual recovery route, only endless
   `configuration_recovery`. Temporary configuration omission must still fail closed.
5. MEDIUM: optional server-ID audiences lack fixed redirect_uri required by web code exchange. Native
   app.gomsinlog is unaffected. Avoid advertising unsupported webOAuth capability.
6. MEDIUM: post-Apple E2EE cancellation/reconciliation error returns omit Apple manual guidance metadata
   (`delete-account/handler.ts:493/508/522/543/567`). Preserve structured result consistently.
7. LOW: provider timeout clears after response headers; a stalled response body has no deadline. Reviewer
   timeout20ms mock still pending at238ms.

Parent directly read the pruning/overwrite/phase guard/exchange catch/body-reader paths and accepts HOLD.
Reviewer reproduction commands/results have not all been rerun by parent; no claim of independent parent
runtime reproduction. Client credential handoff and deletion guidance consumer remain separate planned
release gates, not counted again as bounded server findings.

## Passing evidence and limits

Reviewer reports29 Apple Deno,71 deletion Vitest,5 deletion entrypoint,36 real-chain PG assertions passing.
Expanded ephemeral actor matrix68 assertions includes32denials across5RPCs and both private tables.
No confirmed RLS bypass. UID/sub binding, JWT checks and AES-GCM/AAD boundary were found appropriate.
Passing existing tests did not cover the defects above; expanded denial/race regressions must enter the
durable harness. Actual Apple tokens, hosted schema/provider and physical device remain UNVERIFIED.

Reviewer preserved13scope files but `npm run typecheck` updated ignored tsconfig.tsbuildinfo, violating
its read-only artifact limit. It was disclosed and not blindly reverted/deleted. Future read-only checks
must disable incremental writes or explicitly allow appropriate temporary output.

## Decision / next owner

Keep provider/flags/deployment/master HOLD. Franklin now has a bounded read-only Architect followup to
recommend coherent token-generation/quarantine/recovery/advanced-phase fixes, not another broad audit.
Aquinas remains sole test-infrastructure writer. After design and writer slot availability, delegate one
server fix owner; parent does not implement. Fresh independent final reviewer required after fixes.
Retain all existing user-content crypto/ownership/deletion fences. No automatic production backfill,
all-migration replay, new credential generation, key deletion or client-controlled recovery bypass.

Production NOT APPLIED. No stage/commit/push/merge. RC not complete.
