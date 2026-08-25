# 곰신로그 App Store 출시 계획 — 2026-08-25

## 결정

- 첫 스토어 출시는 iPhone만 준비한다.
- Android 사용자는 기존 웹/PWA를 사용한다. Google Play 출시는 현재 gate가 아니다.
- 계정·커플·기록·사진의 공통 source of truth는 계속 Supabase다.
- iCloud/CloudKit은 현재 구현하지 않는다. 나중에 검증할 선택적 암호문 백업 후보이지,
  혼합 커플의 공유 경로나 출시 전제조건이 아니다.
- 온디바이스 AI는 Apple Foundation Models를 쓰는 선택적 문장 다듬기다. 중요한 기억 선정,
  관계·감정·건강 추론, 서버 AI fallback은 만들지 않는다.

## 출시 단계와 현재 상태

| 단계 | 완료 조건 | 2026-08-25 상태 |
|---|---|---|
| 1. 로컬 release candidate | typecheck, lint, 전체 Vitest, web build, phase0, iOS simulator build | **PASS** — 243 files / 3470 tests, phase0 59 migrations / 344 assertions, simulator `BUILD SUCCEEDED` |
| 2. 온디바이스 실기기 | 지원 iPhone, 한국어, airplane mode, timeout/cancel, latency/heat/battery | **BLOCKED** — 연결된 iPhone이 offline; production flag는 기본 OFF 유지 |
| 3. Supabase schema | backup/catalog 확인 후 exact 060 → 061, reload, actor matrix | **NOT APPLIED** — 원격은 057–059 객체만 확인; migration ledger가 비어 있어 bulk push 금지 |
| 4. 인증 | Apple provider 활성, query-aware native redirect, Google/Apple 실제 왕복 | **BLOCKED** — Apple provider disabled; redirect allowlist 보강 전 |
| 5. Production web | exact commit 배포, 필수 env, legal/support 연락처, authenticated smoke | **BLOCKED** — Vercel CLI 미인증; 배포 exact SHA와 지원 이메일 미검증 |
| 6. 서명·TestFlight | signing, archive validation, TestFlight two-account smoke | **UNVERIFIED** |
| 7. App Store 제출 | privacy answers, screenshots, review notes, account deletion/support URL | **UNVERIFIED** |

## 온디바이스 요약의 출시 계약

1. 앱이 먼저 active couple의 상대 작성, 공개, 읽기 가능, 저장 완료, 오늘 기록만 고른다.
   상대 판정은 active `couple_members`에서 읽은 정확한 `partnerUserId` 일치를 요구한다.
   "내가 아님"은 충분하지 않고, 신원을 확인할 수 없으면 모델 경로를 아예 쓰지 않는다.
2. 오늘의 적격 기록 **전부**를 시간순으로 담는다. 임의의 개수 상한은 없다.
   비공개·여러 날·건강/주기 원본은 모델 경계로 보내지 않는다.
3. 네이티브 payload는 `{ index, text }`뿐이다. ID, 날짜, 시간, 미디어 URL은 없다.
4. 모델은 이미 정해진 각 문장을 40자 안에서 다듬기만 한다.
5. JavaScript가 개수·순서·index·길이를 다시 검증하고 하나라도 다르면 전체 결과를 버린다.
6. 미지원·오류·4초 초과·취소·화면 이탈·`Intl.Segmenter` 부재에는 즉시 기존 규칙 요약을
   유지한다. 5개 고정 배치를 순차 처리하며 **전체에 4초 예산 하나**만 쓰고, 어느 배치든
   실패하면 일부가 아니라 **모든 줄**이 규칙 문장으로 남는다.
7. prompt/result를 서버, DB, analytics, URL, push, 앱 로그에 저장하지 않는다.
8. 화면은 처음 5줄만 보여 주고 `N개 더 보기`로 나머지를 펼친다(progressive disclosure).
   AI는 무엇이 중요한지 고르지 않으며, 펼친 줄도 정확한 원본 하나를 계속 가리킨다.
   전체 줄 유지는 상대의 오늘에만 적용되고, 나의 오늘·보관·하이라이트·여러 날이 밀린
   구간은 기존 최대 5줄을 유지한다.

## 원격 작업의 안전 순서

1. exact release SHA와 rollback 문서를 고정한다.
2. Supabase backup과 함수/권한/catalog를 다시 읽는다.
3. `060_partner_username_projection.sql`을 exact SQL로 적용한다.
4. `061_reject_null_partner_profile_actor.sql`을 exact SQL로 적용한다.
5. PostgREST schema를 reload한다.
6. owner, active partner, former partner, unrelated, anon/NULL actor를 실제 세션으로 검증한다.
7. Apple provider와 redirect URL을 설정하고 Google/Apple PKCE 왕복을 실제 iPhone에서 확인한다.
8. production deploy 후 `/us`, `/search`, `/settings`, 기록 작성, 사진 상세, 스토리, 계정 삭제를
   두 계정으로 확인한다.
9. TestFlight에서 같은 경로와 온디바이스 모델의 기기 gate를 다시 수행한다.

## 지금 수정하지 말아야 할 것

- Android native AI 또는 Google Play 전용 기능
- CloudKit을 공통 저장소나 파트너 공유 경로로 만드는 변경
- 서버 AI fallback과 summary DB/cache/migration
- AI의 중요 기억 자동 선정, 관계 점수, 감정·건강 추론
- 음성 녹음·업로드의 성급한 재활성화
- 원격 migration ledger가 비어 있는 상태의 `supabase db push`

## App Store 제출 가능 판정

코드가 존재하거나 simulator가 빌드되는 것만으로 제출 가능하지 않다. 단계 2–7의 실제 증거가
모두 PASS여야 한다. 특히 Apple 로그인, 원격 060/061 actor matrix, signed TestFlight,
지원 iPhone 온디바이스 품질이 끝나기 전에는 최종 판정을 `CONDITIONAL`보다 높이지 않는다.
