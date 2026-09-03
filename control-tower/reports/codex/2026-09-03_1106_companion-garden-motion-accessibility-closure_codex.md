# [GOMSINLOG CONTROL TOWER]

## Current State

- Branch: `codex/sol-gomsinlog-rc-v4`
- Base HEAD: `4fecfdfbc8562a8bf069adc40768e5182f3ce932`
- Scope: 정원 캐릭터 2마리의 motion·interaction·responsive·accessibility 7개 파일
- Remote/Production: 변경하지 않음

## Findings

- 두 캐릭터를 각자 timer로 움직이면 동시에 이동·충돌·배터리 낭비가 생길 수 있었다.
- 목적지만 검사하면 이동 경로 중 상대를 통과할 수 있었고, 직접 이동을 빠르게 연속 입력하면 transition 중 실제 위치와 state가 갈릴 수 있었다.
- 리사이즈 왕복은 테두리를 포함한 rect와 테두리 안쪽 absolute 좌표를 섞어 Y를 누적 이동시켰다.
- 최초 수정 뒤에도 drag만 border-box를 써서 짧은 landscape에서 pointer anchor·경계·4px 간격이 어긋나는 잔여 결함이 있었다.
- 상시 compositor promotion은 작은 화면에서 불필요한 GPU memory를 유지한다.

## Decision

- 두 캐릭터는 하나의 scheduler와 하나의 timer를 공유하고 한 번에 하나만 움직인다.
- 실측 footprint, AABB, swept path로 시작점부터 목적지까지 경계·간격을 확인한다.
- freeze, resize, keyboard move, pointer drag 모두 장면의 client box를 단일 좌표계로 사용한다.
- reduced motion에서는 자율 이동과 반복 squirm을 멈추되, 터치·키보드로 직접 놀기와 짧은 pickup feedback은 남긴다.
- 정원은 조용한 관계 기억 surface이며 점수·streak·feeding·mission을 추가하지 않는다.

## Changes

- physical pair bounds와 swept-path clipping/reconciliation 구현
- 52–140px 이동, 42–58px/s, 휴식 혼합의 저빈도 cadence 구현
- pointer capture/cancel/lost-capture/second-pointer와 modal focus 복구 구현
- client-box round trip과 drag mapping 통일
- portrait, small phone, short landscape, reduced motion actual Chrome 회귀 추가
- 지속적인 `will-change` 제거

## Verification

- Garden Vitest: 7 files / 119 tests PASS
- System Chrome: 7/7 PASS, 56.9s
- Target ESLint: PASS
- Full TypeScript: PASS
- Scoped diff check: PASS
- Placeholder production build: PASS, 2,536 modules
- Independent final review: PASS, CRITICAL/HIGH/MEDIUM/LOW 모두 0
- Physical iPhone touch/VoiceOver/energy: UNVERIFIED

## Risks

- 캐릭터 원본 WebP는 1.489 MB라 초기 정원 진입과 저사양 기기 memory를 별도 측정·최적화해야 한다.
- 실제 iPhone의 장시간 배터리·발열·VoiceOver rotor/gesture는 브라우저와 jsdom으로 증명할 수 없다.
- 캐릭터 상업 이용 권리는 기술 테스트가 아니라 외부 provenance/법률 gate다.
- 상호작용 건물과 유료 악세사리는 이번 범위에 포함하지 않았다.

## Current Score

- Product: 8.0/10 — 관계 기억을 해치지 않는 조용한 retention surface
- UX: 8.2/10 — 터치·키보드·modal 이동이 같은 기능으로 연결
- Design: 8.0/10 — exact 캐릭터 유지, 과도한 장식 motion 없음
- Engineering: 8.5/10 — pair geometry와 scheduler를 단일 계약으로 통합
- Security: 8.0/10 — 서버·결제·사용자 콘텐츠 경계 변경 없음
- Release readiness: 7.2/10 — browser gate PASS, 실기기와 권리 gate 남음

## Next Highest-ROI Goal

비공개 기록과 일정의 직접 Realtime 구독을 content-free invalidation·RLS authoritative refetch·장애 polling으로 단계적으로 전환해 private DELETE metadata와 stale shared→private 화면 위험을 제거한다.
