# 2026-08-24 Release Repair and Master Promotion

## 판정

`PASS — code, local verification, exact-SHA CI, PR, and master promotion.`

The repository was repaired from the dirty-worktree verification failure and
promoted to `master` at `b2ca94f2e185c694a3d930bde06f8432e1f66c01`.

## 범위

- The production browser fixture now routes the additive
  `get_partner_profile_with_username` RPC introduced by migration 060.
- The sync path uses the new partner username projection and falls back to
  `get_partner_profile` only for the exact missing-RPC code `PGRST202`.
- Migration `060_partner_username_projection.sql` and its contract test are in
  the repository. It keeps the ordinary `profiles` RLS boundary unchanged and
  exposes only the active partner projection to authenticated callers.
- The Search/My/profile, service-tier, photo-grid, story-highlight, and related
  documentation changes already present in the working tree were included in
  the release commit.

## 확인한 저장소·원격 상태

- repository: `/Users/han-yejun/Desktop/곰신로그`
- release commit: `b2ca94f2e185c694a3d930bde06f8432e1f66c01`
- `origin/master`: same SHA, confirmed after push
- feature ref: same SHA
- PR #89: `MERGED`, base `master`, head `b2ca94f`
- Vercel preview for the exact SHA: PASS; deployment completed
- production URL probe: `https://gomsin-log.vercel.app/us` returned HTTP 200

## 검증 결과

| 검증 | 결과 | 실제로 증명한 것 |
|---|---|---|
| `git diff --cached --check` | PASS | staged release diff에 whitespace 오류 없음 |
| `npm run verify` | PASS | typecheck, lint, 231 Vitest files / 3279 tests, build |
| `npm run test:e2e` first run | FAIL, 97/99 | two 390px couple-matrix layout cases timed out in the full suite |
| isolated retry of the two failed cases | PASS, 2/2 | the two cases pass outside the transient full-suite timing condition |
| `npm run test:e2e` second full run | PASS, 99/99 | current browser fixture and production bundle pass the complete local browser suite |
| `npm run test:phase0` | PASS | fresh PostgreSQL 17, 58 migrations, 333 actor/security assertions, including 060 |
| PR #89 exact-SHA CI | PASS | web/native builds, real-browser matrix, PostgreSQL, Deno, Android, iOS, Capacitor, audit, boundary, secret scan |
| production HTTP probe | PASS | deployed `/us` responds with HTTP 200; this is not an authenticated two-account proof |

## 데이터베이스·배포 경계

- repository migration 060: **COMMITTED**
- remote Supabase migration 060: **NOT APPLIED BY THIS TASK / UNVERIFIED**
- remote Supabase data or RLS mutation: **NOT APPLIED**
- master push: **APPLIED**
- PR merge state: **MERGED**
- Vercel deployment: preview exact SHA PASS; production HTTP 200 confirmed. Full
  authenticated production flow remains **UNVERIFIED**.

The client remains compatible with a remote deployment that does not yet expose
060 because the fallback is limited to `PGRST202`. A permission, authentication,
or other server error is not silently converted to the legacy path.

## 남은 위험

- The remote Supabase catalog and migration ledger were not independently
  dumped or mutated. The presence of migration 060 in Git is not proof that the
  remote project has applied it.
- Authenticated two-account, two-device refresh of partner username and shared
  highlight state was not proven in production.
- BrowserStack physical-device verification remains blocked by the separate
  BrowserStack authentication gate recorded in its existing report.
- The local build still emits the existing large-chunk warning; no unrelated
  bundling refactor was introduced for this release repair.
- The worktree still intentionally contains excluded local assets:
  `.DS_Store`, the Obsidian graph, and `gomsin.game.zip`. They are not part of
  the release commit.

## 다음 최소 작업

Apply migration 060 through the approved Supabase migration gate, then run the
two authenticated actor checks and the save → refresh → re-login username flow.
Do not make that production mutation implicitly from this repository task.
