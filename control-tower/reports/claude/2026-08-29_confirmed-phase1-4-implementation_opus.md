# CONFIRMED Phase 1–4 implementation — TIME canonicalization, in-app legal documents, Android/Keychain doc accuracy

## Verdict

`IMPLEMENTATION COMPLETE — ALL TERRA BLOCKERS CLOSED — LOCAL GATES PASS — UNCOMMITTED — TERRA FULL RE-REVIEW REQUIRED`

> **Superseded in part.** Terra High's independent review returned BLOCKED on four points.
> Section 6 records the first remediation (four BLOCKED points); section 7 records the
> second (four P2 findings from Terra's full-diff review). Everything above section 6
> describes the state Terra first reviewed; read sections 6 and 7 for what the current
> working tree actually contains.

- Worktree: `/Users/han-yejun/Desktop/곰신로그-partner-briefing`
- Branch: `codex/partner-briefing`
- HEAD: `15a7a7933d37e95907fd8f5d609fbb9e4f1e1cd2` — **unchanged, start == end**
- `origin/master` base: `b7d59ac`
- Main checkout `/Users/han-yejun/Desktop/곰신로그` (`codex/profile-post-composer` @ `a536f9b`): untouched

No commit, push, merge, deploy, Supabase mutation, Apple/Vercel change, or TestFlight upload.
Every change is in the working tree. The 25 pre-existing dirty Partner Briefing files and the
3 pre-existing untracked entries are all still present; nothing was reset, stashed, or checked out.

Only the findings the prior XHigh adversarial triage marked **CONFIRMED** were implemented.
RAISED and REJECTED findings were deliberately left alone.

---

## 1. What was changed

### P0 — PostgreSQL `TIME` canonicalization

`src/lib/partnerBriefing/normalize.ts`, `normalize.test.ts`

`isValidTimeString` accepted `HH:mm` only. A `time` column read through PostgREST returns
`HH:mm:ss`, and `HH:mm:ss.ffffff` where the column has sub-second precision. One such record
failed the whole corpus closed, so a couple whose records predate the client's `HH:mm`
normalization had no briefing at all.

| Aspect | Behaviour |
|---|---|
| Accepted | `HH:mm`, `HH:mm:ss`, `HH:mm:ss.fraction` |
| Rejected | `9:00`, `24:00:00`, `12:60:00`, `12:00:60`, `12:00:00.`, `12:00:00Z`, `12:00:00+09:00`, surrounding whitespace |
| Period bucketing | canonical `HH:mm` only — seconds cannot shift a record across a boundary |
| Ordering | exact instant: hour → minute → second → fraction → recordId |
| `09:07` vs `09:07:00` | same instant, tie-broken by recordId |
| `09:07:01` | orders after every `09:07` record |
| DailyRecord / DB values | untouched; the raw string is read, never rewritten |
| Model payload | unchanged allowlist `{ordinal, dayOrdinal, period, text, mediaKinds}` — no real time |
| Invalid record | existing fail-closed contract preserved: `{index, reason:'invalid_time'}` |

Fractions are compared as zero-padded digit strings rather than floats, so precision is exact
and unbounded in digit count.

`normalize.ts` is the only place in the briefing path that reads `record.time`; no corpus or
pipeline test needed a matching change.

### P1 — Onboarding legal documents open in-app

`src/pages/OnboardingPage.tsx`, `src/pages/LegalPage.tsx`, `src/lib/legalDocs.ts` (new),
`src/pages/onboardingLegalDocs.test.tsx` (new), `src/pages/LegalPage.test.tsx`

The two consent documents were `<a href="/legal/…" target="_blank">`. The packaged app is served
from `capacitor://localhost` (iOS) and `https://localhost` (Android), so `target="_blank"` handed
that origin to the system browser and Safari showed a `https://localhost` connection failure. The
documents a user is legally required to be able to read were unreachable on the platform the store
submission is for, and the attempt took the user out of onboarding.

- `LegalDocumentBody` extracted; the public route and the sheet render **one** copy of the prose.
  No legal text was duplicated, reworded, or moved.
- `LegalDocumentSheet` is a full-screen `role="dialog" aria-modal="true"` overlay: 44px close
  target, `pt-[env(safe-area-inset-top,0px)]`, inner scroller with safe-area bottom padding,
  Escape to close, focus to the close button on open and back to the trigger on close.
- Triggers are `<button>`, which is interactive content, so a tap is not forwarded to the enclosing
  `<label>` — **reading a document cannot tick the consent box**.
- The sheet contains exactly one button (close) and no checkbox: there is no agree control in it.
- `ageConfirmed` / `legalAccepted` survive open and close, because nothing navigates.
- The public `/legal/:doc` route is unchanged and still reachable.
- Login / OAuth code untouched. Visual design otherwise unchanged.

`LEGAL_DOC_TITLES` and `toLegalDocKey` live in `src/lib/legalDocs.ts` rather than the page module,
because `--max-warnings 0` plus `react-refresh/only-export-components` forbids a page exporting
non-components.

### P2 — Android architecture documentation

`docs/PARTNER_BRIEFING_ARCHITECTURE.md`

Removed *"without crashing or loading ML Kit classes"*. What the API 26 gate blocks is **inference**,
not class loading: the merged manifest's `MlKitInitProvider` is instantiated during application
startup, before `Application.onCreate`, on every API level. A verification-status table now
separates what was observed from what was not:

| Claim | State |
|---|---|
| APK installs on API 23 / 24 | PASS |
| App starts, process survives on API 23 / 24 | PASS |
| No startup crash observed on API 23 / 24 | PASS (two images; not a proof for all pre-26 devices) |
| `MlKitInitProvider` loads at process start | CONFIRMED |
| Pre-26 inference blocked by the runtime gate | CONFIRMED |
| JS reaches the deterministic fallback on pre-26 | **UNVERIFIED** (needs the WebView driven on those images) |
| API 25 | **UNVERIFIED** |
| Physical Samsung / any physical Android device | **UNVERIFIED** |

The manifest provider is **not** removed, and the reason is recorded: `tools:node="remove"` would
also delete ML Kit's initialization on API 26+, where the feature depends on it.

### P3 — DeviceKeys plugin singleton

`src/crypto/keystore/index.ts`, `src/crypto/keystore/deviceKeysPluginSingleton.test.ts` (new)

`getDeviceKeyPort` and `getLocalKeyPort` each called `registerPlugin('GomsinlogDeviceKeys')`,
producing the physical-iPhone warning `Cannot register plugins twice.` One memoized accessor now
serves both, so the two ports share a single native bridge instance.

Unchanged: crypto and key semantics (the proxy is lazy, so dispatch is identical), the
native-unavailable fail-closed contract (a native build without its plugin still returns `null`
rather than downgrading to WebCrypto), the per-port memos, and both test seams.

### P2 — Android permission verification honesty

`src/lib/nativeConfig.test.ts`, `android/app/src/test/java/app/gomsinlog/NativeConfigTest.java`

The two "independent witnesses" were two implementations of the same blind spot: both read
`android/app/src/main/AndroidManifest.xml`, which is an **input to the manifest merger**, and
asserted an exact set of three while the built APK carries seven.

- Both are rescoped to what they prove: the app's **own** declarations.
  `declaresOnlyThePermissionsTheCodeProves` → `declaresOnlyItsOwnPermissionsInTheSourceManifest`.
- A new block reads the generated merged manifest and asserts the full shipped set.
- **When no build artifact exists the block reports SKIPPED, not PASS.** A green tick for a file
  that was never read is exactly the false assurance being removed.
- One assertion needs no artifact and holds the block non-vacuous: the four library permissions
  are provably absent from the source manifest, so neither source witness could ever report them.
- The four library-merged additions are documented with their origin:
  `com.google.android.apps.aicore.service.BIND_SERVICE` (`com.google.mlkit:genai-prompt`);
  `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE`,
  `app.gomsinlog.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (messaging stack).

No permission was added, removed, or changed.

### P2 — `App.entitlements` Keychain contract

`ios/App/App/App.entitlements`, `docs/kiro/NATIVE_RELEASE_GUIDE.md`

*"The app never touches the Keychain"* contradicted the repo's own `iosPrivacyManifest.test.ts`
and hid where the E2EE device keys live. Replaced with the real contract: Keychain use is confined
to the first-party device-keys plugin (`DeviceKeys.swift` — Secure Enclave with a software
`kSecClassKey` fallback; `LocalKeys.swift` — `kSecClassGenericPassword`); neither call site sets
`kSecAttrAccessGroup`, so both items sit in the app's **default access group**, readable by this
bundle alone. `keychain-access-groups` stays absent precisely because declaring it would place the
device key in a group any bundle carrying the same entitlement could read.

No entitlement key was added or removed.

**Scope note (one change beyond the brief):** the entitlements comment pointed at the Keychain
section of `NATIVE_RELEASE_GUIDE.md`, which carried the same false claim. Correcting only the
comment would have left the pointer aimed at the error, so that section was corrected too.

---

## 2. Verification

| Check | Result |
|---|---|
| `normalize.test.ts` focused | **PASS** 79 tests |
| `src/lib/partnerBriefing/` | **PASS** 12 files / 424 tests |
| `src/crypto/keystore/` + `nativeDeviceKeysBridge` | **PASS** 44 tests |
| `nativeConfig` + `iosPrivacyManifest` | **PASS** 80 tests |
| `onboardingLegalDocs` + `LegalPage` | **PASS** 20 tests |
| `npm run test` | **PASS** 281 files / **4263** tests (baseline 279 / 4205) |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** (`--max-warnings 0`) |
| `npm run build` | **PASS** — eager `index-*.js` 437,893 B vs baseline 437,978 B |
| `npm run verify:native` | **PASS** 4 files / **109** tests (baseline 106) |
| `npm run test:e2e:partner-briefing` | **PASS** 2/2 |
| `git diff --check` | **PASS** clean |
| `:app:testDebugUnitTest` | **PASS** 8 tests, 0 failures — genuinely recompiled and re-run |
| `compileDebugKotlin` + `:app:assembleDebug` | **BUILD SUCCESSFUL**, but **152/152 tasks up-to-date** |
| `npx cap sync ios` | PASS, 6 plugins |
| iOS unsigned simulator build | **`** BUILD SUCCEEDED **`** |

The legal prose stays in the lazy `LegalPage-*.js` chunk, so the in-app sheet adds nothing to
startup parse cost.

**Honest reading of the Android assemble:** `BUILD SUCCESSFUL` with every task up-to-date means
this change touched no Android compilation input — it is not evidence of a fresh compile. The
Android result that *was* genuinely executed is `:app:testDebugUnitTest`, which recompiled
(`compileDebugUnitTestJavaWithJavac` ran) and executed the renamed JVM permission test.

### Mutation testing — the new assertions are not vacuous

Each new assertion was deliberately broken to confirm it fails:

| Mutation | Result |
|---|---|
| time regex back to `HH:mm` only | 23 fail |
| period from a raw `slice(0,2)` prefix | 1 fail |
| onboarding back to `target="_blank"` anchors | 10 fail |
| opening a document ticks the consent box | 1 fail |
| focus not returned to the trigger | 1 fail |
| `registerPlugin` called twice again | 4 fail |
| native-without-plugin downgrades to web | 1 fail |
| one library permission dropped from the merged expectation | 1 fail |
| sheet renders only the first section | 4 fail |
| merged manifest hidden | **2 skipped** (not passed) |

**Two facts recorded rather than papered over:**

1. Zero-padding in the fraction comparison is a *provably equivalent* mutant — trailing zeros are
   already stripped at parse time, so a raw lexicographic compare is correct. The padding is
   defensive and is **not** covered by a test that can distinguish it.
2. For any *valid* time, `time.slice(0,2)` and the canonical hour agree. The period assertion
   therefore distinguishes the two implementations only on **unvalidated** input, which is what
   `getBriefingPeriod('9:00') === 'night'` pins.

---

## 3. Not done / unverified

| Item | State | Reason |
|---|---|---|
| Commit / push / PR | **NOT DONE** | forbidden by instruction |
| RAISED / REJECTED findings | **NOT TOUCHED** | out of scope by instruction |
| Pre-26 JS deterministic fallback reached in a real WebView | **UNVERIFIED** | needs the app driven on an API 23/24 image |
| API 25 | **UNVERIFIED** | no system image booted |
| Physical Samsung / any physical Android device | **UNVERIFIED** | none connected |
| Legal sheet opened on a physical iPhone | **UNVERIFIED** | verified at jsdom level only |
| Remote Supabase / Vercel / Apple / TestFlight | **UNCHANGED** | out of scope |
| Security sign-off | **NOT GIVEN** | the implementer does not approve their own security |

---

## 4. Rollback

HEAD is unchanged, so `git checkout --` on the following restores the pre-session state — but
**note that 25 of the modified files were already dirty before this session**, so a blanket
checkout would also discard the pre-existing Partner Briefing work.

Files this session created (safe to delete):

```
src/lib/legalDocs.ts
src/pages/onboardingLegalDocs.test.tsx
src/crypto/keystore/deviceKeysPluginSingleton.test.ts
control-tower/reports/claude/2026-08-29_confirmed-phase1-4-implementation_opus.md
```

Files this session modified (all were clean at session start except
`docs/PARTNER_BRIEFING_ARCHITECTURE.md` and `docs/WORK_LOG.md`, which were already dirty):

```
src/lib/partnerBriefing/normalize.ts
src/lib/partnerBriefing/normalize.test.ts
src/pages/OnboardingPage.tsx
src/pages/LegalPage.tsx
src/pages/LegalPage.test.tsx
src/crypto/keystore/index.ts
src/lib/nativeConfig.test.ts
android/app/src/test/java/app/gomsinlog/NativeConfigTest.java
ios/App/App/App.entitlements
docs/kiro/NATIVE_RELEASE_GUIDE.md
docs/PARTNER_BRIEFING_ARCHITECTURE.md   (already dirty)
docs/WORK_LOG.md                        (already dirty)
```

Host side effects: `npx cap sync ios` re-ran `pod install`, which recomputed the
`GomsinlogCapacitorOnDeviceBriefing` checksum in `ios/App/Podfile.lock` to the same value the
pre-existing dirty Swift edits already produced. `dist/` and Xcode DerivedData were rebuilt.

---

## 5. Review required

**Terra High: independent review of the current working-tree diff.** In priority order:

1. `src/lib/partnerBriefing/normalize.ts` — the time grammar and the ordering contract. Is any
   PostgreSQL `time` form still rejected that should be accepted, or accepted that should not be?
2. The onboarding sheet — can reading a document reach the sign-in gate by any path?
3. `src/crypto/keystore/index.ts` — does sharing one plugin proxy between the two ports have any
   effect on account isolation or key handling that the tests do not cover?

---

## 6. Terra High review — BLOCKED, and the remediation

Terra High reviewed the diff described above and returned **BLOCKED** on four points: two P1,
two P2. Only those four were addressed. No new feature, refactor, dependency, or production
change was made, and HEAD is still `15a7a79`.

### 6.1 P1 — the legal modal did not contain focus

`aria-modal="true"` was a claim the markup did not keep. There was no focus trap, so Tab walked
straight out of the dialog into the consent checkboxes and the sign-in buttons behind it — the
one place a stray keystroke must not land, given the whole point of the sheet is that reading is
not consenting.

Fixed by reusing the focus trap already in `src/components/cycle/CycleSheet.tsx`: same key
handling, same focusable selector. **No new dependency.** One deliberate addition over
CycleSheet: when focus is not inside the panel it is pulled back in. That state is reachable by
ordinary use here — these are long prose documents, and a tap on a paragraph blurs to `body`,
after which the next Tab lands on the first tabbable element on the page, which is behind the
dialog.

It was **not** extracted into a shared hook. Doing so would mean rewiring `CycleSheet.tsx`, a
refactor of a screen outside this phase's file list.

Escape, focus-to-close on open, and focus-back-to-the-exact-trigger on close are all unchanged;
focus restoration still belongs to `OnboardingPage`'s trigger ref, which was already verified.

### 6.2 P2 — interactive controls inside a `<label>`

The two document buttons sat inside the consent `<label>`. That is safe only by the HTML spec's
rule that a label does nothing for events targeted at interactive descendants — one behaviour, in
one clause, standing between "read the terms" and "silently agree to the terms".

The buttons are now **siblings** of the label. The label survives as three text-only `htmlFor`
segments around them, so tapping the sentence still ticks the box and tapping a document name
structurally cannot. The checkbox carries `aria-label` with the whole sentence, because three
label fragments would otherwise announce as "[필수] 및 을 확인하고 동의합니다."

The defensive `preventDefault()` / `stopPropagation()` were removed: the structure is now the
guarantee, and the comment that explained them would have been left describing a dependency that
no longer exists.

### 6.3 P1 — merged-manifest skip, and a correction to the premise

Changed from a runtime `ctx.skip()` to a declaration-time `it.skipIf(NO_ARTIFACT)`, with the
merged-manifest path resolved once at collection.

**The stated premise did not reproduce, and that is recorded rather than glossed over.** Terra's
finding was that `ctx.skip()` is tallied as a PASS by the verbose reporter. On this repository's
Vitest (3.2.6) it is not: a minimal probe running `ctx.skip()` and `it.skipIf(true)` side by side
reported **both** as `↓` and tallied `2 skipped (2)`. The prior implementation's own run also
already showed `67 passed | 2 skipped`.

The change was made as instructed and is still worth having, but for a different reason than the
one given: `it.skipIf` never registers the test as runnable, so no part of the body executes and
the outcome cannot depend on the reporter or the Vitest version.

### 6.4 P2 — fraction capped at PostgreSQL's six digits

The fraction was `\d+`, which accepted strings a `time` column cannot emit — PostgreSQL stores
`time` as microseconds since midnight. Now `\d{1,6}`.

`.1` through `.123456` are accepted; `.` alone, seven or more digits, the previous twelve-digit
fixture, and every timezone suffix are rejected. A separate test pins that an over-precise
fraction is **rejected, not truncated** — silent truncation is the failure mode a cap invites.
Hour/minute/second ranges, the same-instant tie with recordId stabilization, second and
sub-second ordering, the model payload and the DB/DailyRecord contract are all unchanged.

### 6.5 Verification of the remediation

| Check | Result |
|---|---|
| `normalize.test.ts` | **PASS** 81 |
| `src/lib/partnerBriefing/` | **PASS** 12 files / 426 |
| `onboardingLegalDocs.test.tsx` | **PASS** 20 |
| `nativeConfig.test.ts` | **PASS** 69 |
| `npm run test` | **PASS** 281 files / **4274** (was 4263) |
| `npm run typecheck` / `npm run lint` | **PASS** |
| `npm run build` | **PASS**, eager bundle 437,893 B — unchanged |
| `npm run verify:native` | **PASS** 109 |
| `npm run test:e2e:partner-briefing` | **PASS** 2/2 |
| `git diff --check` | clean |
| `:app:testDebugUnitTest --rerun-tasks` | **PASS** 8 tests, **112/112 tasks executed** — a genuine run, not the cached one reported in section 2 |

**Manifest skip, case A (artifact present):** exact seven merged permissions and
`MlKitInitProvider` both asserted, PASS.

**Manifest skip, case B (artifact absent):** `android/app/build` was moved to an explicit
temporary path and restored by a `trap ... EXIT INT TERM` handler — never deleted. The verbose
reporter rendered both tests as `↓` and tallied `67 passed | 2 skipped`. All **1273** files were
verified back in place afterwards, APK and merged manifest included.

**Mutation testing of the remediation** — each new guard was broken to confirm it fails:

| Mutation | Result |
|---|---|
| focus trap disabled entirely (valid no-op) | 4 fail |
| pull-back-when-outside branch removed | 1 fail |
| Shift+Tab branch removed | 3 fail |
| buttons moved back inside the `<label>` | 2 fail |
| fraction back to unbounded `\d+` | 4 fail |
| fraction cap made truncating (`\d{1,6}\d*`) | 4 fail |

One earlier mutation attempt (a crude splice that removed the Tab handler) produced a syntax
error rather than a behavioural failure. That is an invalid mutant and proves nothing; it was
redone as the valid no-op in the table above.

### 6.6 Still outstanding

- The legal sheet's focus behaviour is verified at jsdom level only — **not** on a physical
  iPhone with VoiceOver.
- Everything listed in section 3 remains as it was.
- **The implementer does not approve this.** Terra High must re-review the same working-tree diff
  in full, not only the four changes in this section.

---

## 7. Terra full-diff review — P2 closure

Terra's review of the whole working-tree diff raised four P2 findings. All four are fixed
below, minimally. No unrelated refactor, no UI redesign, no PartnerDay/E2EE/DB change.
HEAD is still `15a7a79`; 41 status entries preserved.

### 7.1 P2-1 — the batcher never checked the grapheme budget

`canItemsFitInEnvelope` proved UTF-8 bytes only. `maxInputTextGraphemes` is a
**whole-request** limit on both native sides: each parser keeps one running total over
every candidate text of every item and rejects the entire request the moment it is passed
(`OnDeviceBriefingPlugin.swift` `totalGraphemes += text.count`; the Kotlin bridge the same
via `engine.countGraphemes`). So the JS batcher could assemble a batch that was byte-legal
and grapheme-illegal, native hard-rejected it, and the batch silently became deterministic
output with no signal anywhere.

The JS check now means exactly what the native check means. Where `Intl.Segmenter` is
unavailable the count cannot be proven, so it fails closed to the deterministic path —
it never guesses a count and never trims a candidate, because a trimmed candidate is no
longer the exact source.

Found while testing this: a malformed item (no `candidates`) threw a `TypeError` out of
`canItemsFitInEnvelope` at the response-budget step, from a function whose entire contract
is to answer true/false. The structural check now runs first.

### 7.2 P2-2 — an out-of-range `itemOrdinal` crashed the verifier

The bounds check sat *inside* the `itemOrd !== currentExpectedItemOrdinal` branch, so an
out-of-range ordinal that happened to equal the expected one skipped it entirely.
`currentExpectedItemOrdinal` advances with each consumed choice, so an untrusted plan
carrying more choices than were requested walks it past the end: with two requested items,
a plan with `itemOrdinal: 2` satisfied the equality test and hit
`requestedItems[2].candidates`.

That threw out of a verifier whose whole contract is a bounded rejection, and the
pipeline's batch loop has no `try`/`catch` around it — so one hostile batch destroyed every
sibling batch that had already verified cleanly. The bounds check now runs before the
ordinal is used as an index and returns `unknown_item`; in-range reordering still returns
`reordered_choices`.

### 7.3 P2-3 — a day was a set of period buckets, not a sequence

Sections were keyed by period in a `Map`, so every record of a given period on a given day
collapsed into one section wherever it sat. `night` spans **both** ends of the clock
(00:00–04:59 and 22:00–23:59), so a day of 00:30 / 09:00 / 22:30 produced
`night(00:30 + 22:30)` then `morning(09:00)` — a 22:30 record displayed *above* the 09:00
record it came eight hours after, fused into the same section as one from the previous
night.

`groupEventsIntoChronologicalRuns` cuts a new run only when the period **changes**, and is
applied at all three sites: the deterministic fallback sections, the pipeline's display
sections, and the pipeline's batching. Batching mattered too — keying on
`${day}_${period}` merged both halves of a midnight-spanning night into one request, so a
group could join a 00:30 record to a 22:30 one and still look period-isolated. The
`BriefingPeriod` union and the time boundaries are untouched.

Consequence, checked as instructed: a day can now legitimately carry two sections with the
same period, so `PartnerBriefingCard`'s `key={section.period}` became a duplicate React
key. It now carries `sectionIdx`. The exact-original `textId`s already included
`sectionIdx`, so navigation needed no change.

### 7.4 P2-4 — the advertised iOS prompt overhead was too small

`promptOverheadUtf8Bytes` was the literal **256** while the real static prompt measures
**295** bytes: 283 for the instructions (which contain a 3-byte en dash) plus 12 for
`"Items JSON:\n"`. The JS batcher subtracts the advertised figure from
`maxContextUtf8Bytes`, so under-declaring by 39 bytes let it over-fill every request.

A `promptItemsPrefix` constant now feeds both the prompt builder and the budget, so the
two strings cannot drift, and `promptOverheadUtf8Bytes` is computed from their UTF-8 sizes
rounded **up** to the next 64 bytes (320) — conservative rather than exact-to-the-byte.
The Android and TypeScript provider contracts were not touched.

### 7.5 Verification

| Check | Result |
|---|---|
| Partner Briefing focused (lib + card + story) | **PASS** 19 files / 580 |
| `npm run test` | **PASS** 281 files / **4294** (was 4274) |
| `npm run typecheck` / `npm run lint` | **PASS** |
| `npm run build` | **PASS**, eager bundle 437,893 B — unchanged |
| `npm run verify:native` | **PASS** 109 |
| `git diff --check` | clean |
| iOS: `cap sync ios` + unsigned simulator build | **`** BUILD SUCCEEDED **`** |
| iOS overhead arithmetic, executed | `swift` run of the same constants: instructions 283, prefix 12, static 295, advertised **320**, covers = true |
| Android: `compileDebugKotlin` + `assembleDebug` + `testDebugUnitTest` | **BUILD SUCCESSFUL**, 8 tests 0 failures, but **157/157 tasks up-to-date** |

The Android result is up-to-date because this phase changed no Android input — only
TypeScript and Swift. That is the expected outcome, not fresh-compile evidence; the
genuine `--rerun-tasks` execution is the one recorded in §6.5.

**Mutation testing** — every new guard was broken to confirm it fails:

| Mutation | Result |
|---|---|
| aggregate grapheme check removed | 4 fail |
| grapheme total reset per item (per-item instead of per-request) | 2 fail |
| uncountable graphemes counted as 0 instead of fail-closed | 1 fail |
| verifier bounds check moved back inside the inequality branch | 2 fail in the verifier + 1 in the pipeline (the `TypeError` escapes) |
| run-cutting reverted to a period-keyed merge | 4 fail |
| React key reverted to `section.period` | 1 fail |
| `promptOverheadUtf8Bytes` back to the literal 256 | 1 fail |
| prompt builder duplicating the `"Items JSON:\n"` literal | 1 fail |

One correction worth recording: the first version of the pipeline continuation test passed
*with the bug still present*. Its hostile batch held a single item, and the verifier's
group-size rule ("`requestCount === 1` → exactly one group of one choice") rejects an extra
choice before it is ever used as an index — so a one-item batch cannot reach the crash and
a test built on one proves nothing. It was rebuilt with two items per batch and now fails
against the bug.

### 7.6 Invariants

Re-checked, not assumed:

- **No eligible source disappears.** Asserted for the grapheme batcher (batched ∪
  unfittable = all segments, exactly once), for the run-cutting change (rendered ids equal
  the full ordered set), and for the hostile-batch pipeline run (all four records still
  bound).
- **No unknown source is admitted** — `unknown_item` / `unknown_candidate` rejections
  still fire, now including the case that previously crashed.
- **No real recordId/userId/coupleId/E2EE material in the model payload** — unchanged;
  the request shape was not touched, and the rejection-payload assertions still hold.
- **Private / unreadable / wrong-partner records never cross the AI boundary** — upstream
  of every file touched here; unchanged.
- **No server AI, no persistence of AI output** — unchanged.
- **Deterministic fallback works on AI failure** — now reached in two more cases (grapheme
  over-budget, uncountable graphemes) rather than crashing or over-filling.
- **Viewing a briefing does not change CONFIRMED** — unchanged; no PartnerDay code touched.
- **No user data or DB schema change** — `supabase/` has zero modifications.

### 7.7 Still outstanding

- Not verified on a physical device: the grapheme limit and the prompt overhead as the
  real Foundation Models session sees them, and a midnight-spanning day rendered on screen.
- Everything in §3 and §6.6 remains as it was.
- **The implementer does not approve this.** Terra High must re-review the same
  working-tree diff in full.

---

## 8. Terra full-diff re-review — final blocker closure

Terra's re-review of all 41 changes left one P1 and two P2s. All three are closed here.
HEAD is still `15a7a79`; all 41 pre-existing entries are preserved and three additional
files were touched (44 entries total: 38 modified + 6 untracked).

### 8.1 P1 — the feature flag deleted the table of contents

**Reproduced.** With `VITE_PARTNER_BRIEFING_ENABLED=true` and `partnerUserId` not yet
bound, the story showed neither a briefing nor a cover — only raw record cards, with no
range, no contents, and no jump-to-original.

**Root cause.** `withCover` and `showAllTodayCoverLines` keyed on
`partnerBriefingEnabled`, not on whether a briefing existed. A missing briefing is not an
exception path: `usePartnerBriefing` returns `null` whenever identity is unresolved, the
corpus normalization fails (`unavailable`), or there is nothing to show (`empty`).
Turning a flag on must not delete the first screen.

**Implementation.** Both conditions now read `!briefing`. The card list is
`[cover, ...moments, closing]` without a briefing and `[briefing, ...moments, closing]`
with one — **identical length, identical moment and closing indices**. Because the shapes
match, `briefing ? 'briefing' : 'raw'` was removed from the `StoryViewer` remount key: a
late briefing swaps the leading card in place instead of remounting and throwing the
reader back to the first card. `focusRecordId` still keys the remount, since that changes
which card should open. `?at=<recordId>` lands on the same card before and after, because
`initialIndex` already compensates for the leading card in both shapes.

The legacy dailySummary refinement was already gated `enabled: !partnerBriefingEnabled`,
so the two AI paths still cannot run together. No new state abstraction, no store change.

**Tests** (`storyRoutes.test.tsx`, 32 total): cover survives with `partnerUserId`
unresolved; cover survives when a malformed time fails normalization; jump-to-original
works from the fallback cover; a ready briefing replaces exactly one card and never
coexists with the cover; a late briefing preserves the current moment, the closing card
and the `?at=` position; a briefing that disappears returns the cover without losing
position; briefing creation, replacement, expansion and open-original call `acknowledge`
zero times; only the explicit `다 읽었어요` calls it.

### 8.2 P2 — JS accepted requests the device refuses

**Reproduced.** A record segmenting into **33** sentences produced 33 candidates;
`canItemsFitInEnvelope` returned `true`; both native parsers cap at **32** and reject the
whole request — so a capable device silently produced deterministic output.

**Fields added.** `BriefingProviderEnvelope` now carries `maxItems` and
`maxCandidatesPerItem`. Both natives always enforced these; they were simply never
advertised, so the batcher could not see them. They live in the envelope rather than in
JS constants so the two platforms may differ and neither can drift from the batcher.
Strict allowlist validation and safe-integer range checks are preserved and extended.

**iOS** — `OnDeviceBriefingPlugin.swift` advertises `OnDeviceBriefing.maxItems` (64) and
`maxCandidatesPerItem` (32), the same constants its parser guards with.
**Android** — `OnDeviceBriefingPlugin.kt` advertises `MAX_ITEMS` (64) and
`MAX_CANDIDATES_PER_ITEM` (32) likewise. The fake provider matches both.

`canItemsFitInEnvelope` now proves, before any native call: non-empty items;
`items.length <= maxItems`; non-empty candidates; `candidates.length <=
maxCandidatesPerItem`; dense sequential `itemOrdinal` and `candidateOrdinal` (both parsers
require `ordinal == count`); non-blank candidate text — alongside the existing byte,
response-reserve and aggregate-grapheme proofs.

**Deterministic fallback.** Nothing is trimmed. Keeping the first 32 candidates would put
a set that is no longer the exact source in front of the model; the over-capacity record
goes to the deterministic path and stays in the final union with its exact `recordId`.

**Tests**: 32 accepted / 33 rejected; `maxItems` boundary and overflow; empty request,
empty candidates, blank text; non-sequential item and candidate ordinals; a smaller
runtime capability constraining the batcher; the 33-candidate record surviving end to end
while no request exceeds 32; iOS and Android key/value parity with an identical six-key
envelope; capability payloads carrying capacity numbers only; strict extra-key rejection
plus new invalid-range cases; existing grapheme, byte and 30/100/300 coverage tests
unchanged and still passing.

### 8.3 P2 — the architecture doc contradicted itself

The Native Platform section described a shipping ML Kit GenAI Prompt beta2 provider while
a later section said Gate D had not picked an SDK.

**Stale statement removed.** The "does not preselect a concrete Android GenAI SDK"
paragraph is gone. **Current decision recorded:** Gate D is COMPLETE, the selection is
`com.google.mlkit:genai-prompt:1.0.0-beta2`, with a rationale table covering structured
output, ordinal provenance, offline execution, cancellation, deterministic fallback for
every failure code, and runtime capability detection. Server inference remains forbidden
and no AI result is persisted. The API 26 inference gate, the API 23–25 deterministic
fallback and the `MlKitInitProvider` process-start load are owned by the Native Platform
section and linked rather than duplicated. **Physical Android hardware is recorded as
UNVERIFIED** — choosing an SDK does not close a device gate.

**Consistency test** — three checks added to the existing bridge test, no new file: Gate D
reads as decided and the stale phrasing cannot return; the doc names the same artifact and
version `android/build.gradle` actually resolves; the rationale and the honest
verification status survive.

### 8.4 Verification

| Check | Result |
|---|---|
| Partner Briefing + Story + Card focused | **PASS** 19 files / 604 |
| `npm run test` | **PASS** 281 files / **4318** (was 4294) |
| `npm run typecheck` / `npm run lint` | **PASS** |
| `npm run build` | **PASS**, eager bundle 437,893 B — unchanged |
| `npm run verify:native` | **PASS** 109 |
| `nativeConfig` against the regenerated APK | **PASS** 69 |
| `git diff --check` | clean |
| Android `--rerun-tasks` | **BUILD SUCCESSFUL, 157/157 executed** — a genuine fresh Kotlin compile, JVM 8 tests 0 failures, APK rebuilt at 16,612,952 bytes |
| iOS (Xcode 26.6 / 17F113) unsigned simulator | **`** BUILD SUCCEEDED **`** |

The iOS simulator build proves compilation, **not** Foundation Models behaviour.

**Mutation testing** — every new guard broken to confirm it fails:

| Mutation | Result |
|---|---|
| cover keyed on the flag again | 4 fail |
| `briefing` back in the remount key | 2 fail |
| `maxCandidatesPerItem` check removed | 4 fail |
| `maxItems` check removed | 2 fail |
| `itemOrdinal` sequencing removed | 1 fail |

### 8.5 Invariants

- **Source coverage** — the 33-candidate record stays in the final union with its exact
  `recordId`; 30/100/300 coverage unchanged; nothing truncated to fit.
- **Privacy** — capability payloads carry capacity numbers only; asserted free of
  `recordId`, `userId`, `coupleId`, dates and URLs.
- **Provenance** — real record ids remain TypeScript-internal; the bridge still sees only
  ordinals and candidate text.
- **CONFIRMED** — asserted zero `acknowledge` calls across briefing creation, replacement,
  expansion and open-original; only the explicit control calls it. PartnerDay untouched.
- **Server AI / persistence** — neither added.
- **Data and schema** — `supabase/` unchanged.

### 8.6 Still outstanding

- No physical iPhone or Android device has run any of this.
- **The implementer does not approve it.** Terra High must re-review the entire
  working-tree diff.

---

## 9. Single-record position — P1 closure

Terra's delta review found the one case the section-8 fix did not cover: a day with
**exactly one readable record**.

**Reproduced first.** Six regression tests written against the existing route harness, all
six failing before the change.

**Root cause.** The cover is only built when `readable.length > 1`, so with a single record
the list length genuinely changes with the briefing:

```
no briefing : [moment, closing]
briefing    : [briefing, moment, closing]
```

`StoryViewer` held a bare numeric index, so inserting a leading card moved the user without
any input: index 0 went from the record to the briefing, index 1 from the closing card to
the record, and the reverse on the way out. Section 8's index-parity argument held only
because a cover existed to occupy slot 0 — with one record there is no cover to occupy it.

**Implementation** — one production file, `StoryViewer.tsx`. The viewer now remembers
*what* it is showing rather than *where*: `itemKey` gives every card a stable identity
(`briefing`, `cover`, `moment:<recordId>`, `missing:<recordId>`, `closing`), state holds
that key, and the index is derived each render. `initialIndex` is used only to choose the
opening card. When the active card genuinely disappears the viewer clamps to the last valid
position and adopts the card there, so a shrinking list can never leave an out-of-range
index or a blank screen. A single record was deliberately **not** given a synthetic cover:
that would hide the defect rather than fix it.

**Tests** (`storyRoutes.test.tsx`): with one readable record — briefing arriving while on
the record, and while on the closing card; briefing disappearing in both positions;
`?at=<recordId>` staying on the exact original across arrival and disappearance; no
out-of-range or blank screen after a shrink; `acknowledge` zero across every transition and
called only by the explicit control. The two-or-more-record cover ↔ briefing tests from
section 8 still pass unchanged.

**Verification.** Story focused 6 files / 134 PASS · Story + Partner Briefing + Card 19
files / 610 PASS · `npm run test` 281 files / **4324** PASS · typecheck, project lint and
per-file ESLint PASS · build PASS with the bundle unchanged · `git diff --check` clean.
Mutating the viewer back to pure numeric positioning fails **13** tests.

Not run this phase: native builds and `verify:native` — the change is a single `.tsx` file
and is not an input to either. Physical devices remain unverified.

**Not approved by the implementer.** Terra High delta review required.
