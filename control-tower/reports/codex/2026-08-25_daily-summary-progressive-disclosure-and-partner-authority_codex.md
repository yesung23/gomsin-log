---
type: report
agent: codex
tags:
  - report
  - codex
  - on-device-summary
  - release-gate
---

# 하루 요약 5개 초과 progressive disclosure와 상대 신원 권위 결속

**Branch** `codex/service-rank-profile-settings-impl` · **HEAD** `f7e8fbf5ebc4adcc575bb91edee147c5477fe1f0` (uncommitted working tree)

## 1. 무엇이 바뀌었나

연락이 5개를 넘는 하루에서 앞의 5개만 요약되고 나머지가 표지에서 사라지던 문제를
progressive disclosure로 바꿨다. AI는 여전히 무엇이 중요한지 고르지 않는다.

- 상대의 오늘 표지는 적격 기록 **전부**를 시간순으로 담는다. 화면은 처음 5줄만 보여 주고
  `N개 더 보기`로 나머지를 펼친다. 접을 수도 있다.
- 전체 줄 유지는 `showAllTodayCoverLines`가 켜진 **상대의 오늘**에서만 일어난다.
  `mine`·`archive`·`highlight`와 여러 날이 밀린 구간은 기존 최대 5줄을 그대로 유지한다.
- 다일 판정은 `readable`이 아니라 입력 `records` 전체로 한다. 과거 기록이 열리지 않는
  경우에도 그 스토리는 여전히 다일 구간이다.
- 온디바이스 refinement는 5개 고정 배치를 순차로 처리하고, **전체에 4초 예산 하나**만 쓴다.
  각 배치는 남은 시간만 받는다.
- 어느 배치든 실패·timeout·취소·검증 실패·`Intl.Segmenter` 부재면 **모든 줄**이 결정론적
  규칙 문장으로 남는다. 부분 적용이 없다.

## 2. 독립 검토가 잡은 것과 수정

| # | 검토자 | 지적 | 수정 |
|---|---|---|---|
| 1 | Reviewer | 과거 unreadable 기록이 섞인 다일 구간을 "오늘"로 오판 | 다일 판정을 전체 `records` 기준으로 변경 + 회귀 테스트 |
| 2 | Sol High (kiro/gpt-5.6-sol) | corpus가 "내가 아님"만 확인해 현재 파트너를 증명하지 못함 | active `couple_members`에서 읽은 `partnerUserId` 정확 일치 요구 |
| 3 | Sol High + Reviewer | 새 payload 처리 중 이전 AI 문장이 섞여 보일 수 있음 | refinement를 `payloadKey`와 함께 저장, 현재 키와 일치할 때만 노출 |
| 4 | Sol High + Reviewer | 커플 A→B 전환 시 A의 늦은 응답/캐시가 B에 남을 수 있음 | `bindPartnerMembership`이 요청 커플 ID·active 상태 재검증, lifecycle merge가 커플 변경/pending/disconnect에서 신원 삭제, effect를 coupleId로 키잉 + 취소 |
| 5 | Reviewer | 배치마다 새 4초라 8개면 최악 8초 | 훅 전체에 단일 deadline, 남은 시간만 전달 |
| 6 | Reviewer | mock backend가 membership `user_id`를 주지 않아 브라우저가 새 경로를 건너뜀 | fixture가 `neq.user_id` 질의에 실제 파트너 행 응답 |

새 DB 모델도, 서버 AI도, 새 migration도 만들지 않았다. 상대 신원은 migration 001부터
존재하는 `couple_members` SELECT 정책으로 이미 읽을 수 있는 행에서 온다.

### 커밋 대상 fresh 보안 판정

커밋 `2ea4acc`(부모 `f7e8fbf`)에 대해 `kiro/gpt-5.6-sol` high가 **PASS**를 냈다. 검토자는
작업 트리가 아니라 `git show 2ea4acc:<path>` 커밋 객체를 기준으로 9개 불변식을 확인했다.

payload 2필드 한정(Swift 경계 포함), active couple + 정확한 `partnerUserId` 일치,
`bindPartnerMembership`의 coupleId/active 재검증, lifecycle의 신원 삭제, store의 이중
identity 확인과 coupleId 키잉/취소, 단일 4초 deadline과 all-or-nothing, 배열 위치 기반
`recordId` 재결합, flag `'true'` 한정과 non-iOS 종료, 모델 경로에 네트워크·저장·analytics·
콘텐츠 로그 없음 — 전부 PASS.

검토자가 범위 구분으로 남긴 사실: 상대 신원 권위를 준비하는 store 경로에 Supabase
`couple_members` 메타데이터 조회 1회(`user_id`, `joined_at`만)와 기존 콘텐츠 없는
`couple_connected` analytics가 있다. 둘 다 요약 문장이나 기록 콘텐츠를 받거나 보내지
않는다. 이 판정은 정적 코드 경로에만 해당하고 실기기·원격·production은 UNVERIFIED다.

## 3. 개인정보 불변식

모델 payload는 `{ index, text }` 두 필드뿐이다. 다음은 들어가지 않는다.

- record ID · user ID · 날짜 · 시각 · 첨부 URL/파일명
- 비공개 기록 · 내 기록 · 제3자/전 파트너 기록 · 미저장 draft · 열 수 없는 기록
- 감정/주기/건강 구조화 필드

정확한 원본 매핑은 모델을 통과하지 않는다. 돌아온 index는 검증 후 **배열 위치**로 원래
`recordId`에 다시 붙는다. 서버 전송·저장·로그 기록은 이 경로에 없다. feature flag는 기본
OFF이고, iOS 네이티브가 아니면 `not_ios`로 끝난다.

## 4. 실행한 검증

| 결과 | 명령 | 증명하는 것 |
|---|---|---|
| PASS | focused Vitest 12 files / 280 tests | 경계·프라이버시·fallback·UX 계약 (mocked native) |
| PASS | `npm run typecheck` | 타입 |
| PASS | 대상 `npx eslint` (23 files) | lint |
| PASS | `git diff --check` | 공백 |
| PASS | `npm run build` — 2,161 modules | production 번들 |
| PASS | `npx cap sync ios` | 추적 iOS/Android/package diff 없음 |
| PASS | unsigned `xcodebuild` — `BUILD SUCCEEDED` | Swift 플러그인 컴파일·링크 |
| PASS | `npm run test:phase0` — 59 migrations / 344 assertions | 로컬 PostgreSQL 17 actor/RLS |
| PASS | Playwright `e2e/dailySummaryOverflow.spec.ts` (390×844, system Chrome) | 실제 렌더 5+3, 펼치기/접기, `?at=` 정확 이동, 44px |
| PASS | `src/lib/partnerDaySimulation.test.ts` 단독 12/12 (35.8s) | 정렬 최적화 후 장기 시뮬레이션 |
| FAIL | `LANG=en_US.UTF-8 npm run verify` | 전체 병렬 부하에서 timeout — 아래 참조 |

### 전체 verify FAIL의 성격

typecheck·전체 lint는 통과했다. 전체 Vitest에서 실패로 집계된 항목은 모두
`Test timed out in 5000ms` 형태이고 assertion 실패는 없었다.

- `src/lib/partnerDaySimulation.test.ts` — 전체 실행에서 timeout, **단독 실행 12/12 PASS**
- `src/components/widgets/composerEmotionPrivacy.test.tsx` 2건, `src/components/cycleV3DataPath.test.tsx` 3건,
  `src/crypto/keystore/deviceKeyPort.test.ts` 1건 — 이번 변경과 무관한 파일

동일 시각 정렬에 `localeCompare`를 tie-break로 쓰던 것이 수천 건 정렬에서 비쌌기 때문에
ISO 문자열/opaque ID의 사전식 비교로 바꿨고, 시뮬레이션 단독 실행은 84초 FAIL에서
35.8초 PASS로 회복했다. 그래도 전체 병렬 부하에서는 5초 제한을 넘긴다. **timeout 값을
올리거나 무관한 테스트를 손대지 않았다.**

## 5. 검증하지 않은 것

- 실물 iPhone Foundation Models 실행 (한국어 품질·오프라인·성능·실측 44px) — **UNVERIFIED**
- Remote Supabase 060/061 적용, PostgREST reload, 실제 actor matrix — **NOT APPLIED / UNVERIFIED**
- Supabase Apple provider, native redirect allowlist, Vercel 인증/env/배포 SHA — **UNVERIFIED**
- App Store 서명, Archive, TestFlight, 심사 메타데이터 — **미완료**
- 실제 인증 세션 기반 사용자 경로(회원가입/Apple 로그인/OAuth cold start/프로필 사진/로그아웃) — **UNVERIFIED**

## 6. Production

**NOT APPLIED.** 원격 Supabase·OAuth provider·Vercel·Apple 설정을 조회도 변경도 하지 않았다.
Google Play 관련 작업은 하지 않았다.

## 7. Rollback

커밋 전이면 해당 파일만 되돌리면 된다. 커밋 후에는 그 커밋 하나를 revert하면 표지가
기존 최대 5줄로 돌아간다. DB·migration·원격 상태 변경이 없으므로 rollback에 SQL이 필요 없다.
가장 빠른 무효화는 `VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED`를 끄는 것이지만, 이 flag는
이미 기본 OFF이고 progressive disclosure 자체는 flag와 무관하게 규칙 요약으로 동작한다.

## 8. 모델 배분

- 구현·통합·최종 diff 확인: Codex 주 에이전트
- 개인정보/보안 독립 검토: `kiro/gpt-5.6-sol` high — 실제 호출됨, P1 2건 HOLD 발행
- 제품/네이티브 설계 검토: `kiro/claude-opus-5` high — 실제 호출됨
- 테스트 커버리지 갭 점검: `google-antigravity/gemini-3.7-flash` high — 21개 경계 항목 갭 0건

구현자가 스스로 보안 최종 승인을 내리지 않았다.
