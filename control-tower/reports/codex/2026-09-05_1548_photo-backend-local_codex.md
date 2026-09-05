---
agent: codex
date: 2026-09-05
status: local-independent-pass-client-pending
tags: [control-tower, media, migration, local-only]
---

# [GOMSINLOG CONTROL TOWER]

## Current State

`codex/rc-v5-final-fixes` / code checkpoint **fb880ed85a20dde96a3774300be8503eaac1bb04**.
사진 두 크기 저장을 위한 backend가 로컬 구현·검증됐다. 앱의 실제 생성/목록 표시는 아직 미연결이며
독립 Sol Max 보안 검토는 아래 후속 확인대로 PASS이며 Production 적용은 하지 않았다. 전체 RC는 HOLD다.

## Findings

- 앱에서 보여 줄 2048px 사진과 작은 목록용640px 사진은 같은 기록·소유자·커플·operation에 결속돼야 한다.
  하나만 올라간 상태, 응답 유실, 구버전 편집, 삭제 경합에서 이를 보존하는 것이 이번 범위다.
- parent 인수 후 기존 security contract 검사에서 schema reload 누락1건을 실제 발견했다.
  함수가 DB에 있어도 API cache가 알지 못할 수 있으므로 NOTIFY를 추가해 검사 실패를 닫았다.
- 기록당 active 첨부32개와 물리 파일64개, 평생 쌓인 mutation/등록 이력 수는 서로 다른 값이다.
  비용과 보존을 설명할 때 이를 같은 상한처럼 쓰지 않는다.

## Decision

Backend와 client를 분리해서 검증한다. original/Astra worker의 작업을 보존한 채 쓰기를 중단시키고,
parent가 실제 검증과 누락 보완을 인수했다. 이제 Sol High는 요약 수정, Sol Max는 누적 media/090
독립 검토를 맡는다. 수정 파일이 겹치지 않으며 최대2명 원칙을 유지한다.

처음 제안한 abandoned metadata 즉시 삭제 대신, 등록 descriptor는 해당 record/account 삭제까지
private하게 유지하는 구현을 수용했다. 이유는 물리 파일 삭제 후에도 같은 operation에 다른 bytes/hash를
보낸 재시도를 구별하기 위해서다. 이 행은 청소 권한이 아니며 retired 행은 읽기 RPC에서 제외한다.
별도 fingerprint 저장소를 추가하는 대안은 이번 범위에서 채택하지 않았다. 이력 누적과 실제 운영
보존 정책은 독립·운영 검토 대상이며, 이 결정이 Production 개인정보 정책 변경 승인은 아니다.

## Changes

| 파일 | 실제 변경 |
|---|---|
| `supabase/migrations/090_record_photo_renditions.sql` | pair 등록/예약·읽기, 기존 begin 호환 wrapper, publication 완전성, logical32/physical64, RLS/권한/삭제/현재 커플 검사 |
| `scripts/phase0/record-photo-renditions-harness.mjs` | 전체001..090 실제 PG, actor/응답유실/CAS/삭제 경합, 구버전 regression mode, private/companion mutation controls |
| `supabase/migrations/README.md`, CURRENT_STATE, WORK_LOG | 로컬 사실·번호·remote 미적용·다음 gate 기록 |

기존084–088 SQL, 기존 shared harness, Edge worker, 앱 attachment `{type,name,path}`, crypto,
원본사진/고객데이터, 판매·AI flag, Book repo, Now.md는 이 변경의 소유 범위에 포함하지 않았다.

## Verification

| 실제 parent 명령 | 결과 | 증명 범위 |
|---|---|---|
| `node scripts/phase0/record-photo-renditions-harness.mjs` | **187 assertions PASS**, 88 migration files /001..090 | 실제 SQL/RLS/constraints/동시 PG 연결, 부분 업로드·32pair·구버전·record/account cascade·partner 보존 |
| 같은 명령 `--regression-084` | **520 assertions PASS** | 기존518개 + fixture/install2개, 090을 적용한 기존 cleanup 경계. 전체 fresh chain과 별도 |
| `npx vitest run src/lib/migrationSecurityContracts.test.ts --reporter=dot` | 최초 **1FAIL/208PASS** → NOTIFY 추가 후 **209PASS** | repository 보안 형태/schema reload 선언. hosted 실행 아님 |
| `node --check scripts/phase0/record-photo-renditions-harness.mjs`, `git diff --check` | **PASS** | 문법·diff |
| Node 원문 함수 비교 | **PASS** | 084 예약 구현은 private 함수명과32→64 physical bound 외 byte-for-byte 동일 |

Mutation controls는 이 테스트가 실제 잘못된 규칙을 감지하는지 확인한다. 격리 PG transaction 안에서
private read 제한을 제거하면 partner에게 합성 private 행1개가 나타나고, companion 자동 보존을 제거하면
구버전의 physical count가2→1이 된다. 각각 원래 기대를 실패시키며 ROLLBACK 뒤 보호가 돌아온다.
첫 mutation probe의 CREATE FUNCTION 끝 세미콜론 누락은 harness 문법 오류로 수정했으며, product RED로 세지 않았다.

치수·bytes·SHA는 **클라이언트 보고값**이다. 파일의 실제 픽셀/인쇄 품질을 서버가 검증했다는 뜻이 아니다.
Storage의 실제 HTTP byte transport, PostgREST, 실제 Auth/provider, Realtime/스케줄러는 이 PG fixture의 증거가 아니다.
TypeScript/build/실제 browser는 앱 source를 바꾸지 않은 이번 SQL slice 때문에 의례적으로 재실행하지 않았다.
새 전용 PG 명령의 CI 연결과 whole-app exact-HEAD 검사는 다음 통합 gate에 남긴다.

## Risks / Current Score

Product/UX/Design: 이 좁은 backend gate에서 전제품 점수를 새로 만들지 않음.
Engineering: 해당 로컬 검사 PASS. Security: independent cleanup+090 review **PASS, C/H/M/L 0**.
Release readiness: **HOLD**. 온디바이스 HIGH2 수정도 별도 진행 중이다.

Remote/Production **NOT APPLIED**. 실제 catalog/고객2계정/기기/청구는 UNVERIFIED.
등록 metadata 이력은 record가 남는 동안 누적될 수 있으므로 active32를 DB 보관량 보장으로 사용하지 않는다.
새 metadata 읽기는 암호화된 기록을 제외하며 기존 master로 계속 표시한다. 해독 성공을 client boolean으로
서버에 주장하거나 암호를 낮추지 않는다.

## Next Highest-ROI Goal

요약 HIGH 수정과 media 독립 검토를 병렬 종결한다. 다음 photo client slice는 단일 decode, 정확한
업로드 바이트 hash, begin 이전 capability 판정, 부분 실패 복구, 작은 grid/확대 master 분리로 한정한다.
기존 서버에서 missing RPC인 경우에만 업로드 시작 전에 legacy 경로를 택하며 ambiguous begin 후 전환하지 않는다.

## Rollback

미배포 코드이므로 개별 local commit revert 가능하다. 실제 pair가 저장된 뒤에는 wrapper·binding·physical64
계약을 제거하거나 낮추지 않는다. optional client 경로를 끄고 데이터를 보존한 forward fix가 필요하다.
이번 작업은 master merge·배포·Supabase·Apple 변경을 수행하지 않았다.

## 후속 독립 검토 — exact fb880ed

Russell / Sol Max는 구현에 참여하지 않고 cleanup086–088 +090 +계정 삭제 연결을 읽기 전용 검토했다.
reviewed `fb880ed85a20dde96a3774300be8503eaac1bb04`; 문서 HEAD `0d20a9c`에서 대상 blob은 동일하다.
parent도 해당 source 동일성을 확인했다. 결과 **C0/H0/M0/L0, PASS**.

- 기존 cleanup PG518, 083–088 Vitest62, 새090 PG187, 090+구버전 PG520, security contracts209 PASS.
- Edge 최초 loopback 제한 실행은 25PASS/8 NotCapable FAIL; 선언된 `--allow-net` 재실행33PASS.
  실제 HTTP 대상은 localhost였으며 hosted 기능 실행이 아니다.
- active couple/private/cipher0/deletion/anon/former partner, pair publication·삭제/재시도와
  account deletion의 DB barrier 이후 Auth 삭제, 상대 소유 파일 보존을 확인했다.
- 등록 metadata 이력 보존은 private history이며 읽기 권한이나 cleanup authority가 아님을 확인했다.
- summary WIP, 실제 client renditions, Storage 전송/서명 URL/hosted/실기기는 검토 범위가 아니다.

이는 새 app 통합의 독립 리뷰를 대체하지 않는다. 해당 client diff에 대한 fresh DELTA가 필요하다.
