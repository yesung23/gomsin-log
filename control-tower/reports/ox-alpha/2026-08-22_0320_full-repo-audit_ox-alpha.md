---
agent: ox-alpha
agent_note: "[[Ox Alpha]]"
date: 2026-08-22
time: "03:20"
task: "전체 기술·제품 감사 (READ-ONLY)"
phase: LV
status: open
canonical: false
tags:
  - agent/ox-alpha
  - phase/lv
  - report
  - audit
---

> Non-canonical agent report. 권한 순서는 [[AI_ENTRYPOINT]].
> Agent: ox-alpha (opencode zen · `opencode/x-preview-f-free`) · READ-ONLY
> **저장소를 수정하지 않았다.** 감사 기준 tree: `920572c` (PR #80 병합 커밋)

# 전체 기술·제품 감사 — ox-alpha

## 이 문서를 읽는 법

ox-alpha가 스스로 낸 판정과, **[[Claude Opus]]가 그것을 독립적으로 재검증한 결과**를
함께 싣는다. 감사 보고는 그 자체로 사실이 아니다 — 검증란이 이 문서에서 가장 중요하다.

기준 tree(`920572c`)는 이 리포트가 쓰인 뒤 이미 움직였다. **현재 master는 `191df31`**
(#82 병합분 포함)이고 `#81`은 CLOSED, `#83`이 OPEN이다. ox-alpha의 체크포인트가
`ACTIVE: PR #81`이라고 적은 것은 그 시점의 스냅숏이며 지금은 틀리다 — 휘발 사실은
`bash scripts/agent/session-start.sh`로 다시 읽는다.

## A. 핵심 루프 판정

PRODUCT_V3 §4의 7개 화살표(가볍게 기록 · 상대방의 오늘 · 정확한 원본 이동 ·
이따 이야기하기 · 이야기거리 보관함 · 통화 모드 · 이야기했어요)가 **끊긴 곳 없이
코드로 존재한다**는 것이 이 감사의 가장 중요한 긍정적 발견이다. 남은 것은 물리적
전달(push 자격증명 · 실기기 2대)과 검증이다.

## C. 위험 목록 — ox-alpha 판정과 Opus 재검증

| # | 항목 | 위치 | Opus 재검증 |
|---|---|---|---|
| C1 | 저장소↔운영 스키마 드리프트 (운영 `~027`, master는 `038·048·049~055` 요구) | `migrations/README.md` 원장 | **UNVERIFIED** — 원격 조회는 훅이 user 전용으로 막는다. 원장 기준 간접 판정임은 ox-alpha 자신도 명시 |
| C2 | 032 단독 적용 시 `daily_records` 전면 쓰기 불능 | `032:71`·`032:84`, `039:41-76` | **CONFIRMED** — 032가 `e2ee_floor_for` EXECUTE를 회수하고 invoker로 호출한다. **039 헤더가 이 결함을 스스로 문서화**("0. P0 FIX: 032's trigger cannot read the floor it enforces"). 잔여 위험은 배포 순서뿐 |
| C3 | `send-push` 함수 내 인바운드 인증 부재 | `send-push/index.ts:45-57` | **CONFIRMED** — `method !== 'POST'`만 보고 admin 클라이언트를 만든다. 유일한 `Authorization`은 `:90`의 **FCM 아웃바운드**. 나머지 4개 함수는 2~10회 참조 |
| C4 | `briefings` 평문 요약 테이블 + GRANT 생존 | `001:164`, `012:22` | **CONFIRMED, 단 심각도 하향** — GRANT가 **SELECT뿐**이고 INSERT/UPDATE 권한도 src 쓰기 경로도 0건이다. 001 시절 코드가 넣은 행이 없으면 테이블은 비어 있다. **행 존재 여부는 UNVERIFIED**이고 심각도는 거기 달렸다 |
| C5 | `legacy_cycle_entries_backup` plaintext 건강 데이터 무기한 보존 | `022:114-140` → `023` → `027:208-212` | 미재검증 (원격 행 존재가 전제) |
| C6 | 테이블 단위 GRANT 부류 — 다음 `shared_at` 사건 예약 | `012:21` | 미재검증. 단 **같은 부류가 함수 쪽에서 실재함을 Opus가 발견**(아래) |
| C7 | quarantine 창의 거짓 공백 상태 (§4.2 위반) | `widgetComponents.tsx:105`, `TalkAboutListWidget.tsx`, `TodayLogWidget.tsx`; 원인 `store.tsx:1482` | **CONFIRMED** — `records: []`가 자기 기록까지 비운다. 세 표면은 `sharedSyncStatus`를 **각각 0회** 참조. 올바른 패턴은 `PartnerDayTimelineWidget`에 **8회** 존재 |
| C8 | 클라이언트 배선 게이트의 문자열 검사 | `pushNotifications.test.ts:197-214` 외 2개 | **CONFIRMED, 단 결과 과장** — 아래 별도 절 |
| C9 | `delete-account` 외 Edge Function 무테스트 | `supabase/functions/` | **CONFIRMED** — `test:edge`가 `delete-account/entrypoint_test.ts` 하나만 돌린다 |
| C10 | 오프라인 계층 3결함 (LCK 부재 시 평문 큐 · cold-launch flush 회귀 무방비 · 차단 기록 발견 불가) | `outbox.ts:176-189`, `store.tsx:2717-2731` | 미재검증 |
| — | **002 번호 중복이 LV fresh chain을 막는다** (ox-alpha가 자기 초안을 정정한 항목) | `002_fix_rls_recursion.sql:11` | **CONFIRMED** — `_recursion`은 `DROP POLICY IF EXISTS` 없이 정책을 재생성한다. `_and_rpc`는 `:32`에 DROP이 **있다**. `README:376-391`이 "신규 프로젝트에서 그대로 실행하면 002 단계에서 실패"라고 경고 |

## C8 — 실재하지만 결과가 과장됐다

**Opus가 mutation으로 직접 측정했다.** `store.tsx:1036`의 `void setUpPushNotifications();`를
줄 전체 주석 처리(구문 유효, 호출은 죽음):

| 무엇 | 결과 |
|---|---|
| `pushNotifications.test.ts` 전용 배선 테스트 | **19/19 통과** — 게이트가 소스를 문자열로 읽어 `toContain('setUpPushNotifications()')`을 보므로 주석 안의 글자도 센다 |
| `npm run typecheck` | **실패** — `TS6133: 'setUpPushNotifications' is declared but its value is never read` |

따라서 **"테스트는 green"은 전체 스위트 기준으로 거짓**이다. CI가 막는다.

그러나 그 방어는 **우연이다.** 호출부가 정확히 하나뿐이라 import가 미사용이 되어
걸린 것이고, 그 심볼을 참조하는 줄이 **어디든 하나만 더 생기면 그 진단도 사라진다.**
게이트 자체는 여전히 아무것도 지키지 않는다. 결함은 실재하고 고쳐야 하되, 심각도는
보고서가 적은 것보다 한 단계 낮다.

## ox-alpha가 놓친 것 — 같은 부류가 함수 쪽에 있었다

감사 대상 tree 안에, 바로 전날 Opus가 넣은 카탈로그 계약 검사에
`prosecdef`와 `proconfig`가 빠져 있었다. harness 전체에서 그 둘을 검사하는 곳은
`create_invitation`(030) **하나뿐**이었고, `mark_push_delivered`에서
`SET search_path = public, pg_temp`를 지워도 **282개가 전부 초록에 EXIT=0**이었다.

`SECURITY DEFINER` 함수의 search_path 미고정 — migration 030이 존재하는 그 경로다.
C6과 같은 종류이며 함수 쪽에서 일어났다. mutation 증명 후 수정: **PR #83**.

두 검토가 서로를 대체하지 않는다는 증거다. ox-alpha는 배선·실행·배포 규율에서 강했고,
같은 tree의 계약 검사 내부는 보지 않았다.

## D. ox-alpha의 권고 순서

D1 운영 카탈로그 read-only 조회 → D2 C7 세 표면 → D3 C8 게이트 3개 →
D4 send-push bearer 검증 + handler 테스트 → D5 §14.5 문장 대조 →
D6 cold-launch flush 회귀 + 못 보낸 기록 표시 → D7 Codex 독립 감사 →
D8 APNs/FCM + 실기기 2대 E2E → D9 `briefings` drop (승인 후)

**D1은 원격 조회 권한이 필요하고 `.claude/hooks/`가 user 전용으로 막는다.**

## 이 감사가 실행하지 않은 것

원격 Supabase 카탈로그 조회 · 독자 체인 재실행 · 실기기 · 실제 push 전달 · iOS 빌드 ·
mutation testing 직접 수행(push 게이트만 확인). ox-alpha 자신이 명시했다.

## STOPPED AT

- tree: `920572c` (감사 시점) · 현재 master `191df31`
- changed: **없음** (READ-ONLY)
- Production: NOT APPLIED · Supabase remote: UNVERIFIED · P6: NOT AUTHORIZED
- next: D1은 user 게이트. D2·D3는 Opus가 이어받을 수 있다

See [[Start Here]] · [[Current Gate]] · [[Context Packs]] · [[Do Not Build]]
