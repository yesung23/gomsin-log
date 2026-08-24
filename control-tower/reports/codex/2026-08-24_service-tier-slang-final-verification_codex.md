# 복무 은어 레벨 V1 최종 로컬 검증 보고서

기준일: 2026-08-24 14:07 KST
저장소: `/Users/han-yejun/Desktop/곰신로그`
브랜치: `codex/service-rank-profile-settings-impl`
HEAD: `c16537047924ec5e164fb36b8dad1aa2fb661b52`
`origin/master`: `7f4886bcbe32034bfabb454c85378532b14cb261`

## 범위

- `/search` 군화 복무 카드의 대표 레벨을 `LV 1 신병 → LV 7 왕고`로 변경
- 전체 복무율 경계 `0/10/25/40/55/70/85%`와 1초=1 EXP 계산 유지
- `일꺾`·`상꺾` 진입 feedback의 번개 아이콘/강조, `왕고`의 카드 내부 왕관 강조
- 실제 행정 진급·관계 점수·닉네임 등급으로 해석되지 않도록 안내 문구와 접근성 문구 유지
- 곰신 상대 복무 정보의 권장 위치 기록: `/search` 검색창 아래, 주기 표면 앞의 별도 `상대 복무` 카드

## 변경 파일

- `src/lib/serviceLevel.ts`
- `src/lib/serviceLevel.test.ts`
- `src/features/search/SearchPage.tsx`
- `src/features/search/searchPage.test.tsx`
- `docs/V4_AS_BUILT.md`
- `docs/V4_BACKLOG.md`
- `docs/CURRENT_STATE.md`
- `docs/WORK_LOG.md`

## 검증 결과

- PASS — `npm test -- --run src/lib/serviceLevel.test.ts src/features/search/searchPage.test.tsx`: 2 files / 36 tests
- PASS — `npm test -- --run src/lib/typeScale.test.ts src/lib/serviceLevel.test.ts src/features/search/searchPage.test.tsx`: 3 files / 59 tests
- PASS — `npm run typecheck`
- PASS — `npm run lint`
- PASS — `git diff --check`
- PASS — `npm run verify`: 231 Vitest files / 3287 tests, typecheck, lint, Vite production build
- PASS — UI copy scan: source path has no remaining `게임식 성장`/`게임식 복무` wording
- BUILD NOTE — existing Vite warning for the approximately 654 kB main chunk remains; build exit code is 0

## 독립 검토 및 위임 상태

- Gemini 3.7 Flash Max implementation dispatch: BLOCKED. First provider call failed with an Antigravity `thought_signature` error; one retry did not return before the bounded wait and was stopped. No Gemini result was accepted as evidence.
- Sol Max read-only review: UNVERIFIED/BLOCKED. A final `main/gpt-5.6-sol` max dispatch did not return within three bounded waits and was stopped. Earlier high-review findings were repaired locally, but that earlier review is not promoted to a final exact-content Sol Max verdict.
- No code, migration, remote database, PR, push, merge, or deployment action was performed by the review agents.

## 데이터·배포 경계

- DB/migration: NOT CHANGED. No EXP migration and no partner military projection migration was created or applied.
- Remote Supabase: NOT APPLIED / UNVERIFIED.
- Vercel/production: NOT DEPLOYED / UNVERIFIED.
- Authenticated browser or two-account device verification for this dirty branch: UNVERIFIED.
- Server-authoritative clock: NOT BUILT. This is display-only V1 using the fixed Seoul date timeline and device `Date.now()`; it must not drive rewards, push, sharing, or authorization.

## 곰신 상대 복무 정보의 다음 설계

권장 위치는 `/search`의 검색 입력 바로 아래, 곰신의 주기/컨디션 surface 앞이다. 노출 allowlist는 군종, 복무 상태, 입력된 입대일·전역일, 진행률, D-day, 복무 레벨만으로 제한한다. 메모, 부대 상세, 건강/주기/출혈량은 포함하지 않는다. 현재 동기화 경로는 파트너 identity만 제공하므로 구현하지 않았으며, active couple 전용 RPC/RLS와 본인·상대·전 파트너·제3자·anon negative actor test를 먼저 통과시켜야 한다.
