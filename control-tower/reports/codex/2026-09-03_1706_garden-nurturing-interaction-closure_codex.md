# [GOMSINLOG CONTROL TOWER]

## Current State

- Branch: `codex/sol-gomsinlog-rc-v4`
- Application HEAD: `27c0805c3eb24e1cb19c0a63b66f876b0847ace7`
- Garden local gate: RELEASE
- Production, remote Supabase, current physical iPhone, TestFlight, App Store: UNVERIFIED / NOT APPLIED

## Findings

- `함께한 100일`과 성장 단계는 사용자가 원하는 놀이터보다 대시보드처럼 보였다.
- 단순 떨림은 잡힌 캐릭터의 몸짓으로 읽히지 않았고, 같은 돌보기 행동을 빠르게 반복하면 두 번째 CSS 모션이 재시작되지 않았다.
- 독립 검증에서 장시간 Garden 테스트가 8/10으로 실패했다. 원인은 앱이 아니라 오래된 Playwright Realtime mock이었다. Supabase Realtime 2.111.0은 Phoenix 배열 wire format을 보내지만 fixture는 객체만 파싱해 수신 4건에 응답 0건이었고, 약 10.4초 뒤 앱이 올바르게 shared workspace를 격리했다.

## Decision

- 정원은 가시 텍스트가 없는 흰 놀이터로 만든다. 사용할 수 없는 상태만 복구 문구를 남긴다.
- 육성감은 점수·레벨·배고픔·출석이 아니라 직접 쓰다듬고, 인사하고, 둘이 같이 노는 반응과 향후 소유 장식/건물에서 만든다.
- 캐릭터는 승인 원본 시트를 그대로 쓰고 25×28px로 보이되 조작 영역은 44×44px 이상 유지한다.
- 보안 quarantine을 약화하지 않는다. E2E mock이 current Phoenix wire format을 정확히 말하게 고친다.

## Changes

- 날짜/나무/단계/설명 제거, white full-screen playfield
- 두 캐릭터 pair-safe 보행과 네 팔다리 독립 walking/flailing
- 쓰다듬기·인사하기·같이 놀기 one-shot 반응, 반복 재시작, focus/live-region/reduced-motion
- 원본 시트 액세서리와 유한 무료 회전 공개 보존
- Phoenix array/object mock decoder와 same-format reply, 10.75초 timeout-boundary 회귀
- canonical/current/history 문서 갱신

## Verification

- Focused Vitest: 11 files / 171 tests PASS
- TypeScript, scoped ESLint, diff check: PASS
- System Chrome Garden: 11/11 PASS, one worker, retry 0
- System Chrome Shop: 2/2 PASS at 320px and 393px
- Production-mode local build: PASS, 2,546 modules
- Independent reviews: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0
- Full exact-HEAD repository suite, current iPhone, remote RLS/Production: UNVERIFIED

## Risks

- 1.489 MB original WebP의 실제 iPhone decode memory와 장시간 배터리는 아직 측정하지 않았다.
- 현재 보유/뽑기 상태는 계정별 기기 로컬이다. 유료 판매 전에는 StoreKit 2 + server-authoritative entitlement + 환불/revocation 운영 계약이 필요하다.
- 캐릭터와 원본 액세서리의 상업 이용 권리는 기술 검증과 별도다.
- 흰 dark-mode 정원은 최신 제품 오너의 명시적 선택이다. 아이콘 대비는 browser에서 확인했지만 실기기 광도/접근성 평가는 남아 있다.

## Current Score

- Product: 8.5/10
- UX: 8.6/10
- Design: 8.3/10
- Engineering: 8.8/10
- Security: 8.2/10
- Release readiness: 7.6/10

점수는 Garden slice 기준이다. 전체 앱 RC 판정은 아니다.

## Next Highest-ROI Goal

사진 기록의 선택·압축·업로드 재시도·고화질 책 원본 보존 경계를 데이터 손실 없이 닫는다. 그 뒤 Garden 유료 상품은 App Store 승인 전 default-OFF인 StoreKit/server entitlement 기반으로 연결한다.
