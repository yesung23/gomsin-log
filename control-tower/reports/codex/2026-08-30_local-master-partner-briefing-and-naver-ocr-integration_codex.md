# Local master integration — Partner Briefing + Naver OCR

## 판정

- 로컬 master: PASS
- App Store 출시: CONDITIONAL / HOLD
- runtime HEAD: 89094a5174aa2e979b33e7d5b9647982dc4e7835
- base/origin/master: b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3

로컬 master에 49b2f00(Partner Briefing merge), efd1c73(Naver 장소 패널 OCR), 89094a5(OCR 확인 후 저장)를 만들었다. 원격 push와 production 변경은 하지 않았다.

## 실제 사용자 동작

Partner Briefing은 마지막 확인 이후 eligible OUTSTANDING 전체를 multi-day로 압축한다. 임의 Top-N 선택은 없고, actual IDs는 TypeScript provenance에만 남으며 model/native payload에는 ordinal만 전달된다. exact-original 이동과 explicit CONFIRMED 의미론을 유지하며 AI 실패·timeout·취소·stale·malformed 결과는 deterministic fallback으로 처리한다. feature flag는 기본 OFF다.

여행 탭은 네이버지도 캡처를 기기 OCR로 읽어 상호·업종·영업정보·지역을 편집 가능한 확인 화면에 채운다. 사용자가 저장하기 전 DB write는 0건이다. fixture는 도토리가든 안국점, 신라제면 안국점, BBQ치킨 신길대방점을 포함한다.

## 개인정보·보안 불변식

- private, unreadable, wrong-partner, unresolved identity, inactive couple, unpersisted 기록은 upstream에서 제외
- 구조화 cycle/health raw fields, actual record/user/couple IDs, E2EE material은 모델 경계를 넘지 않음
- server AI 및 persistent AI result storage 추가 없음
- Partner Briefing 열람은 CONFIRMED를 쓰지 않음
- DB/RLS/crypto protocol 변경 없음

## 실행 검증

- npm run verify: PASS, exit 0
- full Vitest: 281 files, 4,337 passed, 2 skipped
- OCR/TripDetail focused: 2 files, 17 passed
- test:phase0: PostgreSQL 17, 65 migrations, 420 assertions PASS
- verify:native: 4 files, 107 passed, 2 skipped
- Partner Briefing Playwright: Chromium 390px, 2/2 PASS
- git diff --check origin/master..master: PASS

## 실패·차단·미검증

Sentry는 master에 넣지 않았다. 독립 Sol 검토는 logs/metrics 채널 미차단과 sanitizer throw fail-open을 P1, filename provenance와 PWA precache 문서 불일치를 P2로 판정해 BLOCKED다. telemetry는 OFF로 유지해야 한다.

Couple Garden, 캐릭터, 악세사리, 결제/IAP도 미병합이다. Garden의 임시 worktree 변경은 기능 검토 전에 보존용 branch commit이 필요하다.

exact final master의 실물 iPhone/Foundation Models, 실물 Samsung/Android, 두 계정 Apple/Google OAuth, remote Supabase Apple provider, Vercel deployed SHA, TestFlight 설치와 App Store 심사는 UNVERIFIED다.

## Production과 rollback

- local commit: APPLIED
- push/deploy/Supabase/Apple/TestFlight/App Store: NOT APPLIED

배포된 것이 없어 production rollback은 필요 없다. local integration을 되돌려야 하면 reset 없이 89094a5, efd1c73, merge 49b2f00 순서로 새 revert commit을 만든다. 기존 dirty checkout은 건드리지 않는다.

## 가장 작은 다음 단계

사용자 요청 후 이 문서가 포함된 local master를 origin/master에 push하고 exact remote SHA를 확인한다. 그 다음 Sentry와 Garden을 계속 비활성화한 채 TestFlight 빌드를 준비한다. production Supabase/OAuth/Vercel/Apple 변경은 action-time 상태·영향·rollback을 다시 확인한 뒤 진행한다.
