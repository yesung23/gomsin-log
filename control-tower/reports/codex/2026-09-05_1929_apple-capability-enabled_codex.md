# Apple App ID capability — 2026-09-05 19:29 KST

## Current State / Decision

곰신로그 Apple Developer App ID `app.gomsinlog`의 Sign In with Apple을 primary App ID로
실제 활성화했다. 사용자에게 기존 provisioning profile 무효화·갱신 영향을 설명한 뒤
`해줘`라는 명시적 실행 승인을 받았다. 저장 대상은 이 App ID의 이 capability 하나다.

- Worktree: `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`
- Branch: `codex/rc-v5-final-fixes`
- HEAD before/after: `1c7503e620b9958adf3dad0b30f037bfea6b46c0`
- 기존 Apple 정책 문서/Store identity 테스트 WIP를 보존했다. commit/push/merge 없음.
- 방향: V5§11, Engineering§0, CURRENT_STATE/직전 Apple 원장, 최신 사용자 실행 승인.
  Business NOT APPLICABLE. Conflict NO. provider/CTA 출시 gate는 해제하지 않는다.

## Verification

실제 로그인된 Apple Developer browser UI에서 관찰했다. 계정 개인 정보/키 값은 보고서에 남기지 않는다.

1. Identifiers 목록에서 정확한 `app.gomsinlog`를 열었다.
2. 최초 Sign In with Apple OFF, Data Protection/Complete Protection ON, 기본 In-App Purchase ON.
3. Sign In with Apple만 선택했다. primary App ID 기본값을 확인했고 다른 앱 grouping이나
   존재하지 않는 server-to-server notification URL을 넣지 않았다.
4. 사용자 승인 후 Save를 눌렀다. Apple은 이 App ID를 포함한 provisioning profiles의
   invalidation과 future use 전 regeneration을 안내했다. 앞서 승인받은 영향과 일치해 Confirm했다.
5. 처리 후 목록으로 돌아온 다음 동일 App ID를 다시 열었다.
6. 재조회 결과: Sign In with Apple ON, Enable as a primary App ID,
   Save disabled, Data Protection Complete Protection 유지, 기존 In-App Purchase 유지.

이 증거는 portal 저장만 증명한다. IAP 기본 checkbox가 ON인 것은 판매 승인 증거가 아니다.
앱 설치 파일의 entitlements/profile, 실제 로그인 성공, Apple refresh token 확보·폐기는 증명하지 않는다.

## Changes / External boundary

- **APPLIED:** Apple Developer `app.gomsinlog` Sign In with Apple capability.
- **NOT APPLIED:** Supabase provider/DB/Edge, Apple key 생성·다운로드, Services ID,
  notification endpoint, provisioning profile 재생성, source/feature flag, deploy/master.
- 로컬 변경: CURRENT_STATE, WORK_LOG, 이 보고서. 기존 WIP와 별도로 추적하며 전체stage하지 않는다.
- `careful`의 저장 전 영향 확인 절차를 적용했다. 자동 hook이 작동했다고 주장하지 않는다.
- 테스트: browser save+reopen 상태 검증 실행. 소스 변경이 없어 unit/build 미실행.
  최종 문서 검사 결과는 세션 도구 출력이 증거다.

## Risks / Next Gate

Apple native 로그인을 실제로 열기 전에 server code exchange/token 보관/revoke와 삭제 복구,
서명 capability/entitlements/profile 일치, Supabase native client 설정, signed iPhone
로그인·취소·로그아웃·재로그인·동일 verified-email UID/relay 경계 테스트가 필요하다.
기존 profile은 갱신해야 하며 이번 세션에서는 재생성하지 않았다.
기존 portal capability OFF라는 blocker만 닫는다. **Apple 로그인 전체/RC/master는 HOLD.**

## Rollback / Review Impact

잘못된 App ID가 아니며 등록 후 재조회로 scope를 확인했다. 되돌려야 한다면 같은 App ID의
Sign In with Apple을 OFF로 저장하고 영향받은 profiles를 갱신하는 별도 승인 작업으로 한다.
기존 Apple 설정 초기화 가능성이 있어 확인 없이 toggle-back하지 않는다. 기존 인증서나 키를
삭제/폐기하는 방식으로 되돌리지 않는다. 로컬 기록만 되돌려도 원격 설정은 되돌아가지 않는다.

Review impact DELTA(external capability). source 미변경으로 기존 runtime 리뷰는 불변이지만
실제 Apple 로그인 activation/security gate 전체를 통과시킨 것은 아니다.

## Official references

- [Apple enable app capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/)
- [Apple provisioning profiles](https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles/)
- [Supabase Apple auth](https://supabase.com/docs/guides/auth/social-login/auth-apple)
