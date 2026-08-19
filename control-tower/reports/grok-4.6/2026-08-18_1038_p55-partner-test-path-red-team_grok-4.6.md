---
agent: grok-4.6
agent_note: "[[Grok 4.6]]"
date: 2026-08-18
time: "10:38"
task: "P5.5 Partner Test Path Red Team"
phase: P5.5
status: closed
canonical: false
tags:
  - agent/grok-4.6
  - phase/p5-5
  - report
---

> Non-canonical agent report. Authority order in [[AI_ENTRYPOINT]].
> Agent: [[Grok 4.6]] · Gate at the time: [[Current Gate]]

# P5.5 Partner Test Path Red Team

**Agent:** grok-4.6
**Mode:** READ-ONLY TARGETED RED TEAM
**Timestamp (Asia/Seoul):** 2026-08-18_1038
**Task:** p55-partner-test-path-red-team

## Live Verified State

- Repository: yesung23/gomsin-log
- master: 8a2167073bce4d9c9ef6dbe35f1b40a8122180c6
- Approved production/security HEAD: 0660ad277dec0a62be3b315cf3668fadf91c282b
- Harness candidate: origin/fix/p5.5-browser-e2e-harness @ 639abd778311ab56f2069922e97cc1583afe5867
- Ancestry: 0660ad277 → 34515b457 → 639abd778
- Production/security delta vs 0660ad277 under src/ packages/ ios/ android/ supabase/: ZERO
- PR #68: OPEN / DRAFT, head integration/p5.5-approved-stack @ 0660ad277 (untouched)
- PR #69: OPEN / DRAFT, CI-ONLY, head fix/p5.5-browser-e2e-harness @ 639abd778 (untouched)
- Master-validation run: 32084365160
- CI browser matrix: 66 tests, 65 PASS, 1 FAIL
- Chromium install in GitHub Actions: PASS
- Targeted creator protection_required test: PASS
- Targeted partner protection_required test: FAIL before save/protection logic

This review did not modify any implementation file, PR, or branch.

## VERDICT

TEST_PATH_BUG

Not TEST_FIXTURE_BUG.
Not PRODUCT_BUG.
Not SECURITY_BEHAVIOR_BUG.

The partner assertion never reached save/protection because the test used a creator-only default home entry.

## ROOT CAUSE

Commit 639abd778 loops CREATOR and PARTNER through the identical Home path:

```ts
await goto(page, '/');
await page.getByRole('button', { name: '한줄' }).click();
```

That path is semantically correct only for CREATOR (`role: 'gomsin'`).

PARTNER is `role: 'soldier'`. The default soldier home does not include the `today_word` composer widget, so `/` never renders a `한줄` button. Playwright waited 60 seconds and the test ended before any Save, protection_required toast, Settings CTA, or daily_records write assertion.

The mockBackend seed `{ widgetLayout: ['today_word', 'dday'] }` does not rescue the partner path. WidgetDashboard reads `soldierWidgetLayout` for `role === 'soldier'`, then falls back to `DEFAULT_LAYOUT_BY_ROLE.soldier = ['partner_day', 'talk_about_list', 'dday']`.

This is an entry-path bug in the new regression, not a product authoring hole and not a security-behavior defect. The same CI run already proved the creator path reaches the intended protection_required contract.

## EVIDENCE

1. Failure point is e2e/coupleMatrix.spec.ts:394, before composer fill/save:
   `await page.getByRole('button', { name: '한줄' }).click();`
   Playwright waited 60s; Chromium install succeeded; all other master-validation jobs passed.

2. Production Home at 0660ad277:
   - HomePage always renders WidgetDashboard.
   - WidgetDashboard uses `soldierWidgetLayout` for soldier, else `widgetLayout`.
   - Empty/missing stored soldier layout falls back to `DEFAULT_LAYOUT_BY_ROLE.soldier`.
   - `DEFAULT_LAYOUT_BY_ROLE`:
     - gomsin: `['today_word', 'partner_day', 'talk_about_list', 'dday']`
     - soldier: `['partner_day', 'talk_about_list', 'dday']`
   - `today_word` is the only default widget that renders TodayLogWidget and therefore `한줄`.
   - `today_word` is allowed for both roles (`widgetsForRole`) but is not on the soldier default.

3. Product contract at PRODUCT_V3 §5 / §5.1:
   - Home default order may differ by role.
   - Record tab is the non-removable authoring surface: "새 기록을 작성한다."
   - Role is default layout, not access restriction. Both roles must be able to start a record.

4. RecordPage at 0660ad277:
   - Always exposes floating CTA `지금의 마음 남기기`.
   - No soldier/gomsin gate around `showComposer`.
   - Opening the sheet mounts the same TodayLogWidget used on Home.
   - RecordPage.test.tsx documents this as the reliable, non-removable composer even when widgetLayout is empty.

5. homeComposer.test.tsx itself records that soldier default no longer contains `today_word`. Its soldier composer assertions force `soldierWidgetLayout: ['today_word', 'dday']` for that reason.

6. Harness fixtures remain legitimate for the security contract and do not need reopening:
   - dailyRecordWrites is test-only observation of POST/PUT daily_records payloads
   - recovery_identities GET → []
   - crypto_write_floor GET → []
   - talk_about_marks GET → []
   - no CSK/PMK/HRK/device trust fabricated
   - no write-floor activation fabricated
   - PARTNER is connected (`partnerPresent: true`) and opposite role, which is correct

7. This is not PRODUCT_BUG because a supported partner authoring path exists: `/record` → `지금의 마음 남기기` → `한줄`. Absence of Home `한줄` for soldier is intentional default layout, not a missing composer.

8. This is not SECURITY_BEHAVIOR_BUG because the failure occurs before Save. The creator variant in the same CI run already exercised the protection_required contract.

## ACTUAL PARTNER AUTHORING PATH

Supported default path for connected soldier/partner:

1. Tab bar `기록` or `goto('/record')`
2. Click role=button name `지금의 마음 남기기`
3. In dialog `지금의 마음 남기기`, click role=button name `한줄`
4. Fill placeholder `지금 이 순간, 어떤 생각을 하고 있나요?`
5. Click role=button name `저장`

Creator may keep Home `/` → `한줄` because gomsin default includes `today_word`.

Do not invent other selector labels. Do not add `today_word` to soldier default merely to make the two tests identical.

## MINIMAL PATCH RECOMMENDATION

e2e-only. Smallest valid change is the partner entry path in `e2e/coupleMatrix.spec.ts`.

Keep one shared assertion body after the composer is open. Split only the entry:

```ts
if (label === 'creator') {
  await goto(page, '/');
  await page.getByRole('button', { name: '한줄' }).click();
} else {
  await goto(page, '/record');
  await page.getByRole('button', { name: '지금의 마음 남기기' }).click();
  await expect(page.getByRole('dialog', { name: '지금의 마음 남기기' })).toBeVisible();
  await page.getByRole('button', { name: '한줄' }).click();
}
```

Then keep the existing assertions unchanged:

- fill `지금 이 순간, 어떤 생각을 하고 있나요?` with `보호가 필요한 기록`
- Save enabled, then click Save
- draft remains
- `기록 보호 설정이 필요해요`
- `설정 열기`
- `dailyRecordWrites.length === 0`
- no PAGEERROR
- no unexpected unrouted calls except the existing talk_about_marks filter

Do not change mockBackend unless a later CI rerun proves the Record-tab path cannot open without it. Current seed is sufficient for RecordPage because that page does not consult widget layout.

Do not modify production code to put `한줄` on soldier Home.

## SECURITY ASSERTIONS PRESERVED

The required Partner contract remains after the path correction:

- connected + online + unprovisioned device
- attempting a shared protected write
- protection_required
- draft/content remains
- Settings CTA appears
- dailyRecordWrites.length === 0
- no plaintext persistence
- no fabricated trusted device/cert/key/floor state

No assertion should be weakened. No production write-floor or crypto state should be seeded.

## FILES THAT SHOULD CHANGE

- e2e/coupleMatrix.spec.ts only, in a later implementer pass

## FILES THAT MUST NOT CHANGE

- src/**
- packages/**
- ios/**
- android/**
- supabase/**
- master
- PR #68
- integration/p5.5-approved-stack
- Dashboard.md / Current Gate.md / Decision Log.md (this agent)

This review also did not change PR #69 or the harness branch.

## REVIEW IMPACT

DELTA

Scope: partner entry path of the new connected protection_required browser test only. Existing creator path, mock contracts, and production/security stack do not require a full re-review.

## NEXT OWNER

Grok Build implementer on fix/p5.5-browser-e2e-harness:

1. Apply the e2e-only partner entry-path patch
2. Push normally to the same harness branch / Draft PR #69
3. Re-run GitHub Actions master validation
4. Require both targeted protection_required tests PASS inside the suite
5. Do not merge #69 or #68

Then return to Grok 4.6 only if the new CI result is not a clean confirmation of this path fix.

## STOPPED AT

- exact HEAD: 639abd778311ab56f2069922e97cc1583afe5867 (harness, unchanged)
- approved security HEAD: 0660ad277dec0a62be3b315cf3668fadf91c282b
- branch reviewed: origin/fix/p5.5-browser-e2e-harness
- PR: #69 remains DRAFT / CI-ONLY; #68 remains DRAFT at 0660ad277
- changed (this delta only): control-tower/reports/grok-4.6/2026-08-18_1038_p55-partner-test-path-red-team_grok-4.6.md
- explicitly not changed: src/**, packages/**, ios/**, android/**, supabase/**, e2e/**, master, PR #68, PR #69, integration/p5.5-approved-stack, Dashboard.md, Current Gate.md, Decision Log.md
- tests executed: none (read-only review of production code at 0660ad277, harness at 639abd778, live PR/CI metadata)
- tests not executed: no local Playwright, no new CI, no unit/typecheck/lint
- Production: NOT APPLIED
- Supabase: untouched
- P6: NOT AUTHORIZED
- next owner / next action: Grok Build e2e-only partner entry-path patch, then CI rerun on #69
