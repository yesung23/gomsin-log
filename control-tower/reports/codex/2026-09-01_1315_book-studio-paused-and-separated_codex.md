# Book Studio 보류 및 저장소 분리 Control Tower 보고서

PLAN POSITION
- Phase: Digital Memory Book / standalone Book Studio Supabase read-only stabilization
- Workstream: 곰신로그 앱과 분리된 Book Studio 사이트
- Step: 최신 로컬 보완·독립 보안 검토 후 사용자 요청으로 보류
- Previous Gate: Gate A identity/exact-couple PASS
- This Gate: synthetic fixture 범위 `PASS WITH FINDINGS`; 실자료 연동·migration은 BLOCK

DIRECTION CHECK
- Product source checked: 기존 Book Studio Gate A 및 Supabase read-boundary 보고서와 현재 저장소 상태
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 이번 작업은 제품·고객·가격·저장 정책을 변경하지 않는 보류 정리
- Engineering source checked: `AGENTS.md`, `bash scripts/agent/session-start.sh`, 관련 `docs/WORK_LOG.md` 기록
- Current-state checked: 곰신로그 본 레포, 독립 Book Studio 프론트 레포, 별도 migration worktree의 branch/HEAD/status/remote
- Latest relevant Work Log checked: 2026-09-01 Book Studio Supabase read-only boundary 및 최신 앱 release 기록
- MASTER PLAN version / 기준일: standalone Book Studio Supabase read-only integration / 2026-09-01
- Does this task conflict with canonical direction? NO
- If YES, what conflict: N/A

OWNERSHIP
- Tool: Codex orchestrator
- Model: primary Codex; `gpt-daybreak-blue-latest` High 독립 read-only 보안 검토
- Role: 로컬 상태 정리, 보류 경계 확정, 문서화
- PR: none
- Branch: 본 앱 `codex/profile-post-composer`; Book Studio `codex/book-studio-supabase`; migration `codex/book-studio-supabase-migration`
- Base SHA: 본 앱 `3a4c664d7bfe71a9cca9dc293c818f7ce37bb3e9`; Book Studio 최신 로컬 `826f3af6607a8f90c8accf2126db6fb547d818db`; migration 최신 로컬 `22187dbf84e253113a9bed304d69a1bb521e216d`
- Old HEAD: Book Studio 이전 독립 검토 기준 `555463f`; migration 이전 기준 `0e086f5`
- New HEAD / Reviewed HEAD: Book Studio `826f3af`; migration `22187db`; 본 앱은 이번 정리에서 `3a4c664` 유지

CHANGED / REVIEWED
- file: 별도 Book Studio 프론트 `/Users/han-yejun/Desktop/gomsinlog-book-studio-supabase`
- function/component/migration: publishable-key-only 설정, PKCE callback query/fragment 정리, 계정 전환 stale state 초기화, `get_book_library_page` keyset pagination 및 명시적 추가 로드
- what changed/reviewed: 사용자가 선택한 공개·복호 가능 자료만 읽는 로컬 경계를 보완했고, 실제 source/로그인/Production 연결은 하지 않음
- why: 곰신로그 본 앱의 GitHub에 Book Studio 파일이 함께 올라가지 않도록 저장소를 물리적으로 분리하고, 계정·권한 경계를 유지하기 위해서
- file: 별도 migration `/Users/han-yejun/Desktop/gomsinlog-supabase-book-migration`
- function/component/migration: `068_book_library_read_rpc.sql` page RPC 계약과 privilege 계약
- what changed/reviewed: migration은 별도 브랜치에만 존재하며 remote Supabase에는 적용하지 않음
- why: 대량 기록에서 무제한 library 응답을 피할 준비를 하되 원격 변경은 별도 승인으로 남김

EXPLICITLY NOT CHANGED
- crypto semantics: 변경하지 않음; 암호화 자료는 현재 Book Studio RPC에서 제외
- DB/migration semantics: migration 파일은 로컬 별도 worktree에만 남겼고 push/apply하지 않음
- product semantics: 곰신로그 앱의 핵심 흐름, PartnerDay, 인증, E2EE, RLS를 변경하지 않음
- Production: GitHub push/merge, Supabase, Cloudflare, OAuth allow-list, 배포를 수행하지 않음
- repository boundary: 본 앱 `/Users/han-yejun/Desktop/곰신로그`에 Book Studio 파일을 복사하거나 포함하지 않음

VERIFICATION
- command: `bash scripts/agent/session-start.sh`
- PASS: 본 앱 branch `codex/profile-post-composer`, HEAD `3a4c664`, 활성 claim 없음, remote Supabase UNVERIFIED를 확인
- command: 각 worktree의 `git status --short --branch`, `git rev-parse HEAD`, `git remote -v`
- PASS: 본 앱은 기존 `.DS_Store`와 Obsidian graph 변경만 dirty; Book Studio는 `.unlazy/`만 미추적이고 `826f3af`가 origin보다 1 commit 앞섬; migration은 clean
- command: Book Studio targeted Vitest 3 files / 15 tests
- PASS: 최신 로컬 보완 동작 확인
- command: Book Studio `npm test`
- PASS: 9 files / 76 tests
- command: Book Studio `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`
- PASS: 각 명령이 최신 로컬 커밋에서 성공
- command: migration `npx vitest run src/lib/migration068.test.ts --pool=threads --maxWorkers=1`, typecheck, lint, `git diff --check`
- PASS: 5 tests 및 정적 검증 성공
- command: `supabase db lint --local --schema public --fail-on error`
- BLOCKED / UNVERIFIED: local Postgres `127.0.0.1:54322` 연결 거부; Docker나 원격 DB를 시작·변경하지 않음
- command: Daybreak Blue independent review of exact Book Studio `826f3af` and migration `22187db`
- PASS WITH FINDINGS: synthetic fixture/실자료 flag OFF에 한해 조건부; 실자료 활성화와 migration은 BLOCK

REVIEW IMPACT
- FULL: 최신 auth/data-boundary와 pagination 변경을 포함한 독립 검토를 수행함
- whether an earlier review is stale: `555463f` 이전 검토는 최신 `826f3af`에 대해 stale; 현재 Daybreak 결과가 최신 로컬 커밋을 대상으로 함

BLOCKERS
- code: Storage read policy에 encrypted media의 `cipher_format = 0` 명시 조건이 없을 가능성; 기존 무제한 `get_book_library()` privilege 제거/upgrade 경로 없음; 본문·attachment 총량 제한 부족; 계정 전환 시 `directGestureRef` 미초기화
- environment: remote migration/catalog/function grants, 실제 RLS·Storage, OAuth redirect, Cloudflare 환경변수·artifact, actor별 signed URL 거부가 모두 UNVERIFIED
- external/manual: 사용자가 Book Studio를 보류하고 곰신로그 앱에 집중하도록 우선순위를 변경함

STOPPED AT
- exact completed boundary: Book Studio와 migration의 최신 로컬 commit 및 독립 Daybreak 검토 결과를 보존하고, 진행 중 reviewer를 종료함
- no push, merge, deploy, Supabase mutation, Cloudflare mutation, or app-code change was performed in this pause turn

REMAINING
- Book Studio 재개 시: 위 P1/P2 finding을 먼저 좁게 수정하고, 실제 PostgreSQL·actor·Storage negative test를 staging에서 수행한 뒤 재검토
- Book Studio branch `826f3af`는 origin에 아직 push하지 않음
- migration branch `22187db`는 `yesung23/gomsin-log` remote에 push하지 않음
- 곰신로그 앱은 현재 branch `codex/profile-post-composer`와 기존 dirty 상태에서 별도 작업을 시작

NEXT ACTION
- next owner: 곰신로그 앱 작업 owner
- tool/model: 앱 기능 범위에 맞는 별도 작업; Book Studio 보안 재개 때만 Daybreak Blue 재검토
- 기준 SHA: 본 앱 `3a4c664d7bfe71a9cca9dc293c818f7ce37bb3e9`
- exact next task: Book Studio 폴더를 곰신로그 본 레포에 복사하지 않고, 앱 작업을 본 앱 branch에서 별도 claim으로 시작

DO NOT ADVANCE UNTIL
- Book Studio 재개 시: P1/P2 보완, staging actor/RLS/Storage 검증, legacy RPC upgrade 계획, fresh Daybreak review
- 본 앱 작업 시: 기존 dirty 파일을 보존하고 Book Studio 경로를 본 앱 Git에 추가하지 않음

PRODUCTION
- NOT APPLIED: Supabase, Storage, OAuth, Cloudflare, GitHub push/merge, deploy, payment, or production database changes
- UNVERIFIED: remote schema, RLS/Storage runtime, Cloudflare settings, browser login, physical device
