# Diary · Garden · Shop V2 — PR CI remediation

Status: **DRAFT PR UPDATED / FINAL CI RERUN PENDING**
Date: 2026-09-02 KST
Worktree: `/private/tmp/gomsinlog-diary-garden-shop-20260901`
Branch: `codex/diary-garden-shop-v2`
Draft PR: https://github.com/yesung23/gomsin-log/pull/92
Reviewed application commit: `8d463c1685d071634c88eef4564e0ec6844d5758`
Browser-contract commit: `75c08708c5ea4f0bd788affa5b5dbdb2480cf967`
Date-fixture commit: `4b8a8f94d8e8997275d2ca2c824103728e847745`
Live `origin/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`

## Outcome

The first PR run exposed four stale real-browser expectations left behind by the approved paper-setting ownership change. Luna replaced them with the actual user contract: Diary `상점 열기`, Shop `무료로 받기 → 적용하기 → 사용 중`, and Settings-owned text-size controls only. The resulting remote real-browser creator/partner matrix passed in 5m44s.

The same run then reached an unrelated pre-existing Search test whose fixed vacation date, 2026-09-01, had become past on the 2026-09-02 UTC runner. The test now pins its own clock to 2026-08-27 and restores real timers even if render throws. Product/Search implementation is unchanged.

## Verification

- Updated real-browser specs — **PASS, 16/16 locally**.
- Remote real-browser creator/partner matrix on `75c0870` — **PASS, 5m44s**.
- Search suite after clock isolation — **PASS, 27/27**.
- Full local Vitest after clock isolation — **PASS, 279 files / 3,918 tests**.
- `npm run typecheck` — **PASS**.
- `npm run lint` — **PASS**.
- `git diff --check` — **PASS**.
- Terra browser-test delta review — **PASS**, no Critical/Important and no hidden regression.
- Terra clock-isolation review — first **HOLD** for a render-exception timer leak; after the try/finally boundary was widened, final **PASS**, no Critical/Important.

## Boundaries

- Feature behavior, DB/schema/migration/RLS/auth/crypto: **UNCHANGED by this remediation**.
- Supabase, production master, TestFlight, App Store, and physical device: **NOT APPLIED**.
- Vercel shown in PR checks is an automatic preview, not production promotion.
- Final required checks on the documentation-inclusive HEAD remain the next gate; this report does not claim them green in advance.

## Next safe action

Push this factual report without `control-tower/Now.md`, wait for every required check on the exact final Draft PR HEAD, and report the result without merging or deploying.
