---
agent: codex
agent_note: "[[Codex]]"
date: 2026-08-30
time: "21:24"
task: "Sentry privacy-minimal and session ledger"
phase: P10
status: blocked
canonical: false
tags:
  - agent/codex
  - phase/p10
  - report
  - observability
---

> Non-canonical agent report. Authority order in [[AI_ENTRYPOINT]].
> Agent: [[Codex]] · Base: `origin/master` `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`

# Sentry 개인정보 최소화 준비와 2026-08-30 작업 장부

> [!important] Vault 위치 정정
> 최초 작성본이 실제 Obsidian vault가 아닌 `/private/tmp/gomsinlog-sentry-release`에만 생성되어 Obsidian에서 보이지 않았다. 사용자 확인 후 실제 vault `/Users/han-yejun/Desktop/곰신로그/control-tower/reports/codex/`에 이 보고서를 추가했다. 이 정정은 보고서 배치만 바로잡으며 Sentry/OCR/Garden production code, Supabase, Vercel, Apple 또는 Production 상태를 변경하지 않는다.

## 한눈에 보는 판정

- Sentry 코드 후보: **LOCAL PASS / DEFAULT OFF / PRODUCTION NOT APPLIED**
- Sentry 운영 활성화: **BLOCKED** — 개인정보 고지·Sentry 서버 설정·정확한 CSP·실제 canary 검증이 남았다.
- 우리 정원: **FUNCTIONAL PASS / SECURITY ARCHITECTURE BLOCKED / NOT MERGED**
- 네이버지도 캡처 OCR: **실제 첨부 3장 ACCEPTANCE FAIL** — 영업 정보는 3/3 읽었지만 현재 후처리 결과는 가게명 0/3, 주소·지역 0/3, 업종 1/3이었다.
- 첨부 화면: 원본은 vault에 복사하지 않고 관찰 사실만 아래에 기록했다.
- Git: 이 보고서를 쓴 시점에는 commit, push, PR, merge, deploy를 하지 않았다.

## 무엇을 요청받았나

1. 오류를 안전하게 파악할 수 있도록 Sentry를 검토·준비한다.
2. 다른 dirty 작업을 덮지 않고, 안전한 변경만 master로 보낼 수 있게 격리한다.
3. 이번 세션에서 수정·검토·보류한 사실을 Obsidian Control Tower에 남긴다.
4. 사용자가 첨부한 Story, 네이버 지도, 캐릭터 시트의 의미를 후속 작업에 잃지 않게 보존한다.

## 저장소와 작업 격리

- 전용 worktree: `/private/tmp/gomsinlog-sentry-release`
- branch: `codex/sentry-privacy-minimal`
- base/working HEAD: `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`
- 기준 `origin/master`: `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`
- 메인 checkout `/Users/han-yejun/Desktop/곰신로그`의 기존 dirty 변경은 수정·삭제·stash·reset하지 않았다.
- 정원 worktree `/private/tmp/gomsinlog-couple-garden-v1`도 별도 보존했다.

## Sentry에서 실제로 바꾼 것

### 코드

- `package.json`, `package-lock.json`
  - `@sentry/react`를 open range가 아닌 정확한 `10.72.0`으로 고정했다.
- `.env.example`
  - `VITE_SENTRY_DSN`과 `VITE_SENTRY_ENABLED=false`를 문서화했다. 기본은 비활성이다.
- `src/lib/sentry.ts`
  - production web, non-native, DSN 존재, enabled가 정확히 `true`인 네 조건이 모두 맞을 때만 초기화한다.
  - SDK는 dynamic import한다. 기본 OFF 앱 시작 번들에는 Sentry runtime이 들어가지 않는다.
  - `defaultIntegrations:false`, `integrations:[]`, `sendDefaultPii:false`, client report·breadcrumb·trace 비활성화를 명시했다.
  - 원문 오류명·메시지·URL·query·user·request·tag·extra·context·breadcrumb·함수명·소스문맥을 버리고, 고정 오류명/문구와 정적 JS basename·line·column만 허용한다.
  - 초기화 전 오류는 평문 queue에 보관하지 않고 버린다. SDK import/init/capture 실패도 사용자 흐름으로 throw하지 않는다.
- `src/main.tsx`
  - 앱 부팅을 기다리게 하지 않는 비동기 초기화 호출을 연결했다.
- `src/components/ErrorBoundary.tsx`
  - 기존 원문 Error와 React component stack의 console 출력을 제거했다.
  - 고정 문구만 console에 남기고, 초기화된 경우에만 정제 경로로 오류를 전달한다.
- `src/lib/sentry.test.ts`
  - 실제 `@sentry/react` memory transport envelope에 민감 canary가 하나도 남지 않는지 검증한다.
  - default OFF/native/dev/no-DSN 경계, strict filename allowlist, idempotence, SDK throw 격리, ErrorBoundary fallback을 고정한다.
  - console에는 고정 문구만 있고 원문 render error가 없음을 단언한다.

### 성능 보완

첫 구현은 정적 import 때문에 eager entry가 약 527.09 kB로 늘었다. 그대로 두지 않고 SDK를 lazy chunk로 분리했다. 최종 CI-placeholder production build 기준:

- eager entry: `438,510` bytes, `sentry` 문자열 0회
- Sentry lazy chunk: `493,310` bytes, 활성화 시에만 요청
- source map 파일: 0개
- Sentry upload plugin/token: 추가하지 않음

이는 기본 OFF 사용자의 첫 화면에서 Sentry runtime 다운로드·파싱 비용을 제거한다. 활성화한 web에서는 오류 수집을 위해 별도 chunk 비용이 발생한다.

## 검증 증거

최종 코드가 고정된 뒤 primary가 직접 다시 실행했다.

| 검증 | 결과 | 실제로 증명하는 것 |
|---|---|---|
| `npx vitest run src/lib/sentry.test.ts` | PASS, 16/16 | 환경 gate, 실제 envelope 정제, ErrorBoundary 연결 |
| `npm run test -- --reporter=dot` | PASS, 265 files / 3,777 tests | 저장소 전체 JS/TS 회귀 |
| `npm run typecheck` | PASS | TypeScript 계약 |
| `npm run lint` | PASS, 0 warnings | 저장소 전체 lint |
| CI 공개 placeholder로 `npm run build` | PASS, 2,519 modules | 비밀값 없이 production bundle 생성 |
| bundle 정적 검사 | PASS | eager Sentry 0, lazy 분리, source map 0 |
| `git diff --check` | PASS | whitespace/diff 무결성 |

환경변수 없이 실행한 첫 `npm run build`는 `VITE_SUPABASE_URL is missing or empty`로 실패했다. 이는 저장소의 의도된 release guard이며, 그 결과를 앱 빌드 회귀로 오인하지 않았다. 이후 CI와 같은 비밀이 아닌 placeholder로 실제 bundle 생성을 확인했다.

## 독립 보안 검토에서 먼저 나온 문제와 조치

첫 Sol Max 검토는 다음을 P1로 막았다.

1. SDK 버전 open range → exact `10.72.0` pin으로 수정
2. 기본 integration fail-open → `defaultIntegrations:false`, 빈 allowlist로 수정
3. stack path/module 누출 → 정적 JS basename과 숫자 위치만 남김
4. mock-only 테스트 → 실제 SDK memory transport/envelope canary로 교체
5. 원문 React component stack → 전송하지 않음
6. default OFF에서도 eager bundle 비용 → dynamic import로 분리

구현자가 최종 보안 승인을 내리지 않는다. 최종 exact diff에 대한 fresh Kiro Sol Max 독립 검토가 merge 전 gate다.

## 원격 Sentry/Vercel 상태

다음은 사용자가 공유한 설정 기록을 읽어 확인한 값이며, 비밀값은 이 문서에 쓰지 않는다.

- Sentry project: `gomsinlog-web`, React
- error tracking만 선택
- Replay, logs, tracing, metrics, GitHub integration은 OFF
- `VITE_SENTRY_DSN`은 Vercel Production 환경변수에 저장됨
- `VITE_SENTRY_ENABLED=true`는 확인되지 않았고 저장하지 않음
- Production redeploy는 하지 않음
- 현재 CSP는 Sentry ingest를 허용하지 않음

따라서 현재 판단은 **DSN 보관 완료 / 코드 미배포 / telemetry 미활성 / event 수신 UNVERIFIED**다. DSN이 저장돼 있다는 사실만으로 수집이 시작되지 않는다.

## Sentry를 실제 켜기 전 필수 gate

1. Sentry를 개인정보 처리 수탁자/국외 처리 대상으로 실제 개인정보처리방침에 명시한다.
2. Sentry dashboard에서 IP 저장 방지, 서버측 scrubbing, 실제 보존기간을 확인하고 증거를 남긴다.
3. DSN에서 얻은 정확한 ingest origin 하나만 `public/_headers`와 `vercel.json`의 `connect-src`에 추가하고 CSP 회귀 테스트를 갱신한다. wildcard는 사용하지 않는다.
4. Production web에서 합성 오류 1건을 보내 실제 저장 event에 message, content, context, user, request, query, fragment가 없는지 확인한다.
5. 그때만 `VITE_SENTRY_ENABLED=true`를 action-time 승인 후 설정하고 배포한다.
6. 문제가 있으면 enabled flag를 false로 되돌리고 직전 deployment로 rollback한다. DSN 제거만을 유일한 rollback으로 삼지 않는다.

## 우리 정원 변경 — 왜 master에 섞지 않았나

별도 branch `codex/couple-garden-v1`, HEAD `7156cdcffc9fd431db71fd7dc45abac95ac12643`에는 `/diary/garden` V1이 있다. 함께한 날짜만 읽어 4단계 정원을 보여주며 DB/AI/결제/analytics write는 없다. 기능·접근성·browser·Xcode simulator 검증은 통과했다.

그러나 Kiro Sol Max 보안 검토에서 P1 architecture blocker가 유지됐다. 계정 삭제 뒤 survivor가 기존 couple UUID에서 새 파트너를 초대할 수 있는 경로가 있고, outbox·Storage·record RLS·local E2EE authority가 `coupleId`를 관계 경계로 사용한다. 관계 세대 구분 없이 같은 UUID를 재사용하면 과거 관계와 새 관계의 데이터 경계가 섞일 수 있다.

그래서 정원 branch는 commit/push/merge/deploy하지 않았다. 최소 안전 방향은 한 couple UUID를 최초 두 사람에게 봉인하고, 새 관계에는 새 couple UUID를 만드는 서버 불변식이다. 이것은 DB/RPC migration gate이므로 별도 승인 전 구현하지 않는다.

2026-08-30 Production aggregate-only read 결과도 개인 ID/콘텐츠 없이 기록한다. couples 6, two-active 1, one-active+total-one 2, zero-active 1, one-active+disconnected-history 0, one-active+live-invitation 0이었다. 관찰 시점에 위험한 진행 row는 없었지만 서버 차단 불변식도 없으므로 blocker는 닫히지 않는다. Production mutation은 하지 않았다.

## 사용자가 첨부한 화면에서 보존한 관찰

### Story/Home 사진 화면

첨부된 실기기 화면에는 다음이 보였다.

- 상단에 작성자 `예성`이 있는데 캡션도 `예성`으로 다시 시작함
- 책갈피가 캡션보다 위에 있음
- 시간이 `오늘 01:23:00`으로 초까지 표시됨

목표 배치는 `사진 → 작성자 이름을 반복하지 않는 글 → 하단 왼쪽 오늘 HH:mm → 하단 오른쪽 더보기·책갈피`다. 현재 `origin/master`의 `PaperHome` 코드와 회귀 테스트는 이미 이 목표 순서를 사용하므로, 첨부 화면은 최신 source 결함의 증거가 아니라 **실기기에 이전 bundle이 남아 있을 가능성을 보여주는 관찰**이다. 최신 build를 실제 iPhone에 설치한 뒤 같은 record로 재확인하기 전까지 실물 결과는 UNVERIFIED다. StoryViewer의 별도 원본 보기/하이라이트 액션은 이 관찰만으로 임의 재설계하지 않는다.

### 네이버지도 캡처 OCR 실제 회귀 입력

세 화면은 단순한 장소 후보가 아니다. 사용자가 요구한 실제 기능은 다음과 같다.

`네이버지도 캡처 선택 → 기기 내 OCR → 가게명·업종·영업 상태/시간·주소 또는 지역 자동 추출 → 사용자가 확인·수정 → 일정 저장`

현재 source에는 `TripDetailPage → recognizePlaceScreenshot → extractPlaceFromOcr` 경로가 실제로 연결돼 있다. `tesseract.js 7.0.0`과 저장소의 `public/ocr/kor.traineddata.gz`를 사용하며 원본 캡처는 서버에 업로드하지 않는다. 다만 저장소 회귀 테스트는 지금까지 합성 OCR 문자열만 검사했고, 첨부한 실제 세 화면은 테스트하지 않았다.

2026-08-30에 원본을 vault·Git·서버로 복사하지 않은 채, 앱과 같은 Tesseract 버전과 같은 한국어 학습 데이터로 세 파일을 직접 읽고 현재 `extractPlaceFromOcr` 후처리를 적용했다.

| 실제 입력 | 화면에서 읽어야 할 핵심값 | 현재 후처리 결과 | 판정 |
|---|---|---|---|
| 도토리가든 안국점 | `도토리가든 안국점`, `카페·디저트`, `영업 종료 · 08:00에 영업 시작`, `서울 종로구` | OCR 원문에는 가게명·업종·영업 문구가 있었지만 title/address는 지도 잡음 선택. 업종 `food`와 영업 문구는 정확 | FAIL |
| 신라제면 안국점 | `신라제면 안국점`, `국수`, `영업 종료 · 10:30에 영업 시작`, `서울 종로구` | OCR 원문에는 가게명·업종·영업 문구가 있었지만 title은 지도 잡음, 가게명 줄을 address로 오인. 지도 배경의 `게스트하우스` 때문에 업종을 `lodging`으로 오인했고 영업 문구만 정확 | FAIL |
| BBQ치킨 신길대방점 | `BBQ치킨 신길대방점`, `치킨·닭강정`, `영업 중 · 다음 날 02:30에 라스트오더`, `서울 영등포구` | OCR 원문의 영문 `BBQ`가 `880/8680`으로 오인됐고 title/address는 지도 잡음 선택. `치킨·닭강정`을 현재 분류 규칙이 `activity`로 오인했고 영업 문구만 정확 | FAIL |

집계는 **가게명 0/3, 사용 가능한 주소·지역 0/3, 업종 1/3, 영업 상태/시간 3/3**이다. OCR 엔진 실행 자체는 성공했지만 실제 사용자 acceptance는 실패했다. 특히 현재 빠른 추가 경로는 title이 비어 있지 않으면 즉시 DB에 저장하므로, 지도 잡음을 가게명으로 잘못 자동 저장할 수 있다. 이는 `docs/FEATURE_SPEC.md`와 `docs/FREE_PLANNING_ARCHITECTURE.md`의 “후보를 입력란에 채우고 사용자가 확인·수정한 뒤 저장” 계약과도 다르다.

따라서 세 화면은 이후 OCR 보정의 고정 회귀 입력이다. 최소 안전 수정은 OCR이 읽은 값을 편집 화면에 자동으로 채우되 **저장은 사용자 확인 뒤 한 번만** 수행하는 것이다. 이후 실제 세 화면에서 가게명·영업 정보·지역을 다시 확인하고, 흐릿함·다크모드·영문 상호·영업시간 없음 실패 경로도 추가해야 한다. 이 OCR 수정은 Sentry 변경과 섞지 않고 별도 feature branch에서 처리한다.

### 캐릭터/정원 시트

- 두 첨부는 동일한 시트다. vault에 두 번 저장하지 않았다.
- 정원 worktree의 단일 후보 asset: `src/assets/characters/paper-pair-v1.webp`
- SHA-256: `cac84b0179f4f0d05a655b4c41c03b644a7fdd67d3701c51a9de30c5f04ff856`
- 캐릭터 전면 마스코트화, 악세사리 판매, 유료 스티커는 권리 검토와 정원 보안 gate 전에는 출시 범위가 아니다.

## 명시적으로 하지 않은 것

- Sentry Production 활성화, canary 전송, CSP 변경, dashboard privacy 설정 변경
- Vercel redeploy 또는 Production 환경변수 추가 변경
- Supabase SQL/migration/RLS/RPC 변경
- Apple/TestFlight/App Store 변경
- 정원 branch merge
- 첨부 원본 이미지의 vault 복제
- 네이버지도 OCR 후처리 또는 빠른 자동저장 동작 수정
- secret/DSN/사용자 콘텐츠의 문서 기록

## STOPPED AT

- branch: `codex/sentry-privacy-minimal`
- changed: Sentry default-OFF 후보, tests, 이 Obsidian 보고서와 canonical ledger 동기화
- explicitly not changed: DB/RLS/E2EE/auth/PartnerDay/CONFIRMED/product record semantics
- tests: local app gate PASS
- Production: NOT APPLIED
- Supabase: NOT APPLIED
- next owner: Kiro GPT-5.6 Sol Max independent reviewer, then primary integration owner

## 가장 작은 다음 단계

최종 dirty diff를 Kiro Sol Max가 read-only로 검토해 P0/P1/P2가 없다고 판정하면 이 default-OFF 준비 코드만 PR로 올린다. CI가 모두 초록이어도 telemetry는 켜지 않는다. 실제 활성화는 위 6개 gate를 별도 변경으로 닫은 뒤 진행한다. 정원은 relationship UUID 봉인 architecture를 별도 결정하기 전까지 그대로 보류한다. 여행 OCR은 별도 branch에서 실제 세 캡처 acceptance failure부터 고친다.
