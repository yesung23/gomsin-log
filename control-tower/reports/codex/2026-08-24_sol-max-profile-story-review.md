# 2026-08-24 — profile username / post / story highlight review

## REQUEST

이번 작업의 독립 검증과 최적화에 `kiro/gpt-5.6-sol` 모델, `max` 추론을 사용해 달라는 요청을 받았다.

## SOL MAX DISPATCH

- Attempt 1: agent `01a0313b-f306-7ec0-90cc-b262cf2eb88e`, `fork_context: true`.
  - **FAIL** — provider returned `502 Bad Gateway: Provider unreachable: Kiro does not support parallel tool calls`.
- Attempt 2: agent `01a0313c-f293-7dd0-8ba1-ebc7816ef76e`, `fork_context: false`.
  - **FAIL** — the same provider `502` error.
- Attempt 3: agent `01a03149-8db0-7673-8850-1adea76754f6`, `fork_context: false`, with an explicit instruction to use one tool call at a time.
  - **FAIL** — the same provider `502` error: `Kiro does not support parallel tool calls`.
- No Sol Max completion, finding, or PASS result is claimed. The failed dispatches were closed after recording the errors.

## PRIMARY READ-ONLY REVIEW

The primary agent independently inspected the current working tree and real call paths.

### Username authority

- `SettingsPage` exposes the partner username editor in both the settings section and the profile edit modal.
- `setPartnerUsername` calls the existing partner-scoped RPC and updates the local couple projection only after a successful response.
- `sync.ts` first reads `get_partner_profile_with_username()` and falls back only for `PGRST202`; auth, RLS, and other server errors remain sync failures.
- Migration 059 derives the target from the caller's active couple and locks the couple row. The owner-side direct username update remains blocked by the existing trigger.
- Migration 060 does not widen direct `profiles` SELECT/RLS. It exposes only the active partner projection, is `SECURITY DEFINER`, pins `search_path` to `public, pg_temp`, revokes PUBLIC/anon/authenticated before granting authenticated, and reloads PostgREST.

### Grid / highlights / story

- `SharedProfile` now sends all shared photo records to `PostGrid`; travel-date filtering is removed.
- The unused `isTravelRecord` runtime helper and its obsolete unit tests were removed so future changes do not accidentally restore travel-only behavior.
- Highlight selection remains a separate `couple_highlights` record-level model. The editor can select grid photos.
- A shared photo moment in `StoryViewer` exposes `하이라이트에 추가`, which navigates with the exact record ID to the same profile highlight editor.
- Private records are excluded by the route's visibility projection and by the StoryViewer guard. Highlight mode does not receive the add action.
- The existing highlight RPC, child-row policy, and private-transition pruning remain the server boundary; no duplicate media table was invented.

## FINDINGS

### P1 — remote migration boundary remains open

`060_partner_username_projection.sql` is present locally and is included in the fresh-chain harness, but this agent did not apply it to the production Supabase project. The user previously reported completion for the earlier 057–059 work; 060 is new in this task. Until 060 is applied and the authenticated two-account path is checked, a reload cannot reliably show the partner's current username. The legacy `PGRST202` fallback is intentionally fail-safe but cannot return a username.

Minimum action: apply 060 through the approved Supabase release process, then verify one active A/B pair, a former partner, an unrelated account, and anon.

### P2 — physical phone identity is not provable by the current web auth model

The implementation authorizes the active partner account/session, not a claim that the request came from a particular physical phone. This is the safe boundary available from the current model. Enforcing “only on the other phone” would require a separately designed device binding and recovery policy; it was not invented here.

### P2 — highlight selection is record-level

`CoupleHighlight` stores record IDs, not attachment IDs. A multi-photo post can be selected as a highlight item, but its cover uses that record's first photo. Selecting an individual second attachment requires an approved media-item data model and migration; adding one opportunistically would violate scope and privacy review boundaries.

### P2 — avatar synchronization remains pre-existingly device-local

Removing the camera badge does not change the existing avatar storage boundary. Cross-device profile-photo synchronization is not established by this work.

## OPTIMIZATIONS ACCEPTED

- Removed the now-unused travel classifier and its tests.
- Added actor-based 060 probes to the phase0 throwaway PostgreSQL harness: active A/B projection, unrelated C, anon denial, and disconnected partner exclusion.
- Did not add a duplicate post/story media model, likes, views, followers, relationship scores, or a new highlight table.

## VERIFICATION

- Focused Vitest: **PASS** — 7 files, 171 tests.
- Phase 0 fresh-chain harness after 060 actor probes: **PASS** — 58 migrations, 333 assertions.
- `npm run verify`: **PASS** — typecheck, lint, 231 Vitest files / 3279 tests, and production build.
- `git diff --check`: **PASS** after the final working-tree edits.
- Production Supabase and Vercel: **NOT APPLIED** by this task.

## REVIEW CONCLUSION

No additional application-code fix was required after the primary review. The current implementation is the smallest safe path for the requested username discoverability, all-photo grid, and story-to-highlight entry without weakening the existing owner/couple/privacy boundaries. The remaining blockers are remote application/verification of migration 060 and the explicitly unresolved device-binding and attachment-level highlight decisions.
