# 2026-09-01 — Diary / Push OFF / Story On-device AI Product Realignment

## Verdict

**LOCAL CANDIDATE PASS / REMOTE PROMOTION PENDING**

Implementation candidate: `d677e7011c68e33ac3c8aaa21014b5ef95814101`  
Base: `origin/master d69b677634a5526c81dd263a67990361b0df97db`

This report records repository/simulator evidence only. No Supabase, Vercel Production, TestFlight, or App Store mutation was performed by this task.

## Owner decisions implemented

1. Shop surface shows only a small paper-background library.
2. Existing sticker packs/themes/books/payment candidates are hidden rather than deleted.
3. Book Studio remains **FROZEN**.
4. Push is **OFF** in the active product.
5. On-device AI remains active development and is now default-enabled on supported iOS native builds, with an emergency `false|0|off` kill switch.
6. Story does **not** run the model just because the Story was opened. Deterministic summary appears immediately; pressing `AI로 다듬기` starts the on-device refinement immediately.
7. Diary was strengthened around date-scoped paper pages rather than a single sparse month sheet.

## Diary

- Month cards remain the discovery level.
- Opening a month presents date chips for days with records.
- A selected date renders only that date's records.
- Edit mode supports include/exclude, ordering, paper choice, and three constrained layout presets.
- `daily_records` remains the source of truth. Local diary persistence stores ids and presentation metadata, never copied record text/photo content.
- Existing 12 free stickers and historical month placements are preserved in a separate `기존 월 꾸미기` mode. The entire month's records are not duplicated below each daily page.
- Sign-out/account deletion/deletion-recovery content purge now sweeps account-scoped `gomsin.diary.*` local state, including date/page metadata, default paper, and historical sticker placement keys.

## Paper library / Shop

Active paper choices:
- 따뜻한 무지
- 줄 노트
- 모눈 종이
- 도트 종이
- 크림 편지지

The active `/shop` surface is presented as `종이 보관함`. No price, checkout, entitlement, paid sticker pack, theme product, memory book or anniversary-book promise is visible.

## Push OFF

The feature switch defaults OFF.

Disabled product path:
- no native permission request
- no browser Notification permission request
- no native token registration
- no browser system notification
- no native push tap listener

Compatibility cleanup:
- an authenticated connected account best-effort calls token revoke so a token registered by an older push-enabled build does not remain active indefinitely.
- `clear_my_unseen` deliberately remains active while Push is disabled because it is the sender-side pending-delivery boundary for content already viewed; disabling it would make old content more likely to be delivered later.

No send-push function or migration was changed in this task.

## On-device Story AI

### User flow

```text
Story open
→ deterministic authorized summary immediately
→ user presses “AI로 다듬기”
→ supported iOS Foundation Models refinement starts
→ validated result replaces text only
→ exact record targets remain unchanged
```

### Failure flow

```text
unsupported / timeout / cancel / malformed / validation failure
→ deterministic summary stays visible
→ no partial model batch is mixed into the page
```

### Privacy / trust boundary

Native payload contains only ordinal index + normalized text for the already-authorized deterministic summary corpus. It does not send record id, user id, couple id, date/time, attachment URL, cycle/health source data, or private records to the model bridge.

Swift validates exact output count/order/index, non-empty trimmed text and 40 UTF-16 character maximum. JavaScript independently verifies the returned batch before binding text back to record ids.

Web/Android have no model generation path. The Story AI button is absent on web. On native iOS where the plugin exists but the device/model is unavailable, a requested refinement fails closed to the deterministic summary.

## Validation evidence

- `npm run verify`: **PASS**
  - typecheck PASS
  - lint PASS
  - Vitest: **270 files / 3,809 tests PASS**
  - Vite production build PASS
  - main entry: **133.36 kB gzip**
- `npm run verify:native`: **106/106 PASS**
- Edge regression: **18/18 PASS**
- Pre-AI realignment Playwright whole suite: **128/128 PASS**
- Post-AI affected browser suite: **30/30 PASS**
- Story/on-device focused suite: **43/43 PASS**
- `npx cap sync ios`: PASS; local on-device-summary plugin detected
- Xcode 26.6 unsigned iOS Simulator build: **BUILD SUCCEEDED**
- `git diff --check`: PASS

## Review history

An earlier independent Claude review of the realignment working tree found 1 P1 and 6 P2 findings, including the old-token Push issue, `clear_my_unseen` gating, diary local-data purge, a vacuous privacy test, stale per-day paper rendering and duplicate legacy month rendering. Those findings were fixed before candidate `d677e70` and all affected gates were rerun.

A second Claude pass was not available. Therefore this report does **not** claim an independent final-Claude PASS. The primary owner performed an exact-diff review and the validation above.

## Explicitly not changed

- Supabase schema/migrations: NOT CHANGED
- Edge Function source: NOT CHANGED
- E2EE/crypto protocol: NOT CHANGED
- Production Supabase: NOT APPLIED
- Vercel Production: NOT DEPLOYED by this task
- TestFlight/App Store upload: NOT APPLIED
- Book Studio: FROZEN, no added implementation

## Remaining external evidence

A Foundation Models-capable physical iPhone is still required to verify:
- Korean output quality
- airplane-mode / zero-network observation
- cold and warm latency
- thermal behaviour
- battery effect
- real-device cancellation behaviour

Simulator compilation is not evidence for those properties.

## Next action

Fetch `origin/master`, confirm ancestry, and promote the candidate without force only if the current master can safely accept it. If master moved, integrate the new base and re-run the affected validation before pushing. After master push, observe repository CI. Vercel remains a later pre-App-Store-upload web verification tool rather than a mandatory gate for this change.
