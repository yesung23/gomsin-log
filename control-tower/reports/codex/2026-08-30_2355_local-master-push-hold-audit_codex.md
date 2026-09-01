---
agent: codex
agent_note: "[[Codex]]"
date: 2026-08-30
time: "23:55"
task: "Local master push-hold audit and shared-session reconciliation"
phase: release-integration
status: blocked
canonical: false
tags:
  - agent/codex
  - report
  - release-gate
  - privacy
  - partner-briefing
---

> Non-canonical agent report. Authority order in [[AI_ENTRYPOINT]].
> 이 보고서는 실제 Obsidian vault `/Users/han-yejun/Desktop/곰신로그/control-tower/reports/codex/`에 기록했다.

# 로컬 master push 중지 감사와 공유 세션 대조

## 최종 판정

**FAIL / PUSH HOLD**

- 로컬 `master`의 Git 구조와 자동 검증은 정상이다.
- 그러나 공개 GitHub의 `origin/master`로 현재 47개 커밋을 그대로 push하면 안 된다.
- P0는 확인되지 않았다. 개인정보·핵심 기능 정확성·접근성 P1 세 건을 확인했다.
- 문제 커밋은 아직 GitHub 원격에 존재하지 않아, 이번 감사 시점에 공개 Git 이력 유출은 확인되지 않았다.
- commit, push, merge, deploy, Supabase, Vercel, Cloudflare, Apple, TestFlight 변경은 하지 않았다.

## 사용자가 연결해 준 다른 세션

사용자가 제공한 ChatGPT 공유 링크를 읽기 전용으로 확인했다. 해당 공유 세션은 별개의 불명확한 작업이 아니라, 아래 로컬 `master`를 만든 바로 그 세션이었다.

- 세션에서 보고한 최종 로컬 HEAD: `e5cca5fbf0c8e74495526cbf9a16da5c4908cd85`
- 실제 로컬 `master` HEAD: `e5cca5fbf0c8e74495526cbf9a16da5c4908cd85`
- 세션에서 보고한 주요 커밋:
  - `49b2f00` — Partner Briefing merge
  - `efd1c73` — Naver place-panel OCR 보정
  - `89094a5` — OCR 결과 사용자 확인 전 저장 차단
  - `e5cca5f` — 통합 검증 문서 closure

따라서 이 감사의 대상과 공유 세션의 작업 대상은 정확히 일치한다. 공유 세션의 완료 보고를 자동 신뢰하지 않고 Git 관계, 실제 diff, 테스트와 호출 경로를 다시 확인했다.

> [!warning] 공유 링크 노출
> 공유 링크는 로그인 없이 `Shared Codex chat`으로 열렸고 로컬 경로, branch, commit SHA, 보안 검토 내용이 표시됐다. 확인 후 공유 해제를 권장한다. 이번 감사에서는 공유 상태를 변경하지 않았다.

## 정확한 Git 상태

### 원격

- GitHub repository: `yesung23/gomsin-log`
- visibility: **PUBLIC**
- live `refs/heads/master`: `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`

### 로컬 master

- worktree: `/private/tmp/gomsinlog-master-integration-20260830`
- branch: `master`
- HEAD: `e5cca5fbf0c8e74495526cbf9a16da5c4908cd85`
- status: clean
- relation: `master...origin/master` = **47 ahead / 0 behind**
- merge base: `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`

Git history가 갈라지거나 손상된 상태는 아니다. 원격 master는 로컬 master의 정확한 조상이므로 기술적으로는 fast-forward 가능하고 force push도 필요 없다. 하지만 아래 P1 때문에 **push 가능**과 **push 안전**은 다르다.

## 확인된 P1

### P1-1 — 실제 캡처에서 파생된 OCR 원문이 공개 예정 Git 이력에 포함됨

커밋 `efd1c73445610b8360075f21798d153aa6d89ebe`의 commit message는 사용자 캡처 3장을 앱과 같은 OCR 엔진으로 측정했고 실제 OCR 텍스트를 fixture로 커밋했다고 명시한다. 최종 트리에도 해당 OCR 원문 fixture 세 파일이 존재한다.

- `src/lib/__fixtures__/naver-place-bbq-chicken.txt`
- `src/lib/__fixtures__/naver-place-dotori-garden.txt`
- `src/lib/__fixtures__/naver-place-shilla-noodle.txt`

이 보고서에는 OCR 원문, 장소명, 영업정보 또는 지도 내용을 복제하지 않는다. 핵심은 해당 텍스트가 합성 fixture가 아니라 실제 사용자 제공 캡처에서 파생됐다는 점이다. 저장소는 PUBLIC이므로 push하면 원문이 Git 이력에 남는다. 후속 커밋에서 파일만 삭제해도 기존 commit object는 남으므로 충분한 해결이 아니다.

확인 결과:

- `git branch -r --contains efd1c73`: 해당 원격 branch 없음
- GitHub commit API에서 `efd1c73`: 찾을 수 없음
- 현재 공개 유출: **확인되지 않음**
- 현재 local master push: **금지**

최소 해결은 `origin/master`에서 깨끗한 대체 통합 branch를 만들고 `efd1c73`을 조상으로 포함하지 않은 채 OCR 로직을 완전한 합성·익명화 fixture로 다시 통합하는 것이다.

### P1-2 — profile realtime refresh가 exact partner identity를 떨어뜨림

직접 대조한 호출 경로:

- `src/lib/sync.ts`의 full-state profile 구성은 partner profile을 읽지만 새 `couple` 객체에 `partnerUserId`를 넣지 않는다.
- `src/lib/store.tsx`의 profile invalidation refresh는 반환된 profile로 기존 profile 전체를 교체한다.
- exact partner를 다시 결속하는 effect는 connected lifecycle/couple ID 변화에 의존하므로 같은 active couple의 profile refresh만으로는 다시 실행되지 않는다.
- `supabase/migrations/059_partner_managed_username.sql`은 partner username 변경 후 실제 `profile` slice invalidation을 발생시킨다.

결과적으로 Partner Briefing의 exact-partner gate가 fail-closed 되어 앱 재시작 또는 관계 lifecycle 변화 전까지 브리핑이 사라질 수 있다. 다른 사용자의 자료가 노출되는 결함은 아니지만, 정상 사용자 경로가 끊기는 확정 통합 결함이다.

최소 해결은 profile slice 갱신에서 검증된 기존 partner identity를 안전하게 보존하거나, 현재 couple membership을 다시 조회해 exact partner를 재결속하고 이 invalidation 경로의 회귀 테스트를 추가하는 것이다.

### P1-3 — 서로 다른 exact-original 버튼의 접근성 이름이 동일함

`src/components/widgets/PartnerBriefingCard.tsx`에서 서로 다른 source record를 여는 모든 버튼이 `원본 보기` 또는 `View original`이라는 같은 accessible name을 사용한다. 각 버튼의 `aria-describedby`가 서로 다른 본문을 가리키지만 VoiceOver의 버튼 목록에서 원본 대상을 명확히 선택하기 위한 고유 이름이 되지는 않는다. 현재 테스트도 동일 이름의 버튼이 여러 개 존재하는 것을 정상으로 고정한다.

최소 해결은 각 버튼 이름이 연결된 문장 또는 안정적인 항목 번호를 포함해 서로 구분되도록 하고, exact source navigation 및 한국어·영어 접근성 회귀 테스트를 추가하는 것이다.

## primary가 직접 실행한 검증

| 검증 | 결과 | 실제로 증명하는 것 |
|---|---|---|
| live `git ls-remote --heads origin refs/heads/master` | PASS | 실제 원격 master가 `b7d59ac...`임 |
| ancestry / merge-base / ahead-behind | PASS | 로컬 master는 47 ahead, 0 behind인 정상 fast-forward 구조 |
| `git diff --check origin/master..master` | PASS | 통합 diff whitespace 무결성 |
| `npm run verify`의 typecheck | PASS | exact local master의 TypeScript 계약 |
| `npm run verify`의 lint | PASS | exact local master의 전체 lint |
| `npm run verify`의 full Vitest | PASS — 281 files / 4,337 passed / 2 skipped | JS/TS 자동 회귀; 실물 기기 증거는 아님 |
| 환경변수 없는 `npm run verify` 최종 build 단계 | EXPECTED FAIL — `VITE_SUPABASE_URL` 누락 | 저장소의 fail-closed build guard가 작동함 |
| CI와 같은 비밀이 아닌 placeholder로 `npm run build` | PASS — 2,180 modules | production bundle 생성 가능 |
| `npm run verify:native` | PASS — 4 files / 107 passed / 2 skipped | native 구성·privacy manifest·asset·permission 정적 계약 |
| `git fsck --no-dangling --no-progress` | PASS | Git object 무결성 |
| Kiro `gpt-5.6-sol` Max 독립 read-only review | FAIL / PUSH HOLD | 위 P1 세 건과 추가 검증 공백 발행 |

테스트 성공은 P1을 반박하지 않는다. OCR provenance, profile invalidation 후 identity 유지, 여러 exact-original 버튼의 고유 accessible name을 기존 suite가 충분히 검사하지 않았기 때문이다.

## 실물·원격 검증 공백

- exact final master의 실물 iPhone/Foundation Models: UNVERIFIED
- exact final master의 실물 Android: UNVERIFIED
- 두 실제 계정 Apple/Google OAuth와 couple transition: UNVERIFIED
- remote Supabase catalog/migration 상태: 이번 감사에서 UNVERIFIED
- Vercel/Cloudflare deployed SHA: UNVERIFIED
- TestFlight/App Store: NOT APPLIED

별도 Partner Briefing branch에서 Android APK compile과 실물 iPhone install/launch 이력이 있었지만, exact final master `e5cca5f`의 실물 검증으로 바꿔 쓰지 않는다.

## 다른 작업과의 분리 상태

### Couple Garden

- worktree: `/private/tmp/gomsinlog-couple-garden-v1`
- branch: `codex/couple-garden-v1`
- HEAD: `a2d09d22c85daf93dd4f3e6178e7307ca6bbd2a7`
- local master와 별도이며 master에 포함되지 않았다.

### Garden + beta shop integration

- worktree: `/private/tmp/gomsinlog-garden-beta-shop-integration`
- branch: `codex/garden-beta-shop-integration`
- HEAD: `e5cca5fbf0c8e74495526cbf9a16da5c4908cd85`
- Garden, beta shop, memory-product 후보를 포함한 다수 tracked/untracked 변경이 보존돼 있다.
- 이 dirty worktree를 master 복구와 섞지 않는다.

### Sentry

- worktree: `/private/tmp/gomsinlog-sentry-release`
- branch: `codex/sentry-privacy-minimal`
- HEAD/base: `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`
- default-OFF Sentry 후보는 dirty 상태로 별도 보존돼 있고 local master에 포함되지 않았다.
- 기존 독립 보안 gate가 닫히기 전 활성화·merge하지 않는다.

### Digital Memory Book PDF / Book Studio

- worktree: `/Users/han-yejun/Desktop/gomsinlog-memory-book-pdf`
- branch: `codex/digital-memory-book-pdf-v1`
- HEAD: `7c4401723cf1d6fe3e74194763c28810de1c35c1`
- `origin/master`가 조상이지만 문제 OCR commit `efd1c73`은 조상이 아니다.
- 따라서 이 push-hold 때문에 현재 Book Studio 시제품 작업을 폐기하거나 중단할 필요는 없다. 기존 dirty 변경을 그대로 보존한다.
- 운영용 iPad Book Studio는 완성·검증 후 별도 private repository로 분리하는 방향을 권장한다.

## 가장 작은 안전 복구 순서

1. `e5cca5f` 로컬 master는 push하지 않고 증거·rollback 기준으로 보존한다.
2. live `origin/master`에서 깨끗한 대체 통합 branch/worktree를 만든다.
3. Partner Briefing의 검토된 커밋만 다시 통합한다.
4. OCR 코드는 실제 캡처 파생 commit을 포함하지 않고 합성 fixture로 새 commit을 만든다.
5. profile refresh의 exact partner 재결속과 접근성 원본 버튼 구분을 수정하고 회귀 테스트를 추가한다.
6. focused/full tests, typecheck, lint, build, native checks를 fresh exact HEAD에서 실행한다.
7. Kiro Opus 5 Max 기능 검토와 Kiro Sol Max 개인정보·권한 검토를 새 exact HEAD에서 독립 수행한다.
8. PASS 이후에만 PR 또는 remote master 반영을 판단한다.
9. Garden, beta shop, Sentry, Book Studio는 각각 별도 gate로 유지한다.

## 명시적으로 하지 않은 것

- 기존 dirty 파일 수정·삭제·reset·stash·checkout·clean
- 문제 local master의 history rewrite, reset 또는 revert
- commit, push, merge, PR, deploy
- Supabase, Vercel, Cloudflare, Sentry, Apple, TestFlight, App Store 변경
- ChatGPT 공유 링크의 공유 해제
- OCR 원문 또는 사용자 캡처의 이 보고서 복제
- `docs/WORK_LOG.md` 수정 — 다른 활성 세션이 canonical ledger와 claim을 사용 중이므로 충돌 방지를 위해 이 비정규 Obsidian 보고서만 추가했다.

## STOPPED AT

- evidence captured: live remote, exact local master, branch ancestry, validations, independent Kiro review, shared-session identity, sibling worktree separation
- local master verdict: **PUSH HOLD**
- production: **NOT APPLIED**
- next owner: clean replacement integration owner, followed by independent Kiro Opus/Sol reviewers
