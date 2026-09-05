# [GOMSINLOG CONTROL TOWER]

## Current State

- Branch: `codex/sol-gomsinlog-rc-v4`
- Base HEAD: `75a367624422d2526dc5124fa050fb93862de807`
- Implementation HEAD: `717635bba3414d67f168b62b484c36bcc0526288`
- Scope: Realtime 채널 분리 뒤 couple lifecycle 회귀 테스트와 migration 072 PostgREST schema-cache 계약
- Remote/Production: NOT APPLIED / UNVERIFIED

## Findings

- lifecycle 실패는 실제 원격 membership 감지 결함이 아니었다. migration 072 호환 전환이 `daily_records` compatibility 채널을 먼저 만들었는데 테스트가 첫 mock channel을 authoritative channel로 가정했다.
- migration 실패는 실제 누락이었다. 072가 마지막 function-definition migration이 되었지만 이전 071 뒤의 reload만 남아 있어 새 함수 catalog를 명시적으로 새로고침하지 않았다.

## Decision

- 테스트는 채널 생성 순서가 아니라 실제 authoritative channel 이름 `couple-sync:couple-1`을 찾아 기존 `couple_members` callback과 최종 purge를 그대로 검증한다.
- 072의 transaction이 성공한 뒤 `NOTIFY pgrst, 'reload schema'`를 실행한다.
- RLS, trigger, function privilege, publication, membership authority, product UI는 변경하지 않는다.
- compatible-client adoption과 실제 Supabase 2-account WebSocket 검증 전 migration 072 Production 적용은 계속 HOLD한다.

## Changes

- `src/lib/coupleLifecycleTransitions.test.tsx`: brittle channel index 결속을 semantic channel-name 결속으로 교체했다.
- `supabase/migrations/072_close_private_capable_realtime_metadata.sql`: `COMMIT` 뒤 PostgREST schema-cache reload notification을 추가했다.

## Verification

- 구현 전 focused repro: 2 files / 2 deterministic failures
- Focused Vitest after fix: 3 files / 125 tests PASS
- Full Vitest: 296 files / 4,221 tests PASS
- Fresh PostgreSQL 17 migration chain: 68 applied migrations / 668 assertions PASS
- Full ESLint: PASS
- Full TypeScript: PASS
- Placeholder public-env production build: PASS, 2,536 modules
- `git diff --check`: PASS
- Independent Sol Architect: LOCAL PASS / exact-delta CRITICAL·HIGH·MEDIUM 0
- Independent Reviewer: LOCAL PASS / actionable CRITICAL·HIGH·MEDIUM·LOW 0

## Risks

- remote migration ledger, publication/function/RLS catalog, PostgREST listener, actual Realtime WebSocket는 아직 확인하지 않았다.
- compatible-client adoption 전에 072를 적용하면 구버전 client의 records/tasks realtime 갱신이 끊길 수 있다.
- local notification 구문과 fresh-chain 성공은 remote PostgREST가 실제 reload를 처리했다는 증거가 아니다.

## Current Score

- Product: 8.1/10 — 원격 관계 해제 사용자 상태 계약 유지
- UX: 8.0/10 — stale connected 상태를 막는 검증 복구
- Design: 7.8/10 — 시각 변경 없음
- Engineering: 8.8/10 — 4,221 unit/integration + 668 PostgreSQL assertions green
- Security: 8.7/10 — RLS-authoritative revocation과 private metadata 경계 유지
- Release readiness: 7.4/10 — local suite clean, remote rollout gate 남음

## Next Highest-ROI Goal

V5-E1 사진 lifecycle을 다음 local RC gate로 잡는다. 현재 단일 2048px 파일을 격자와 상세에서 함께 쓰는 경로를 `EXIF-free 화면용 master + thumbnail + 최소 lifecycle metadata + 멱등 cleanup`으로 바꾸되, 먼저 구버전 attachment round-trip·Storage RLS·orphan 오삭제 방지 계약을 Architect와 TDD로 고정한다. Book Studio print master·결제·remote migration은 이 gate에 포함하지 않는다.

## Debug Report

```text
Symptom:         full suite에서 membership callback 미발견과 schema-cache reload 순서 실패
Root cause:      compatibility channel 선행으로 깨진 mock index 가정 + migration 072 reload 누락
Fix:             authoritative channel 이름 탐색 + COMMIT 뒤 PostgREST NOTIFY
Evidence:        4,221/4,221 Vitest, 668/668 PostgreSQL, lint/typecheck/build PASS
Regression test: src/lib/coupleLifecycleTransitions.test.tsx:235, src/lib/migrationSecurityContracts.test.ts:234
Related:         migration 072 Production rollout은 compatible-client/actual-WebSocket gate 전 HOLD
Status:          DONE_WITH_CONCERNS
```
