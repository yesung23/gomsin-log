# Apple verified-email 승인 및 화면 안내 checkpoint

- 기준: worktree `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`, branch
  `codex/rc-v5-final-fixes`, HEAD `1c7503e620b9958adf3dad0b30f037bfea6b46c0`.
- 사용자 승인: Apple/Google의 동일 본인확인 이메일이면 Supabase identity 연결을 통해 기존
  계정으로 이어짐. 다른 UID의 기록/커플/구매 병합은 승인하지 않음. V5§11, Engineering,
  Security Test Plan, 제출 초안과 Current State의 과거 충돌 조건을 갱신했다.
- 절차: 기존 isolated worktree 재사용, subagent-driven-development/TDD. Bohr SolMax
  read-only Architect, Jason FlashHigh 한 테스트 파일 writer. 모두 종료됐고 source writer 없음.
- 현재 화면 직접 확인: Google Enabled, Apple Disabled, Confirm email ON/manual linking OFF.
  Apple provider sheet의 Client IDs/Secret Key 공란, email optional OFF, callback 기존값 확인.
  Apple Developer Keys 목록은 Getting Started/Create a key. 키/secret/설정값을 변경하지 않았다.
- `xcrun devicectl list devices`: 실물 iPhone16Pro available(paired). 이전 unavailable와 구분한다.
  서명된 Apple 로그인·온디바이스 모델 실행은 여전히 UNVERIFIED.
- Architect 결정: 신규 Apple credential을 서버에서 UID↔검증 Apple sub↔code exchange 결과로
  결속하고 별도 서버 키로 refresh token을 암호화 보관한다. 이메일 조회/클라이언트 반환 금지.
  삭제 원장과 revoke 재시도를 연동하되 token 없음/복구 불가와 일시적 API 장애를 구분한다.
  token이 없더라도 탈퇴를 영구 차단하지 않고 Apple TN3194의 수동 해제 복구 경로를 제공한다.
  이 서버 경로는 **설계 결정이며 아직 구현하지 않았다**. 다음 bounded worker에 넘긴다.
- 배제 대안: 매 탈퇴마다 Apple 재인증만 강제하면 취소/분실/복구 불가 시 삭제가 막힌다.
  refresh token 신규 서버보관은 운영 secret/복구/보존 책임이 추가되므로 독립 Max 검토가 필요하다.
- 실제 실행: parent 기존 Apple/Auth4files65 PASS, typecheck PASS, 신규 Store7 PASS;
  worker Store/authGuard/expiry3files38 PASS, scoped lint0. parent diff-check/local docs14links PASS.
  첫 parent 선택 명령의 `supabaseAuthSessionIntegration.test.ts`는 존재하지 않아 수집되지 않았고
  실제 실행 파일은 4개다. 이를 5개 검사로 세지 않는다. Node26 localStorage 경고 및 기존
  auth fail-closed fixture diagnostics가 있었으며 pristine output으로 주장하지 않는다.
- 신규 Store suite는 동일 UID의 USER_UPDATED provider 갱신/다른 UID 계정전환/relay/대기 중
  격리를 확인한다. hosted 자동 연결, 실제 두 provider SIGNED_IN 전체 흐름을 증명하지 않는다.
  worker의 mutation 항목은 실제 소스 mutant 실행이 아닌 예상 sensitivity 설명이다.
- WIP: 문서5개+Store 테스트1개 및 이 원장/리포트. 별도 독립 test-quality 검토 전이며 미커밋이다.
  사용자 화면 도움 요청에 즉시 응답하기 위해 서버 구현 dispatch는 아직 하지 않았다.

## STOPPED AT

- exact HEAD / branch: 위 기준. PR 없음.
- changed: V5/Engineering/Current State/Security Test Plan/App Store Draft, Store identity test,
  WORK_LOG/이 report. `Now.md`는 claim script만 사용.
- explicitly not changed: production runtime/auth/RLS/DB/native/crypto/Book/실사용 데이터.
- tests not executed: hosted 실제 provider identities, Apple token exchange/revoke, signed device,
  독립 신규test 검토, 전체RC. 기존6092 전체검사를 최신 독립검토로 승계하지 않음.
- Production / Supabase: **NOT APPLIED**. 키 생성/설정 저장/migration/배포/merge/push 없음.
- P6 / release: HOLD. 현재 승인은 정책 blocker만 해소함.
- rollback: 미커밋 delta를 다른 사용자 변경과 구분해 좁게 되돌릴 수 있음. 운영 변경 없음.
- next owner/action: parent 화면 안내 → 신규test 실제 SIGNED_IN coverage/독립 검토 →
  서버 credential 등록/암호화 보관/revoke·삭제 원장 통합의 별도 bounded Worker.

근거: [Supabase linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
[Apple provider](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).
