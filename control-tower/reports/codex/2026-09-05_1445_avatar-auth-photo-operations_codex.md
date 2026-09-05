---
agent: codex
date: 2026-09-05
status: in-progress
tags: [control-tower, profile, auth, media, release-gate]
---

# [GOMSINLOG CONTROL TOWER]

## Current State

격리 worktree `gomsinlog-rc-v5-final-fixes`에서 계속 작업한다. 정확한 commit별 증거는
`docs/WORK_LOG.md`의 2026-09-05 Avatar/Auth/Photo checkpoint에 있다. 전체 앱은 **RC HOLD**다.
원격 Supabase/Apple/배포/master는 이번 작업에서 변경하지 않았다.

## Findings

- 로컬에만 있던 My 사진은 상대에게 공유되지 않았다. 별도 작은 private avatar 저장 경로가 필요했다.
- 독립 avatar 리뷰에서 삭제 확인 전 변경, 복구 시 과거 사진 재노출, 조회 실패 후 옛 로컬 사진
  재등장 3개 MEDIUM을 발견했다. 모두 실패 재현 후 수정하고 독립 DELTA로 종결했다.
- Apple native의 늦은 응답은 저장 직전뿐 아니라 SDK 이벤트를 소비하는 경계에서도 차단해야 한다.
  저장 전 세 가지 경합은 해결했지만 저장 직후 로그아웃/늦은 SIGNED_IN의 HIGH 1건은 남아 있다.
- 이전 browser fixture는 OS dark preference를 지정해도 앱 상태에 light를 강제했다.
  현재는 앱의 실제 theme을 설정하고 DOM에서 확인한다.
- 압축 후 사진 크기는 내용에 따라 다르다. 합성 12MP 두 장도 750KiB와 1607KiB로 달랐다.
- Book Studio 현재 계약에는 variant/치수/revision/목적별 동의/실제 crop PPI가 없다.
  파일 존재만으로 인쇄 품질/원본 선택 연동이 구현됐다고 주장할 수 없다.

## Decision

- 기존 기기 로컬 사진을 자동 전송하지 않는다. 새로 고른 사진만 명시적인 프로필 공유로 저장한다.
- 일반 사진은 2048/.84를 유지한다. 2560 비교 결과는 저장량이 늘었으며 인쇄 품질 증거는 없다.
- 무료 기록/정상 사진/보안은 유지한다. 유료 가치는 장식·편집·책 제작이며 판매는 검증 전 OFF다.
- 전체 원본 7/30일 보관 대신 사용자가 책에 선택한 정확한 사진과 최종 배치를 확인한다.
  부족한 것만 재선택하는 계약을 Book Studio 담당과 나눠 구현한다.
- 비용 예시 500/50KiB를 실측 평균으로 쓰지 않는다. 썸네일은 기존 record 권한/삭제 계약 검토 후 추가한다.

## Changes

- Home/Diary 날짜에서 원본 기록으로 이동, 필기 글자 광학 크기/Diary 200% 설정.
- private avatar SQL/RPC, My 선택/교체/삭제, 양쪽 Home story ring, 실패/세션전환 방어.
- Apple native 준비와 SDK 저장 전 인증 시도 취소. 남은 이벤트 HIGH는 별도 소유 worker가 수정 중.
- 일반 사진 decode/encode timeout과 JPEG 검증. 비용/손익분기 계산기와 실제 canvas benchmark.
- browser 실제 light/dark 검증. 현재 상태 문서의 과거 checkpoint는 historical로 분리.

## Verification

| 명령/검증 | 결과 | 증명 범위 |
|---|---|---|
| 원본 이동 focused | 56 PASS | 정확한 링크, 기존 core 계약 |
| 글꼴/Diary focused | 34 + 46 PASS | 크기 정책, Diary 동작 |
| avatar migration local PostgreSQL harness | 75 assertions PASS, 실제 87 migrations | 로컬 RLS/actor/CAS/삭제 경합; hosted 아님 |
| avatar+auth+gate focused | 274 PASS | 실제 app 모듈 + mock network/native |
| avatar 독립 DELTA | 10 scenarios/36 assertions PASS | 변경 전 MEDIUM 재현, 변경 후 3건 해결 |
| auth worker focused | 500 PASS, 2 Android-dependent SKIP | SDK/PKCE/onboarding 등; 실제 Apple 아님 |
| auth 독립 review | 78 PASS + 새 경합 3 FAIL | 새 HIGH 1건 발견, 완료로 표시하지 않음 |
| image sanitizer + media failures | 50 PASS | timeout/비JPEG 실패 및 기존 업로드 실패 |
| node --test scripts/operations/media-economics.test.mjs | 7 PASS | 단위/포함량/초과/순수익 계산; 실제 청구 아님 |
| Node22 photo-benchmark.mjs | 4 synthetic fixtures PASS | 실제 Chromium sanitizer/EXIF/회전/크기/투명 PNG 흰색 합성; 품질/실기기 아님 |
| Node22 Playwright source-entry config | 8 PASS, exit 0, 22.6s | 실제 theme/375·402·430px/2계정 photo/200%; backend mocks |
| scoped ESLint + typecheck + git diff --check | PASS | 변경 소스 정적 검사 |
| placeholder env npm run build | PASS, 2581 modules | 로컬 artifact 생성, 505KB chunk 경고 |

초기 Node26 browser 작업은 테스트 본문 완료 후 종료가 지연됐다. 해당 작업 프로세스만
종료하고 명령 범위의 Node22 및 공식 Playwright browser를 사용해 동일 suite 종료 0을 확인했다.
사용자 브라우저/Book Studio 서버/전역 Node 설정은 바꾸지 않았다.
이전 dark 테스트는 실제 앱 dark 증거에서 제외한다. 새 8 tests만 theme 확인 근거다.

## Risks

- Apple 이벤트 HIGH 종결과 fresh independent review 필요. provider/signing/silent merge/revoke HOLD.
- 086–088 누적 보안 리뷰, 089 hosted 적용, 전체 최신 suite, 실기기/접근성/성능 아직 필요.
- 온디바이스 부정문 의미 축약 경계와 실제 저사양 성능 검증 미완료; flag OFF 유지.
- thumbnail/미디어 metadata/책 crop PPI·원본 재선택/원격 운영 계측 미구현.
- 신뢰된 앱 밖에서 공급된 JPEG에 대해 서버 구조 검사가 완전한 이미지 디코더라는 보장은 없다.
- no Production change; 로컬 코드만으로 실제 서버 수용 인원·순이익·환불 거절을 보장하지 않는다.

Rollback: 미배포 로컬 커밋별 revert. migration 089 원격 적용 전에는 실제 백업/actor/호환 gate가 필요하며,
배포 후 사용자 사진을 삭제하는 DROP을 rollback으로 사용하지 않는다. 기존 기록/사진을 덮어쓰지 않는다.

## Current Score

이번 부분 gate에서 전 제품 점수는 재평가하지 않았다. 관측 없는 점수 상승 대신 **RC HOLD**로 유지한다.
Avatar 범위는 local/independent PASS, Auth는 HIGH OPEN, media 운영은 부분 구현이다.

## Next Highest-ROI Goal

후속 확인: 기존 미디어 재조회 hook에서도 이전 source 응답이 새 사진/상위 권한 거절/새 URL을
덮는 3개 실패를 재현했다. source generation과 commit 전 표시 경계를 추가해 수정했다.
hook/Gallery/playback **38 PASS**, 대상 lint/typecheck PASS. 원격 권한·crypto는 변경하지 않았고,
아직 별도 narrow DELTA review 전이다. StrictMode wrapper 호환 테스트는 변경 전부터 PASS였으며
이를 별도의 재현된 결함으로 과장하지 않는다.

Apple 이벤트 HIGH를 닫는 동안 thumbnail·사진 metadata·책 source 계약을 Architect가 검토한다.
그 다음 실제 사용자 upload/read/delete 경로에 붙이고 negative tests로 검증한다.

### 후속 배정 checkpoint

- Apple 이벤트 fix는 `d08519f`로 로컬 commit했다. 실제 SDK/Store RED4 FAIL 후 worker475 PASS,
  parent47 focused PASS, typecheck/lint PASS. fresh 독립 리뷰 전이므로 HIGH 종결 승계는 하지 않는다.
- photo Architect의 2048 master+640 thumbnail, 동일 private lifecycle·별도 metadata 결속,
  구버전 편집 보존안을 승인했다. 구현자는 신규090 migration/전용 harness만 소유한다.
- [6개 종결 계획](../../../docs/operations/rc-closure-plan-2026-09-05.md)을 저장했다.
  최신 사용자 요청에 따라 all-Astra 대신 역할별 Flash High/Sol High/Sol Max, 필요 시 Astra Max로 배정한다.
  현재 진행 중인 Astra 구현/리뷰는 중단하지 않는다. 미래 작업을 이미 배정·완료한 것으로 쓰지 않는다.
- 병렬/하위에이전트 개발 스킬은 한 쓰기 소유자+독립 검토, task brief, 중복 실행 방지 원장에 사용했다.
  자동 merge/push/삭제나 보안 finding 허용 같은 범용 절차는 프로젝트의 엄격한 gate로 제한했다.
