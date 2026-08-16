> **도구 중립 절차서.** Codex·Kiro·Claude Code가 모두 이 파일을 원본으로 읽는다.
> 각 도구의 설정은 이 파일을 가리키는 얇은 래퍼일 뿐이므로, 내용을 도구별로
> 복사하지 않는다. 수정은 여기서 한 번만 한다. 도구별 진입점은 `docs/skills/README.md`.

# Security Review

`gomsin-control-tower`로 상태를 복구한 뒤 시작한다. 프로토콜 세부는
`docs/E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`, 프라이버시·법적 경계는
`docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`, 커버리지는
`docs/SECURITY_TEST_PLAN.md`와 `docs/rls-test-matrix.md`가 소유한다.

## 절대 약화 금지

PMK / CSK / HRK 분리 · GLE1 semantics · DeviceKeys · LCK protection ·
write-floor fail closed · plaintext downgrade 금지 · 비인가/이전 파트너 거부 ·
exact-source routing · Conversation Bridge metadata-only ·
account switch isolation · unlink authority revocation

**HRK는 CSK로 대체·공유되지 않는다.** 보안 실패를 UX 편의를 위해 plaintext
fallback으로 해결하지 않는다.

## 반복적으로 실제 결함이 나온 지점

1. **미연결 구현.** 보호 함수가 존재하지만 제품 경로에서 호출되지 않는다.
   호출자를 세어 0이면 결함이다.
2. **삼켜진 오류.** 복구가 필요한 상태를 `catch {}`가 "일시적 실패"로 바꿔
   사용자가 복구 경로에 도달하지 못한다.
3. **NULL actor.** SECURITY DEFINER 함수가 `auth.uid()`가 NULL일 때 소유권 비교를
   건너뛴다. 올바른 형태는 NULL actor를 **먼저** 거부하는 것이다.
4. **status를 신뢰.** `devices.status` 같은 운영 상태를 암호 증거로 쓴다.
5. **pending을 active로 취급.** 수락되지 않은 초대를 활성 커플로 본다.

## 점검 순서

- **계정/세션:** 가입·로그인·세션 복구·로그아웃·계정 전환·비밀번호 재설정·계정 삭제·
  탈퇴 복구. 늦게 도착한 async 완료가 다른 계정에 권한을 설치하지 못하는지.
- **커플:** 연결·pending·unlink·재연결·이전 파트너. unlink 후 outbox가 예전 기록을
  새 파트너에게 보내지 않는지.
- **E2EE:** 키 소유·wrapping·nonce·버전·기기 인가·회전·복구·마이그레이션·rollback.
  서버가 모든 콘텐츠를 복호화할 수 있으면 E2EE라고 부르지 않는다.
- **RLS/RPC/Storage:** RLS 활성·authenticated 범위·anon 거부·소유권·활성 멤버십·
  private/shared·GRANT/REVOKE·SECURITY DEFINER 필요성·고정 search_path·`auth.uid()`.
  Storage 경로만으로 인가를 대체하지 않는다.
- **기기 분실/오프라인 캐시:** 이미 접근된 데이터를 원격 회수한다고 주장하지 않는다.

## 증거

negative test가 필수다. 비인가 사용자·비인가 파트너·이전 파트너·anon·비공개 거부.

```bash
npm run test:p0 && npm run test:phase0 && npm run test:p5 && npm run test:write-floor
```

실제 PostgreSQL actor harness가 통과하지 않으면 `RLS verified`라고 쓰지 않는다.

## 보고

각 항목을 `CURRENT / ACTIVE-UNMERGED / LATER / UNVERIFIED`로 분류한다. 검토한 exact
commit을 적는다. HEAD가 바뀌면 이전 review는 승계되지 않는다(`AGENTS.md` §19).
READ-ONLY 리뷰어는 저장소를 수정하지 않는다.
