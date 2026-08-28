# Partner Briefing Architecture Contract

> Status: Gate 0 approved with amendments on 2026-08-28.
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

```ts
state.authenticatedUser?.id || profile.id
```

The exact partner identity is `profile.couple.partnerUserId`, sourced from active
couple membership. The corpus rejects unresolved or equal identities. This does
not require a PartnerDay state-machine change.

## Corpus privacy boundary

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

The AI payload excludes actual record/user/couple IDs, database keys, exact
dates and times, attachment names/URLs/paths, E2EE keys, envelopes,
certificates, recovery material, health/cycle raw data, and author-only emotion
data. Native payloads may contain only synthetic ordinals, day ordinals,
coarse periods, normalized text, and media kinds.

## Provenance contract

TypeScript assigns synthetic source ordinals. A leaf provider may return grouped
text with `sourceOrdinals`, but the untrusted response is accepted only when the
ordinals across the whole response form an exact partition of the requested
ordinal set:

- integer and structurally well formed;
- known and within the request range;
- non-negative;
- no missing ordinal;
- no duplicate ordinal;
- no unknown or hallucinated ordinal.

After verification, TypeScript alone binds ordinals back to actual record IDs.
Intermediate nodes obtain provenance from the deterministic union of child
source sets. The overview source set is the deterministic union of every
accepted leaf or fallback leaf.

Exact partition proves structural source coverage, not semantic fidelity.
Semantic safety is a separate responsibility: fact-only provider instructions,
bounded output, forbidden-inference checks, adversarial tests, and deterministic
fallback on rejection. No verifier may claim that ordinal validity alone proves
the sentence is supported by its sources.

## Normalization and chunking

TypeScript owns exact chronology and display dates. Native sees `dayOrdinal` and
`morning | afternoon | evening | night`, not calendar dates or exact times.
Same-time records are stabilized by record ID before IDs are removed from the
payload.

Chunking is deterministic and never a Top-N selection:

- every eligible event belongs to exactly one leaf chunk;
- chunks prefer day/period boundaries, then split by a conservative provider
  capability;
- portable core uses measured UTF-8 payload bytes and grapheme/text length when
  a trustworthy token budget is unavailable;
- provider-specific limits may make chunks smaller but may never remove a
  source;
- prompt and structured-output reserve are included in the budget;
- long records use grapheme-safe segments that retain the same source ordinal;
- if safe segmentation is unavailable, that record becomes a deterministic
  fallback leaf rather than being truncated or dropped.

Coverage equality is checked after chunking and after every hierarchy reduction.

## Provider and pipeline contract

The portable TypeScript pipeline is completed with a fake provider before any
native provider. Platform differences stay behind one provider contract covering
availability, conservative capability, summarize, cancellation, timeout, and
request correlation.

The pipeline processes every leaf independently. A failed, timed-out, cancelled,
or malformed leaf is replaced by a deterministic leaf with the same source set;
verified leaves remain usable. Provenance is never merged without source-set
union checks.

The public result records:

```ts
generation: 'on_device' | 'hybrid' | 'deterministic'
```

Node/section generation metadata may remain internal. `on_device` means every
displayed generated section was verified model output; `hybrid` means verified
model and deterministic sections coexist; `deterministic` means no model output
is displayed.

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

No database migration or server AI is required. The initial feature flag is
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
6. **A6 Verifier** — structural provenance and semantic-safety rejection.
7. **A7 Pipeline + fallback** — hierarchy, partial failure, cancellation, stale rejection.
8. **A review** — independent Terra review before UI/native work.
9. **B UI** — active Story route integration and rendered verification.
10. **C iOS**, **D Android**, **E real devices**, **F final integration**.

Each implementation phase is narrow, does not pre-build the next phase, and must
leave PartnerDay, acknowledgement, auth, and E2EE protocols unchanged.
