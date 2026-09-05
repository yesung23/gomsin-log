# [GOMSINLOG CONTROL TOWER]

## Current State

- Branch: `codex/sol-gomsinlog-rc-v4`
- Base HEAD: `5b0a7b7073d87384ad2906c828ece66e70c60101`
- Reviewed implementation HEAD: `1636592f3504f5d260fcc71317c9bbeaf407299a`
- Scope: records/tasks Realtime privacy boundary, RLS-authoritative reconciliation, migration 072 local proof
- Remote/Production: NOT APPLIED / UNVERIFIED

## Findings

- `daily_records`와 `couple_tasks`의 direct Postgres Changes DELETE는 row filter만으로 비공개 행의 존재와 삭제 시점을 숨길 수 없다.
- source publication을 즉시 제거하면 구버전 client의 실시간 갱신이 끊기므로 client dual-read adoption이 migration보다 먼저 필요하다.
- 최초 구현은 parent couple cascade 중 DELETE trigger가 없는 parent의 invalidation을 다시 만들 수 있어 account deletion을 FK로 막을 수 있었다.
- record/task create가 refetch보다 늦게 응답하면 중복이 생길 수 있었고, 늦은 task mutation이 더 최신 snapshot을 덮을 수 있었다.
- mutation 성공 뒤 authoritative re-read도 transport-fail하는 경로에서 성공 상태와 draft를 안전하게 반영하는 규칙이 추가로 필요했다.

## Decision

- private-capable source table은 publication에서 제거하고 `(couple_id, slice, updated_at)`만 가진 content-free invalidation을 authority hint로 사용한다.
- payload 자체는 신뢰하지 않으며, client는 현재 RLS로 보이는 snapshot을 HTTP로 다시 읽는다.
- migration 전 direct source subscription은 별도 compatibility channel에 격리하며 authoritative invalidation/membership/recovery channel을 손상시키지 않는다.
- stale read와 mutation은 monotonically increasing sequence로 조정하고, forbidden은 cached row를 제거하며 transport failure는 명시적 retry 상태를 남긴다.
- Production은 compatible-client adoption과 staging actual-WebSocket gate 전 HOLD한다.

## Changes

- migration 072: records/tasks source publication 제거, shared-only invalidation trigger, direct function execution revoke, parent-cascade guard
- Store records: compatibility/invalidation 채널 분리, debounce·foreground·online·bounded polling, stale-read/mutation reconciliation
- Schedule tasks: 동일한 dual-read 전환, post-response authoritative re-read와 double-failure 안전 fallback
- TDD: private/shared actor matrix, sole-couple cleanup, refetch-first duplicate, delayed mutation, forbidden/transport failure 회귀 추가
- migration README: rollout 순서, 검증 범위, forward-only rollback 계약 기록

## Verification

- Focused Vitest: 3 files / 89 tests PASS
- PostgreSQL 17 fresh chain: 68 migrations applied / 668 assertions PASS
- Target ESLint: PASS
- Full TypeScript: PASS
- Staged diff check: PASS
- Placeholder production build: PASS, 2,536 modules
- Independent Sol final review: LOCAL PASS, actionable CRITICAL/HIGH/MEDIUM 0
- Supabase remote catalog/migration and actual WebSocket: UNVERIFIED

## Risks

- migration 072를 compatible-client adoption보다 먼저 적용하면 구버전 client는 records/tasks 실시간 갱신을 잃는다.
- local PostgreSQL trigger/RLS proof는 Supabase Realtime WebSocket 전달, reconnect, background 복귀를 증명하지 않는다.
- remote 068→072 migration ledger, publication catalog, function/RLS catalog, backup readiness가 확인되지 않았다.
- rollback은 source publication 복구가 아니다. 문제가 생기면 private metadata leak을 재개하지 않고 forward invalidation 또는 HTTP reconciliation으로 복구해야 한다.

## Current Score

- Product: 8.0/10 — 핵심 기록→상대의 오늘→원본 연결 의미 보존
- UX: 8.0/10 — 실시간 장애에도 cached state와 명시적 retry 제공
- Design: 8.0/10 — 시각 언어 변경 없이 상태 UX만 보강
- Engineering: 8.7/10 — race-safe dual-read와 실제 PostgreSQL actor/cascade proof
- Security: 8.7/10 — private DELETE metadata local closure; remote evidence 남음
- Release readiness: 7.3/10 — local gate PASS, adoption/remote/WebSocket gate HOLD

## Next Highest-ROI Goal

하루의 모든 partner-readable record를 순서대로 유지하고 각 항목이 exact original record로 이동하는 온디바이스 요약을 native simulator·semantic firewall·독립 Sol review까지 폐쇄한다. Feature는 physical supported iPhone 검증 전 default OFF로 유지한다.
