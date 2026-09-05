# Partner Briefing Architecture Contract

> Status: Gate 0 approved; v2 Grouping Plan amendment approved on 2026-08-29
> superseding v1 extract plans after Terra and architecture audits.
>
> This document owns the Partner Briefing implementation contract. Repository
> reality and the current `PartnerDay` implementation remain authoritative for
> current behavior. The existing `dailySummary` stays intact until a separate
> cleanup gate proves it is unused.

## Product question

Partner Briefing answers:

> 내가 마지막으로 확인한 이후 상대방에게 무슨 일이 있었는가?

It is a compression layer over every safe, readable record in the current
PartnerDay OUTSTANDING surface. It does not select important records, score the
relationship, infer hidden feelings, replace originals, or confirm anything.

## Ownership boundary

```text
PartnerDay
  owns: which records are currently OUTSTANDING
  output: usePartnerDay().surface

Partner Briefing corpus
  owns: whether each supplied OUTSTANDING record may cross the AI boundary
  output: a fail-closed, privacy-safe corpus
```

Partner Briefing must not read `state.records` to reconstruct the window or
introduce another `lastSeen`, checkpoint, date cutoff, missed-window rule, or
OUTSTANDING calculation. Its only record input is the `surface` already produced
by `usePartnerDay()`.

The active integration owner is `StoryRoute`. It obtains the canonical viewer
identity using the same expression as `usePartnerDay`:

`/story/partner` is keyed by canonical viewer ID plus the current couple ID,
isolating state across unlink/relink.
```ts
state.authenticatedUser?.id || profile.id
```

The exact partner identity is `profile.couple.partnerUserId`, sourced from active
couple membership. The corpus rejects unresolved or equal identities. This does
not require a PartnerDay state-machine change.

## Corpus privacy boundary

No DB projection or schema migration is needed because explicitly partner-shared,
partner-readable general `DailyRecord.log` text may be processed exclusively by
on-device AI directly on the partner's device. No server AI, analytics content,
persistent AI storage, or external content service is used.

A supplied surface record may enter the briefing corpus only when all checks are
provable:

- the couple is connected and `status === 'active'`;
- canonical viewer ID and exact partner ID are resolved and distinct;
- the record is part of the supplied PartnerDay surface;
- `record.userId === partnerUserId`;
- the record is persisted (`id`, `userId`, and `createdAt` are present);
- `isPrivate === false`;
- `contentUnavailable` is absent.

The corpus does not widen the PartnerDay surface. Invalid records are excluded
fail-closed and reported as bounded rejection metadata without content.

Structured cycle/bleeding/pain/symptom/health fields and unshared projections are
strictly excluded upstream and are never read or projected.

The AI payload excludes actual record/user/couple IDs, database keys, exact
dates and times, attachment names/URLs/paths, E2EE keys, envelopes,
certificates, recovery material, health/cycle raw data, and author-only emotion
data. The provider request is narrower than the JS domain object: native receives
only request-local item ordinals and TypeScript-created exact-source candidate
strings with request-local candidate ordinals. Day/period grouping, media kinds,
dates, and actual source mappings stay strictly in TypeScript.

Persisted record authority: the current state call path adds records after
successful save. The corpus retains a structural `id`, `userId`, and `createdAt`
presence check rather than a speculative DB flag.

## Provenance and v2 grouping contract

TypeScript assigns request-local item and candidate ordinals. The v2 provider
organizes contiguous items into groups and selects candidate ordinals, returning
zero displayable text:

```ts
interface UntrustedBriefingGroupPlan {
  readonly version: 2;
  readonly groups: readonly {
    readonly groupOrdinal: number;
    readonly choices: readonly {
      readonly itemOrdinal: number;
      readonly candidateOrdinal: number;
    }[];
  }[];
}
```

Every accepted provider response must satisfy:

- integer and structurally well formed;
- known and within the request range;
- non-negative;
- exactly one choice for every requested item ordinal, in request order;
- no missing, duplicate, reordered, or unknown item ordinal;
- each selected candidate ordinal exists for that exact item;
- contiguous source items grouped into 2–4 items per group (or singleton only
  when the request is a single item or deterministic fallback);
- groups never cross day or period boundaries, or a fallback/media-only original
  gap;
- exact root and nested key allowlists (`version === 2`, `groups`,
  `groupOrdinal`, `choices`, `itemOrdinal`, `candidateOrdinal`);
- no provider-originated string or claim field.

After verification, TypeScript alone resolves the selected candidate text and
binds each part to its actual source record ID in:

```ts
interface PartnerBriefingItem {
  readonly parts: readonly {
    readonly text: string;
    readonly sourceRecordId: string;
  }[];
}
```

Actual compression: 2–4 contiguous source items become one final UI item with
exact parts. If a long record cannot safely fit in the chunk budget, it becomes
a deterministic singleton fallback leaf rather than being split or dropped.
Day/period and overview provenance are deterministic unions computed by
TypeScript.

The model cannot author a displayed sentence. Every dynamic displayed phrase is
an exact TypeScript-owned candidate copied from the normalized source; all other
words are fixed TypeScript templates that attribute the phrase to the record.
This mechanical boundary replaces semantic regular expressions as the P1 safety
control. A response containing `text`, `claim`, `title`, `label`, or any other
extra field is rejected. Source extracts may contain the author's own statement,
but the product renders it as attributed source content rather than an app
judgment.

## Normalization and chunking

TypeScript owns exact chronology and display dates. Native sees `dayOrdinal` and
`morning | afternoon | evening | night`, not calendar dates or exact times.
Same-time records are stabilized by record ID before IDs are removed from the
payload.

Chunking and candidate batching are deterministic and never a Top-N selection:

- every prepared event segment belongs to exactly one provider batch, while
  the coverage union retains every eligible source;
- chunks prefer day/period boundaries, then split by a conservative provider
  capability;
- portable core uses measured UTF-8 payload bytes and grapheme/text length when
  a trustworthy token budget is unavailable;
- provider-specific limits may make chunks smaller but may never remove a
  source;
- prompt and structured-output reserve are included in the budget, and the
  final nested candidate request is measured before it crosses the provider;
- if one record would require multiple model segments or cannot fit the native
  envelope whole, the pipeline keeps that record as one deterministic fallback
  singleton rather than sending fragments, truncating it, or dropping it.

Every eligible source is represented in the final day/period item hierarchy.
The overview owns the exact union of every source. Provider batching may become
smaller but never removes an item; an item that cannot safely fit uses its
deterministic exact-source representation.

## Provider and pipeline contract

The portable TypeScript pipeline is completed with a fake provider before any
native provider. Platform differences stay behind one provider contract covering
availability, conservative capability, extract-plan selection, cancellation,
timeout, and request correlation.
The pipeline enforces a whole-run deadline across all batches.

The pipeline processes every bounded candidate batch independently:
- iOS: Foundation Models on-device provider (`OnDeviceBriefing.swift`).
- Android: no model provider in the base APK. The bridge reports `unsupported`, so the
  deterministic exact-source path remains active on every Android API level.
- iOS keeps a bounded in-memory pre-start cancellation set inside the provider actor,
  so a cancel that arrives before request registration cannot start a model session.

### Android packaging boundary

Google's current ML Kit GenAI Prompt API requires API 26+ and its AAR declares that
floor. The app remains `minSdk 23`, Google Play is outside the iOS-first release scope,
and Android users retain the web/PWA and Supabase-backed shared-data path. Therefore:

- the Android module has no `genai-prompt` dependency or inference engine;
- its manifest has no `tools:overrideLibrary` minSdk bypass;
- the merged app manifest has no ML Kit process-start provider or AICore permission;
- the Capacitor bridge methods remain registered and return `unsupported` /
  `E_UNAVAILABLE`, preserving the JavaScript provider contract and deterministic
  fallback.

Verification status as of 2026-08-30:

| Claim | State | Evidence |
|---|---|---|
| Android module and debug APK compile | **PASS** | Gradle compile + assemble |
| Runtime dependency graph excludes ML Kit GenAI | **PASS** | Gradle `debugRuntimeClasspath` |
| Merged manifest excludes ML Kit/AICore entries | **PASS** | built merged manifest |
| JS deterministic fallback contract | **PASS** | provider/fallback Vitest + bridge static guard |
| API 23/24/25 physical-device cold start | **UNVERIFIED** | no physical devices were run for this delta |

A failed, timed-out, cancelled, or malformed batch uses deterministic exact-source
items for that batch; verified sibling choices remain usable. Provider-selected text is
never fed into another provider request.

The public hierarchy is intentionally closed and auditable:

```text
Level 1: deterministic whole-window counts and media summary
Level 2: every source item grouped by exact JS date and coarse period
Level 3: each item opens its exact TypeScript-bound recordId
```

Progressive disclosure renders 20 compressed groups at a time and eventually
exposes every exact original without capping or omitting items.

The public result records:

```ts
generation: 'on_device' | 'hybrid' | 'deterministic'
```

Node/item generation metadata may remain internal. `on_device` means every
eligible textual item used a verified on-device candidate choice; `hybrid` means
verified choices and deterministic item choices coexist; `deterministic` means
no provider choice was used. In all three modes displayed prose remains
source-extractive plus fixed TypeScript templates.

An old response cannot commit after a newer request, timeout, cancellation, or
unmount. Briefing plaintext is not persisted to Supabase, localStorage,
IndexedDB, or files and is not logged. Initial implementation has no global AI
cache; stable request identity prevents rerender duplication within the hook.

## Active UI contract

The active path is:

```text
PaperHome -> /story/partner -> StoryRoute -> StoryViewer
```

`PartnerDayTimelineWidget` is not the integration surface. With the new feature
flag off, the current daily-summary cover remains. With the flag on, Partner
Briefing is the first compression layer and the old cover is not rendered:

```text
flag OFF: old dailySummary cover -> moment cards -> closing
flag ON:  Partner Briefing      -> moment cards -> closing
```

Partner Briefing provides a short overview, expandable day/period sections, and
exact original links. Existing moment cards, exact navigation, closing card, and
explicit acknowledgement remain unchanged. Generating, opening, scrolling, or
following a briefing link never writes CONFIRMED.

## Migration and rollback

No database migration, projection column, or server AI is required. The initial feature flag is
default off. Rollback is disabling that flag, which restores the existing cover
without changing records, receipts, or native keys. Legacy daily-summary removal
is a separate cleanup gate after imports, call sites, tests, flags, native
registration, and Story integration prove it dead.

## Phase gates

1. **A1 Contract** — domain and wire types only, plus contract tests.
2. **A2 Corpus** — supplied-surface privacy gate only.
3. **A3 Normalizer** — chronology, day ordinal, period, media kinds, ID-free payload.
4. **A4 Chunker** — deterministic budget and exact source coverage.
5. **A5 Provider contract + fake** — no native code.
6. **A6 Verifier** — closed extract-plan schema, candidate membership, order, and coverage.
7. **A7 Pipeline + fallback** — candidate generation/batching, deterministic hierarchy,
   partial failure, cancellation, and stale rejection, including forced 30/100/300 tests.
8. **A review** — independent Terra review before UI/native work.
9. **B UI** — active Story route integration and rendered verification.
10. **C iOS**, **D Android**, **E real devices**, **F final integration**.

Each implementation phase is narrow, does not pre-build the next phase, and must
leave PartnerDay, acknowledgement, auth, and E2EE protocols unchanged.

## Orchestration and platform selection

The default implementation loop is Gemini 3.7 Flash High bounded Worker phases
and Terra High independent reviews. Architecture blockers use
`main/gpt-daybreak-blue-latest` with effort selected for the risk. Luna High
may execute the identical Worker specification only when repeated Flash provider
failures prevent the phase from running. Kiro/Opus is not part of the default
path.

### Gate D — Android SDK selection: DEFERRED

No Android GenAI SDK ships in the base APK. ML Kit GenAI Prompt remains a possible
future Google Play implementation candidate, but adopting it requires a separate
packaging decision that does not bypass its API 26 floor. Until Google Play enters
scope, Android uses deterministic exact-source briefing output.

Runtime capability detection stays in the JS provider contract: the Android bridge
answers `availability` with `unsupported` and rejects `selectExtracts` with
`E_UNAVAILABLE`, which is the same signal every unavailable provider gives. The
Deterministic fallback path therefore renders every eligible source from its exact
original, and no source is dropped. Cancellation keeps the same bridge contract, so
a cancel that arrives for an unknown request resolves without side effects.

**Server inference remains forbidden**, and no AI result is persisted.

**Still UNVERIFIED:** physical API 23/24/25 cold start and the Android WebView fallback
were not exercised for this packaging delta. There is no physical Android device
evidence for this release.
