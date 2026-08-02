# GomsinLog v1 completion audit

Baseline: `kiro/web-app-completion-v2` @ `0ba6e8c8494ada3041c7e144e36c2a94541ec2c2`
(38 test files / 448 tests passing, typecheck + lint clean).

Every finding below was read in source on that commit. `CONFIRMED-IN-SOURCE` means the
file:line reference was opened and the behaviour verified, not inferred from documentation.

Classification:

- **defect** — a user-visible wrong outcome or a dead end.
- **incomplete** — the journey exists but stops short of what the schema/UI/types already imply.
- **acceptable** — found by the discovery greps and deliberately left alone.

Status is closed out at the bottom of this document.

---

## 1. Couple lifecycle

### F1 (defect, CONFIRMED-IN-SOURCE) — creator who abandons onboarding after step 3 is permanently stuck

`src/lib/sync.ts:26` returns `null` when the `profiles` row is missing, **before**
`couple_members` is read. `create_couple_and_invitation` (015 §"create_couple_and_invitation")
has already inserted the couple and the creator's `active` membership at that point, so:

1. `fetchFullStateFromDB` → `null` → the store treats the account as brand new
   (`src/lib/store.tsx`, `if (!dbState)` branch) → onboarding restarts.
2. Onboarding step 3 calls `createCoupleInvitation` again
   (`src/pages/OnboardingPage.tsx:137-152`), which raises
   `User already in an active couple`.
3. `src/pages/OnboardingPage.tsx:141` shows that raw message in a toast and returns.
   There is no recovery affordance anywhere on the screen.

The membership snapshot is known and discarded. **User experience:** a permanent dead end
with a English-ish server error, and the couple space they already own is invisible.

Fixed by items 9, 10.

### F2 (defect, CONFIRMED-IN-SOURCE) — creator loses the plaintext invitation code on reload

The server stores only a SHA-256 hash (`invitation_codes.code_hash`), and
`carryOverDevicePrefs` (`src/lib/store.tsx:216-223`) persists only
`widgetLayout`/`hasSeenInstallPrompt`/`theme` for an authenticated session. `sync.ts:71`
re-hydrates `coupleCode: ''`. The store's `shouldKeepInviteCode` guard only preserves a code
that is *already in memory*, so after a reload it is gone for good.

The only recovery affordance is `regenerateCoupleInvitation()` buried in
`src/pages/SettingsPage.tsx:330-393`. Home and `/us` show nothing.

**User experience:** "I created the space, where is my code?" with no on-screen answer.

Fixed by items 8, 9, 11.

### F3 (defect, CONFIRMED-IN-SOURCE) — no pending/personal/connected surface, and `/us` copy is role-wrong

`src/pages/UsPage.tsx:117` renders `'초대 코드로 커플 공간을 완성해보세요'` for **any**
non-connected state. To a creator holding an outstanding invitation that reads as
"enter a code", which is exactly the thing they must not do (`redeem_invitation` rejects
self-invitation). `src/features/home/WidgetDashboard.tsx` and
`src/features/home/SoldierDashboard.tsx` render no lifecycle state at all.

Fixed by item 11.

### F4 (defect, CONFIRMED-IN-SOURCE) — the client cannot distinguish pending from personal

`supabase/migrations/013_invitation_hardening.sql:315-327` drops both read policies and
`REVOKE SELECT ON TABLE public.invitation_codes FROM authenticated`. There is therefore no
client-reachable API that answers "do I have an outstanding invitation, and when does it
expire?". `sync.ts` infers `status: hasPartner ? 'active' : 'pending'` from
`get_partner_profile`, which cannot separate:

- pending creator with a live code,
- pending creator whose code expired,
- personal user with no space at all.

This is the root cause of F2/F3 and cannot be fixed client-side. Needs a SECURITY DEFINER
RPC. Fixed by items 6, 8.

### F5 (incomplete, CONFIRMED-IN-SOURCE) — invitation expiry is never shown

`invitation_codes.expires_at` is 24h (013). `OnboardingPage.tsx` hardcodes the string
`내 초대 코드 (24시간 유효)` but shows no actual deadline, and Settings shows none either.

Fixed by items 6, 8, 10, 11.

### F6 (acceptable) — `consume_invitation` is **not** called by the client

The task brief lists "the old frontend calls consume_invitation" as a failure. Verified
false on this commit: `src/lib/supabase.ts:269` only *mentions* it in a comment explaining
why the legacy shape is refused rather than fallen back to, and the sole redemption call is
`supabase.rpc('redeem_invitation', ...)` at `src/lib/supabase.ts:271`. Durable throttling
(013 `invitation_attempts`) plus a local damper (`INVITE_ATTEMPT_LIMIT`) are both present.
No change required; recorded so the claim is not silently dropped.

---

## 2. Records

### F7 (defect, CONFIRMED-IN-SOURCE) — record write/delete failures are booleans, so the cause is lost

`saveRecordToDB` (`src/lib/records.ts:158-186`) and `deleteRecordFromDB`
(`src/lib/records.ts:189-216`) log the Supabase error and `return false`. Every caller in
`store.tsx` therefore has no cause available and returns either `false` or the generic
`'기록을 저장하지 못했어요.'`.

The composer then applies its own fallback,
`src/components/widgets/TodayLogWidget.tsx:272`:
`'기록을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'`

**User experience:** an RLS/membership rejection (`42501`) or an expired JWT (`PGRST301`)
is reported as a broken internet connection, so the user retries forever instead of
reconnecting their couple space or signing in again.

Fixed by items 3, 4.

### F8 (defect, CONFIRMED-IN-SOURCE) — records cannot be saved when membership sync failed

`addRecordWithMedia` (`src/lib/store.tsx:1487-1494`) gives up as soon as
`captureLinkedCouple()` returns null and returns
`'커플 공간을 만든 뒤에 기록을 남길 수 있어요.'`. That is correct for a genuinely personal
user, but `captureLinkedCouple()` also returns null when the *server* has an active
membership and only local hydration failed (F1's half state, or a
`FULL_STATE_UNAVAILABLE` sync). The user is told to create a space they already own.

Fixed by item 12.

### F9 (incomplete, CONFIRMED-IN-SOURCE) — media cannot be replaced or removed on an existing record

`src/pages/RecordPage.tsx:664-800`: the edit modal binds only `log`, `reaction` and
`isPrivate`; attachments are rendered read-only at line 756. `MEDIA_ACCEPT`,
`classifyMediaFile`, `uploadRecordMedia` and `removeRecordMedia` all exist and are used
only by the create path (`addRecordWithMedia`). There is no store action that can add or
remove media on an existing record.

**Consequence:** a wrong photo can only be removed by deleting the whole record.

Fixed by item 13.

---

## 3. Auth

### F10 (defect, CONFIRMED-IN-SOURCE) — auth loss surfaces as a DB/permission or internet error

No module classifies `PGRST301` or HTTP 401 anywhere. Confirmed handled codes:

- `src/lib/events.ts:36` — only `42501` → `forbidden`.
- `src/lib/trips.ts:19` — only `42501` → `forbidden`.
- `src/lib/cycle.ts:69` — only `42501` → `forbidden`.
- `src/lib/records.ts` — nothing at all (F7).

An expired JWT therefore lands in the `error`/`false` bucket and reaches the user as
`'공유 정보를 확인할 수 없어…'` or, via `src/App.tsx:120`
(`AuthSyncUnavailable`), as `'인터넷 연결을 확인한 뒤 다시 시도해 주세요.'`. There is also no
`refreshSession()` retry on any read/write path.

Fixed by items 3, 5.

---

## 4. Offline / resilience

### F11 (defect, CONFIRMED-IN-SOURCE) — offline is reactive only

`src/components/OfflineBanner.tsx` owns its own `online`/`offline` listeners and renders a
banner *after the fact*. No mutation control consults `navigator.onLine`, so tapping 저장
offline fires a request that fails and then produces F7's misleading message.

Fixed by item 14.

---

## 5. Collaboration write integrity

### F12 (defect, CONFIRMED-IN-SOURCE) — `updateEvent` commits optimistically before the server confirms

`src/lib/store.tsx` `updateEvent` applies the local update *before* awaiting
`updateEventInDB` and rolls back on failure. The rollback is correct, but during the
in-flight window the UI shows a value the server has not accepted, and the failure toast
carries no cause (F7/F10 class). Trips, cycle and schedule call sites need the same audit.

Fixed by item 15.

### F13 (incomplete) — page-level failure copy is connection-shaped

`src/pages/TripsPage.tsx:153` (`'여행을 만들지 못했어요. 인터넷 연결을 확인해 주세요.'`) and
`src/pages/TripsPage.tsx:174` both attribute every failure to the connection, including
`forbidden`.

Fixed by items 3, 15.

---

## 6. Deployment reproducibility

### F14 (defect, CONFIRMED-IN-SOURCE) — Edge Function layout drift

`supabase/functions/delete-account/handler.ts:1` imports `'../_shared/cors.ts'` and the
repo tree is `supabase/functions/_shared/cors.ts`. The deployed Dashboard bundle places the
module at `source/_shared/cors.ts`, i.e. `./_shared/cors.ts` relative to the handler, so the
deployed file and the repo file differ by one import line and cannot be diffed. `package.json`
`check:edge` and `src/lib/cors.test.ts:2` both pin the repo layout.

Fixed by item 7.

### F15 (defect, external, CONFIRMED-IN-HISTORY) — migration 013 return-type conflict can recur

Applying 013 remotely failed with
`cannot change return type of existing function redeem_invitation(text)`. 015 already fixes
this for itself (`015_security_followup.sql:97`
`DROP FUNCTION IF EXISTS public.redeem_invitation(TEXT);`) but 013 does not, and the rule is
written nowhere. Any future migration that changes a return type will hit it again.

Fixed by items 6, 7, 21 (rule documented + 016 follows it).

---

## 7. EmoFlow

### F16 (incomplete, CONFIRMED-IN-SOURCE) — no aggregated period summary

`src/lib/emotionFlowAnalysis.ts` exposes `analyzeEmotionFlow` and
`src/components/EmotionFlowInsightCard.tsx` renders a single record's result. Nothing
aggregates the visible period, and there are no explicit empty/loading/error states for an
aggregate view.

Fixed by item 16.

---

## 8. Grep sweep results (evidence, not findings)

- `TODO|FIXME|HACK|XXX|준비 중|coming soon` across `src/` and `supabase/` excluding tests:
  **zero matches.** No placeholder or stub code is left on this branch.
- `인터넷 연결` (non-test): 10 matches. `OfflineBanner.tsx:29` is correct (genuinely offline).
  The other 9 are cause-blind: `App.tsx:120`, `TodayLogWidget.tsx:272`,
  `supabase.ts:288`, `OnboardingPage.tsx:310,362`, `SettingsPage.tsx:655,659`,
  `TripsPage.tsx:153,174`.
- `disabled=|hidden` across pages/components/features: 75 matches, all busy-state or
  validation guards. **No permanently disabled or unreachable UI action was found**, and no
  unreachable component: every page in `src/pages` is routed from `src/App.tsx` and both
  dashboards are reachable from `HomePage`.
- Schema↔client shape mismatch: none found beyond F4 (a missing API, not a mismatch).
- Mutations outside the tri-state gate: none found. `gatePathCoverage.test.ts` already
  enumerates `trips.ts`, `cycle.ts`, `supabase.ts`; `records.ts` and `events.ts` are gated at
  the `store.tsx` call site but that reason is not asserted anywhere (widened by item 18).

---

## Close-out

| # | Finding | Class | Item | Status |
| --- | --- | --- | --- | --- |
| F1 | Creator stuck after abandoning onboarding | defect | 9, 10 | fixed |
| F2 | Creator loses plaintext invitation code | defect | 8, 9, 11 | fixed |
| F3 | No lifecycle surface; `/us` copy role-wrong | defect | 11 | fixed |
| F4 | Cannot distinguish pending from personal | defect | 6, 8 | fixed |
| F5 | Invitation expiry never shown | incomplete | 6, 8, 10, 11 | fixed |
| F6 | `consume_invitation` still called | — | — | not a defect; claim disproved in source |
| F7 | Record errors swallowed → internet message | defect | 3, 4 | fixed |
| F8 | Cannot save records when membership sync failed | defect | 12 | fixed |
| F9 | Media not replaceable on existing records | incomplete | 13 | fixed |
| F10 | Auth loss shown as DB/internet error | defect | 3, 5 | fixed |
| F11 | Offline is reactive only | defect | 14 | fixed |
| F12 | `updateEvent` commits before server confirms | defect | 15 | fixed |
| F13 | Page failure copy is connection-shaped | incomplete | 3, 15 | fixed |
| F14 | Edge Function layout drift | defect | 7 | fixed |
| F15 | Migration return-type conflict can recur | defect | 6, 7, 21 | fixed (rule + 016 complies) |
| F16 | No EmoFlow period summary | incomplete | 16 | fixed |

Intentionally not fixed, with reasons, is recorded in `docs/kiro/AI_HANDOFF.md` §4.1 and in
the final report: the three pre-existing visual findings (coral contrast below AA, sub-44px
density in calendar/composer chrome, offline-banner ↔ floating-CTA overlap) are design
decisions that predate this work, and `master`'s incompatibility with the hardened database
is out of scope by mandate.
