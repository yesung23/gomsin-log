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

| 단계 | 완료 조건 | 2026-08-27 live 상태 |
|---|---|---|
| 1. 로컬 release candidate | typecheck, lint, 전체 Vitest, web build, phase0, iOS simulator build | **PASS** — 254 files / 3630 tests, phase0 63 migrations / 392 assertions, iPhone 16 Pro iOS 26.5 arm64 simulator `BUILD SUCCEEDED` |
| 2. 온디바이스 실기기 | 지원 iPhone, 한국어, airplane mode, timeout/cancel, latency/heat/battery | **BLOCKED** — iOS 27 iPhone 16 Pro는 연결·pairing됐지만 서명 설치가 codesign에서 끝나지 않아 앱/모델 실기기 동작은 미검증; production flag는 기본 OFF 유지 |
| 3. Supabase schema | 최신 backup/catalog 확인 후 exact delta, reload, actor matrix | **HOLD** — 062 RPC는 live, 063 없음, 064 미적용으로 `authenticated`에 `TRUNCATE` 잔존, 065 hardening marker 없음; ledger가 비어 있어 bulk push 금지 |
| 4. 인증 | Apple provider 활성, query-aware native redirect, Google/Apple 실제 왕복 | **BLOCKED** — live Google ON / Apple OFF / Email ON; redirect allowlist와 Apple 실제 왕복 미검증 |
| 5. Production web | exact commit 배포, 필수 env, legal/support 연락처, authenticated smoke | **BLOCKED** — Vercel Preview는 `415e183` READY, Production은 `d9a2eb0`; Production용 법적 운영자명·개인정보 연락 이메일 env가 없어 새 Production build는 fail-closed |
| 6. 서명·TestFlight | signing, archive validation, TestFlight two-account smoke | **BLOCKED** — Apple Developer 멤버십 결제 처리 중, provisioning profile 없음, signed install/Archive/TestFlight 미실행 |
| 7. App Store 제출 | privacy answers, screenshots, review notes, account deletion/support URL | **UNVERIFIED** |

- PR #90의 이전 exact feature HEAD `415e183123c145cbd60c3e1964409696cd5f9d96`: **PASS** — required checks와 exact Vercel Preview가 성공했다. 마이탭 중앙 정렬 보정 commit `78f8402`는 로컬 full verify와 390px E2E가 PASS했으며, push 후 새 exact-HEAD CI를 다시 받아야 한다. 이는 Production 배포나 실기기 증거가 아니다.

### 2026-08-26/27 게이트 상태 점검 메모

- **로컬 RC / 복무 성장 / 063 투영 및 로컬 remediation**:
  - 초기 Terra 최종 검토 HOLD (P1 전체 verify 미재실행, P2 V4 문서 모순, P2 E2E 군화 RPC 미호출 관측 공백) 및 초기 Sol 보안 검토 HOLD (P2 격리/연결해제 후 stale partnerMilitary 잔존, P3 regex만 사용한 비정상 날짜 허용 취약점) 지적사항에 대한 로컬 remediation 완료.
  - 로컬 조치 내역: 격리(`store.tsx`) 및 커플 라이프사이클 negative membership/연결해제(`coupleLifecycle.ts`) 시 `partnerMilitary` 명시적 제거, `SearchPage.tsx` 비연결 상태 렌더링 방어(`connected` 필수), `sync.ts` strict UTC round-trip 날짜 검증(`isValidCalendarDate`), `e2e/serviceGrowth.spec.ts` 실제 RPC 호출 네트워크 관측(군화 0회, 곰신 1회), V4 문서 정합성 정렬.
  - 집중 remediation 테스트(8개 파일 / 147개 테스트) PASS, typecheck PASS, scoped lint PASS, Playwright serviceGrowth 2건 PASS, `git diff --check` PASS.
  - 최신 전체 회귀 실행 `LANG=en_US.UTF-8 npm run verify` **PASS** (exit code 0): typecheck PASS, full lint PASS, Vitest 252/252개 파일 및 3586/3586개 테스트 전수 PASS, 프로덕션 빌드 2164개 모듈 통과. `partnerDay` seed 991이 전체 스위트에서 정상 통과, `nativeConfig` 57개 테스트 PASS.
  - PostgreSQL 17 phase0 하네스 61개 마이그레이션(001..063) 369개 assertion PASS 유지.
  - 중요한 최종 Terra/Sol delta re-review는 현재 문서 작성 시점 기준 **PENDING** 상태.
- **Xcode 27 경고 해결 및 네이티브 패키징 델타 검증**:
  - Source iOS 최소 배포 타깃(iOS floor)을 14.0에서 15.0으로 상향: `ios/App/Podfile`, App 프로젝트의 4개 deployment-target 설정(Debug/Release의 Project 및 Target 레벨), 2개 로컬 플러그인 podspec(`GomsinlogCapacitorDeviceKeys.podspec`, `GomsinlogCapacitorOnDeviceSummary.podspec`) 반영 완료. `pod install`을 통해 `Podfile.lock` 체크섬 재생성.
  - `Podfile`의 `post_install` 훅을 통해 생성된 third-party pod target들을 일괄 15.0으로 정규화(생성된 Pods 프로젝트 직접 수기 수정 없음).
  - Xcode의 광범위한 "recommended settings" 자동 적용 버튼은 프로젝트 무결성 보존을 위해 사용하지 않음.
  - `[CP] Embed Pods Frameworks` no-output 경고는 Podfile에서 의도적으로 `disable_input_output_paths`를 사용하고 CocoaPods가 생성한 스크립트이므로 무해/non-blocking 상태 유지(생성된 스크립트 직접 수정 없음).
  - 포커스드 네이티브 테스트 127/127 PASS; 주석 정리 후 `nativeConfig` 61/61 PASS; `pod install` PASS; `npx cap sync ios` PASS; `xcodebuild -showBuildSettings`에서 deployment target 및 recommended target 모두 15.0 보고; 무서명 `App.xcworkspace` generic simulator 클린 빌드 `** BUILD SUCCEEDED **`; 미지원 14.0 경고 0건; `git diff --check` PASS.
  - 본 패키징 델타는 이미 문서화된 전체 verify PASS 이후에 수행됨. 2차 전체 verify를 주장하지 않으며 타깃 네이티브 델타 검증(targeted native delta validation)으로 명시.
  - 최종 Terra/Sol delta review는 여전히 PENDING 상태. 프로덕션 변경 없음(Production unchanged).
- **전체 App Store 릴리즈 판정**: 로컬 게이트 PASS에도 불구하고 **HOLD / CONDITIONAL** 유지.
- **Supabase 스키마 (단계 3)**: migration 063은 LOCAL FILE ONLY이며 원격 프로덕션 Supabase에 **NOT APPLIED**, 원격 Supabase 현재 상태 UNVERIFIED.
- **인증 / 프로덕션 웹 / 실기기 (단계 2, 4, 5, 6, 7)**: Vercel 배포 exact SHA 및 환경변수 UNVERIFIED, Apple provider 및 redirect allowlist UNVERIFIED, 지원 iPhone 실기기(온디바이스 AI, Secure Enclave) 및 TestFlight 아카이브/서명 UNVERIFIED / BLOCKED. 프로덕션 mutation 일체 없음(no commit, no push, no deploy).

### 2026-08-27 최종 로컬 closure 및 live preflight

- `LANG=en_US.UTF-8 npm run verify`: **PASS** — typecheck, 전체 lint, Vitest 254 files / 3,630 tests, production build 모두 exit 0. 과거 전체 병렬 부하의 `deviceKeyPort` timeout은 재발하지 않았다.
- PostgreSQL 17 phase0: **PASS** — 63 migrations / 392 assertions. P0 76, P5 93, write-floor 39, rollback 모두 PASS.
- 실제 390px 렌더: 하루 요약 8개(초기 5 + 3개 더 보기, 접기, 8번째 exact record 이동), 게시물 작성/비공개 저장/보호 gate, 곰신·군화 복무 카드, 로그인 landing을 포함한 Playwright 10건 PASS. 로그인 화면은 제품 가치, 필수 동의, 48px Google CTA 활성 전/후를 320px/390px에서 캡처했다.
- `npx cap sync ios`: PASS. Xcode GUI가 과거 `/tmp` probe workspace 충돌 모달을 잡고 있어 원본 workspace CLI가 대기했으나, 소스를 바꾸지 않은 별도 임시 workspace에서 iPhone 16 Pro / iOS 26.5 / arm64 / unsigned build가 `BUILD SUCCEEDED`로 끝났다. 실기기·서명 Archive 증거는 아니다.
- Sol High 보안 closure: **PASS**, P0/P1/P2 0. Terra High 전체 dirty delta: **PASS**, P0–P3 0. Production 승인이나 실기기 증거로 승계하지 않는다.
- live Supabase: `ACTIVE_HEALTHY`, PostgreSQL 17 preview, migration ledger 0행, managed backup/PITR 없음. 2026-08-27 public schema+data custom dump, schema SQL, restore list, SHA256을 저장소 밖 mode 600으로 만들고 검증했다.
- live schema delta: 062 pairing RPC 3개와 ACL은 존재한다. 063 `get_partner_service_info()`는 없고, 064가 미적용이라 `authenticated`에 `SELECT, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN`이 남아 있으며, 065의 `invalid_persisted_pairing_evidence` hardening marker도 없다. 안전한 다음 SQL은 exact 064 → 065 → 063, PostgREST reload, 실제 actor matrix다. 실행 직전 사용자 확인이 필요하다.
- live Auth: Google true, Apple false, Email true, Phone false, signup enabled. Google을 기본 로그인으로 제공하므로 Apple Review Guideline 4.8 대응을 위해 Apple web OAuth가 실제 iPhone에서 작동하기 전 제출하지 않는다.
- 현재 Apple 구현은 Supabase browser OAuth + custom-scheme PKCE다. `ASAuthorizationAppleIDProvider`를 사용하지 않으므로 binary `com.apple.developer.applesignin` entitlement는 추가하지 않는다. Portal App ID/Services ID/provider 설정과 profile은 별도 운영 gate다.
- Production SQL/Auth/Vercel/TestFlight/App Store Connect mutation: **NOT APPLIED**.

### 2026-08-27 실제 기기·원격 운영 gate 갱신

- 마이탭 헤더는 좌우 88px 대칭 슬롯으로 고쳐 `+` 왼쪽, 아이디/자물쇠 화면 정중앙, 작성/설정 오른쪽을 유지한다. 390px 실제 렌더에서 중심 오차 1px 이하와 각 44px 터치 타깃을 E2E로 확인했다.
- 이 보정 뒤 `LANG=en_US.UTF-8 npm run verify`는 exit 0으로 다시 통과했다. 254 files / 3,630 tests, 전체 lint/typecheck, production build가 포함되며 과거 `deviceKeyPort` 병렬 timeout은 재발하지 않았다.
- iOS 27.0 iPhone 16 Pro는 Mac에 연결·pairing됐고 Developer Mode도 켜져 있다. 원본 workspace의 physical-device build는 compile/link 후 Capacitor framework codesign에서 장시간 끝나지 않아 중지했다. signed install, 앱 실행, Foundation Models, Secure Enclave, airplane-mode 평가는 **UNVERIFIED**다.
- Apple Developer 포털은 멤버십 구매를 아직 처리 중이라고 표시한다. App ID/Services ID/key/profile, Supabase Apple provider, Archive/TestFlight/App Store Connect는 활성화 전까지 **BLOCKED**다.
- live Vercel에서 feature Preview `415e183`은 READY이고 Production은 `d9a2eb0`이다. Production env에는 Supabase URL/key만 있으며 `VITE_LEGAL_OPERATOR_NAME`, `VITE_PRIVACY_CONTACT_EMAIL`은 없다. 실명과 실제 모니터링 이메일을 사용자에게 확인받기 전에는 추측해 넣지 않는다.
- live `delete-account` Edge Function은 ACTIVE(version 6, JWT required)이고 Production origin preflight 200, 무인증 POST 401을 확인했다. 실제 계정 삭제는 희생 계정을 영구 삭제하므로 별도 action-time 승인 전까지 **UNVERIFIED**다.
- 현재 디스크 여유는 약 3.8GB라 signed Archive에 부족할 수 있다. 사용자 파일을 임의 삭제하지 않으며 Archive 전에 최소 약 10GB를 확보한다.

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
3. 비어 있는 migration ledger를 replay하지 말고 exact `064_lock_crypto_pairings_table_privileges.sql`을 적용한다.
4. exact `065_harden_e2ee_pairing_rpc.sql`을 적용한 뒤 exact `063_partner_service_projection.sql`을 적용한다.
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
모두 PASS여야 한다. 특히 Apple 로그인, 원격 064/065/063 actor matrix, signed TestFlight,
지원 iPhone 온디바이스 품질이 끝나기 전에는 최종 판정을 `CONDITIONAL`보다 높이지 않는다.
