---
name: gomsin-migration-gate
description: Author or verify a GomsinLog Supabase migration safely. Use when adding, changing, or validating anything under supabase/migrations, when picking the next migration number, or when asked whether a migration is applied remotely. Do not use for application-only code changes that touch no SQL.
---

# Migration Gate

원장은 `supabase/migrations/README.md`가 소유한다. 상태 표기를 섞지 않는다.

| 표기 | 뜻 |
|---|---|
| 로컬 존재 | 작업 트리에 파일이 있다. 그 이상 아무것도 아니다 |
| Git 추적됨 | 커밋되었다. **배포 증거가 아니다** |
| 운영 적용됨 | 원격 카탈로그에서 직접 확인했다 (+확인 날짜) |
| 운영 미적용 | 원격에 없음을 확인했거나 배포한 적 없다 |

## 1. 번호 선택 — forward-only

```bash
ls supabase/migrations/*.sql | tail -6
```

- **041 / 042는 frozen/deferred다.** 재사용·재발급하지 않는다. 파일이 없는 것이 정상이다.
- 기존 migration을 **재작성하지 않는다.** 최신 다음 번호로 forward fix한다.
- 함수 signature/정의를 바꾸면 마지막에 `NOTIFY pgrst, 'reload schema';`를 넣는다
  (`migrationSecurityContracts.test.ts`가 이를 검사한다).

## 2. 보안 형태

- `SECURITY DEFINER`에는 `SET search_path = public, pg_temp`를 고정한다.
- `auth.uid()`가 NULL이면 **먼저 거부**한다. `v_uid IS NOT NULL AND ...`로 비교하면
  NULL actor가 소유권 검사를 건너뛴다.
- 소유권은 인자가 아니라 세션에서 판정한다.
- `REVOKE ALL ... FROM PUBLIC, anon` 후 필요한 역할에만 `GRANT EXECUTE`.
- 되돌릴 수 없는 전이는 운영 status가 아니라 암호 증거(인증서·envelope)에 결속한다.

## 3. 검증 — 파일 존재는 증거가 아니다

새 migration을 harness 체인에 **추가한 뒤** 실행한다.

- `scripts/phase0/storage-authz-harness.mjs`
- `scripts/e2ee/p5-harness.mjs`
- `scripts/e2ee/write-floor-scope-harness.mjs`

```bash
npm run test:phase0 && npm run test:p5 && npm run test:write-floor && npm run test:rollback
```

요구 증거:

- **fresh-chain**: 빈 PostgreSQL에서 순서대로 적용
- **actor test**: 소유자 성공 / 타 계정·NULL actor·anon 거부
- **RLS negative**: 비인가·이전 파트너·비공개 거부
- **mutation proof**: 규칙을 일부러 제거하면 테스트가 실패해야 한다
- **rollback boundary**: 활성화 이후 rollback은 거부되어야 한다

## 4. 파괴적 변경

`DROP` · mass `DELETE` · 파괴적 rewrite · legacy health purge는 명시적 승인 없이
하지 않는다. 필요성·영향 데이터·백업/rollback·호환성·테스트 커버리지를 먼저 제시한다.

## 5. Production

**원격 migration 적용 금지.** 자동 개발 루프에서 Production을 변경하지 않는다.
보고는 항상 `APPLIED` 또는 `NOT APPLIED`로 명시하고, 확인할 수 없으면 `UNVERIFIED`다.

## 6. 원장 갱신

`supabase/migrations/README.md`에 행을 추가한다: 무엇을 고쳤는지, 무엇을 보존했는지,
어떤 검증을 실제로 실행했는지. 다음 사용 가능 번호도 갱신한다.
