> **도구 중립 절차서.** Codex·Kiro·Claude Code가 모두 이 파일을 원본으로 읽는다.
> 각 도구의 설정은 이 파일을 가리키는 얇은 래퍼일 뿐이므로, 내용을 도구별로
> 복사하지 않는다. 수정은 여기서 한 번만 한다. 도구별 진입점은 `docs/skills/README.md`.

# Release Validation

변경 범위에 비례해 실행한다. 모든 작업에 full suite를 강제하지 않는다.

## 범위별 명령

```bash
scripts/agent/validate.sh docs      # 문서만
scripts/agent/validate.sh app       # 앱 코드 (기본)
scripts/agent/validate.sh security   # 보안/암호/lifecycle
scripts/agent/validate.sh migration  # SQL 포함
```

| 범위 | 실행 |
|---|---|
| docs | `git diff --check` + 링크/문구 확인 |
| app | typecheck · lint · 전체 Vitest · build · diff-check |
| security | app + `test:p0` `test:phase0` `test:p5` `test:write-floor` `verify:native` |
| migration | security + `test:rollback` |

`package.json`에 실제 존재하는 script만 쓴다. 없는 명령을 만들어 PASS라고 쓰지 않는다.

## 정직한 보고

실행한 것과 실행하지 않은 것을 분리한다. 실행하지 않은 이유를 적는다.

**항상 `UNVERIFIED`로 분류할 것** (이 환경에서 증명 불가):

- remote Supabase catalog · production migration 적용 상태 · staging
- 실제 iPhone: Secure Enclave · DeviceKeys · LCK · cold start · 복구 ceremony
- iOS native 빌드 (Full Xcode 필요) · Android (SDK 필요) · `test:edge` (`deno` 필요)
- CloudKit entitlement / container

환경 전제조건 부재는 **애플리케이션 테스트 실패가 아니다.** 그렇게 보고하지 않는다.

## 금지

- 실행하지 않은 테스트를 통과로 쓰지 않는다.
- 테스트 개수를 신뢰의 근거로 제시하지 않는다.
- `verify:native` 통과를 실기기·서명·entitlement 검증으로 표현하지 않는다.
- migration 파일 존재를 배포 증거로 쓰지 않는다.
- Production은 항상 `NOT APPLIED` 또는 `UNVERIFIED`로 명시한다.
