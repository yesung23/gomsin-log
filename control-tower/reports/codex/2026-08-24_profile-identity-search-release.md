# 2026-08-24 프로필·찾기·하이라이트 통합 리포트

## 범위

- 찾기 탭의 군화 빈 검색 화면에 복무 정보, D-day, 진행률, 연락 가능 시간, 개인 복무 레벨을 한 번에 표시했다.
- 마이 프로필은 한 사람 이름과 영문 소문자 아이디를 중심으로 표시하고, 문구에 `(함께한 날)`, `(만남)`, `(전역)` 토큰을 지원한다.
- 기존 아바타 선택기를 프로필 사진 변경 진입점으로 연결했다.
- 기념일·이벤트·전역에서 만들어진 하이라이트에 원본 편집 진입점을 추가했다. 임의 평문 하이라이트/커버 저장은 추가하지 않았다.
- `057_profile_identity_and_caption.sql`을 작성하고 fresh-chain actor/RLS harness에 연결했다.

## 방향과 안전 경계

Product V3, Business Memory Roadmap, Engineering Roadmap, 현재 코드와 세션 상태를 확인했다. 관계 점수·조회수·연속 기록·감정 추론·상대방 프로필 행 수정·운영 Supabase 변경은 범위에서 제외했다.

`username`, 문구, 날짜 유형은 현재 로그인한 계정의 자기 `profiles` 행에만 저장하도록 기존 owner 경계를 사용한다. “상대방 폰에서만 변경”은 서버가 계정과 기기를 구분하는 정책이 없으므로 device-only 보장으로 주장하지 않는다. 현재 프로필 사진은 기존 로컬 기기별 아바타 저장 경계를 유지한다.

## 검증

- `npm run verify`: PASS — typecheck, lint, 전체 Vitest 226 files / 3240 tests, build.
- `npm run test:phase0`: PASS — throwaway PostgreSQL 17, fresh chain 001..057, 55 migrations / 309 assertions.
- targeted regression tests: PASS — 마지막 회귀 묶음 2 files / 14 tests 포함.
- `git diff --check`: PASS.
- 원격 Supabase catalog, migration 057 적용, 실제 기기, CI 실행, 사용자 계정의 production browser 경로: 이 리포트 시점에 UNVERIFIED.

## 변경 커밋

- 구현: `e1874d6` (`feat: refine search service and profile identity`)
- master 반영 및 Vercel 응답은 구현 커밋 이후 별도 확인한다.

## 남은 작업

- 일정 특정 이벤트를 바로 여는 query contract가 없어서 하이라이트 편집은 현재 `/schedule`로 안전하게 이동한다.
- remote에 057을 적용하기 전에는 새 username/문구 필드가 서버에 영속되지 않는다. 적용은 사용자가 Supabase 대시보드에서 승인·실행해야 한다.
- Instagram식 임의 하이라이트 생성/커버 편집과 서버 동기화 프로필 사진은 별도 제품·개인정보 결정 없이는 추가하지 않는다.

## Production

NOT APPLIED — Supabase에 SQL이나 데이터 변경을 실행하지 않았다.
