[GOMSINLOG CONTROL TOWER]

## Current State

`codex/rc-v5-final-fixes`의 `f4182593ff1f852e03dcedaa89b0ab7b76f0bf0a`에 계정삭제 경합, 계정 전환, 오프라인 미디어 재시도, E2EE 런타임 수명과 release fuse를 하나의 local reliability gate로 고정했다. Production과 원격 Supabase는 변경하거나 확인하지 않았다.

## Findings

- 삭제 전 preflight만으로는 서버 mutation 도중 삭제나 계정 전환이 일어나는 경합을 막지 못했다.
- media retry가 매번 새 경로를 만들거나 부분 업로드를 완료로 오인할 가능성이 있었다.
- E2EE를 exact-true로 켤 수는 있었지만 모든 ceremony가 operation-lifetime 삭제 barrier를 갖추지 못했다.
- allowlist 기반 정적 검사가 이미 허용된 파일 내부의 새 mutation을 놓칠 수 있었다.

## Decision

- 계정별 Web Lock lease와 attempt-bound recovery marker를 서버 operation 전체 수명에 유지한다.
- queued media는 최초 생성된 immutable plan과 UUID object path를 재사용한다.
- E2EE 구현을 제거하지 않고 Production/release exact-true 활성화만 fail-closed 한다.
- mutation exemption은 파일명뿐 아니라 정확한 transport token과 whole-source occurrence count까지 고정한다.

## Changes

- 계정삭제 shared/exclusive lock, intent lock, v2 marker, stale identity 차단을 모든 주요 write path에 적용했다.
- outbox schema v2, stable media plan, atomic row replacement, authoritative duplicate reconciliation을 적용했다.
- E2EE runtime registration을 token/provider lifetime 기준으로 바꾸고 release fuse를 추가했다.
- server call-path audit와 negative regression을 확장했다.

## Verification

- 전체 Vitest: 1,395 suites / 5,606 tests / 5,604 PASS / 2 skip / 0 fail.
- TypeScript, 전체 ESLint, staged diff check: PASS.
- 비밀이 아닌 Supabase fixture 환경 production Vite bundle: PASS, 2,581 modules.
- 환경변수 없는 bare build: 의도대로 `VITE_SUPABASE_URL` 누락에서 FAIL.
- 이전 독립 리뷰의 CRITICAL/HIGH는 0; 마지막 MEDIUM static allowlist gap은 수정 후 focused 196 tests PASS.
- 물리 iPhone, remote migration 076, live RLS, Production: UNVERIFIED.

## Risks

- Apple IAP 소비정보·동의·transaction별 credit lot는 아직 HOLD다.
- exact-HEAD 최종 Sol Ultra 리뷰 전에는 READY TO MERGE가 아니다.
- E2EE flag 활성화는 migration 076과 모든 ceremony barrier를 별도 검증할 때까지 차단된다.

## Current Score

- Product: 8.2/10 — 핵심 연결 흐름은 보존됐지만 유료 export 실사용 연결은 남았다.
- UX: 7.8/10 — 오류·복구 경로가 강화됐지만 실기기 전체 흐름은 미검증이다.
- Design: 7.9/10 — 이 gate는 시각 변경을 하지 않았고 기존 V5 톤을 보존했다.
- Engineering: 8.4/10 — 경합·identity·retry 계약과 5,606-test 회귀망을 강화했다.
- Security: 7.8/10 — fail-closed activation은 추가했으나 remote/E2EE/IAP 최종 검증이 남았다.
- Release readiness: 6.9/10 — local bundle과 suite는 통과했으나 IAP, 원격, 기기, Ultra gate가 남았다.

## Next Highest-ROI Goal

판매를 계속 OFF로 둔 채 additive migration 079와 IAP consumption worker를 구현해 구매 지급·실사용·환불·복원을 같은 exact-transaction 원장으로 연결하고, 이후 전체 exact HEAD를 Sol Ultra가 독립 검토한다.
