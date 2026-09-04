# 출시용 Rollback Runbook

출시 후 장애를 복구할 때도 데이터·개인정보·권한 경계를 낮추지 않는다. 이미 커밋된
DB migration은 과거 파일을 고치거나 역방향 SQL로 지우지 않고, 더 큰 번호의
**forward fix**로 복구한다. migration이 `COMMIT` 전에 실패한 경우에는 그 트랜잭션의
자동 rollback만 신뢰하고 원격 catalog를 다시 확인한다.

## 1. 먼저 멈추고 증거를 고정한다

다음 항목이 하나라도 `UNVERIFIED`이면 Production DB 변경을 시작하지 않는다.

- 장애 시작 시각, 영향 사용자·기능·데이터 범위
- 현재 배포 artifact의 exact Git SHA와 이전 정상 artifact
- 원격 Supabase migration history, 실제 함수·정책·grant, PostgREST schema 상태
- 복구 가능한 DB 백업/PITR 시점과 복원 담당자
- 수정 전 read-only 재현과 owner / active partner / former partner / unrelated / anon /
  authenticated-without-UID actor 결과
- 변경 책임자, 검토자, 중단 조건, 되돌릴 수 있는 앱·Edge artifact

로그와 보고서에는 토큰, 키, 사용자 콘텐츠, 이메일 같은 비밀·개인정보를 남기지 않는다.

## 2. 절대 낮추지 않는 경계

- `USING (true)` 또는 이에 준하는 전체 허용 정책을 만들지 않는다.
- private record의 `is_private` 조건을 무시하지 않는다.
- Storage 정책에서 record·소유자·active-couple 검사를 제거하지 않고 버킷을 public으로
  바꾸거나 객체를 삭제하지 않는다.
- `DROP ... CASCADE`, mass `DELETE`, 과거 migration 수정, 적용된 migration의 이름 변경을
  rollback 수단으로 사용하지 않는다.
- anon, unrelated user, former partner, NULL actor에게 RPC·RLS·Storage 권한을 넓히지 않는다.
- E2EE write floor, key authority, unlink 상태를 구버전 의미로 낮추지 않는다.

보안 경계를 완화해야만 이전 버전이 작동한다면 그 버전은 rollback 대상이 아니다.
해당 기능을 일시 중지하고 안전한 forward fix를 배포한다.

## 3. 계층별 복구 선택

### 앱·웹 UI 장애

1. 새 쓰기 경로를 기능 플래그나 배포 중단으로 닫되, 기존 데이터는 보존한다.
2. 이전 artifact가 현재 DB schema와 호환되고 권한·암호화 의미를 후퇴시키지 않는지
   확인한다.
3. 호환될 때만 Vercel/native artifact를 이전 정상 버전으로 돌린다.
4. 로그인, 기록 읽기·쓰기, private 차단, 연결 해제, 계정 삭제를 다시 검증한다.

### Edge Function 장애

Apple IAP V2의 079 expand → Edge canary → 081 contract 순서와
`send_result_unknown` 재전송 금지는
[`apple-iap-rollout-runbook.md`](apple-iap-rollout-runbook.md)를 함께 따릅니다.

1. 문제 함수를 일시 중지하거나 이전에 검증된 동일 계약 artifact로 되돌린다.
2. service-role·JWT 검사를 제거하거나 클라이언트에 service-role key를 노출하지 않는다.
3. 함수 수정 후 실제 인증 actor와 실패 응답을 확인한 뒤 재개한다.

### DB migration / RLS / RPC 장애

1. 원격 catalog를 read-only로 확인해 저장소 파일과 실제 적용 상태를 분리한다.
2. 영향을 받은 함수·정책·grant만 더 큰 번호의 migration에서 수정한다.
3. 기존 signature와 클라이언트 호환성을 보존하고, `SECURITY DEFINER`가 필요하면
   `search_path = public, pg_temp`, `auth.uid()` 검증, 최소 grant를 함께 고정한다.
4. fresh-chain PostgreSQL에서 실제 actor matrix와 load-bearing negative/mutation 검증을
   통과시킨다.
5. 백업과 영향 행 수를 확인한 뒤 한 migration만 적용하고 PostgREST schema를 reload한다.

적용 후 결함이 발견되어도 이미 커밋된 migration을 `DROP`으로 되감지 않는다. 기능을
닫고 다음 번호의 forward fix를 준비한다.

## 4. 대표 장애의 안전한 대응

### 데이터가 모두 안 보이는 경우

`get_my_active_couple_id()`나 partner projection을 완화하지 않는다. 함수 본문, actor UID,
active membership, RLS, grant, schema cache를 각각 확인한다. 원인이 확인될 때까지 UI는
동기화 불가 상태를 사실대로 표시하고 쓰기를 재시도 큐나 평문 fallback으로 우회하지
않는다. 수정은 기존 private·active-couple 경계를 보존하는 forward migration으로 한다.

### 이미지 업로드 또는 Signed URL 실패

업로드 UI를 일시 중지하거나 Edge Function artifact를 복구한다. Storage SELECT/INSERT
정책의 `daily_records` 연계, owner, `is_private`, active-couple 조건은 제거하지 않는다.
복구 후 owner upload/read, active partner shared read, private/former/unrelated/anon deny를
실제 객체 경로로 검증한다.

### 기록 미디어 cleanup worker 장애

1. 잘못된 prefix 삭제, 반복 실패, lease 이상이 의심되면 scheduler 호출과 해당 Edge
   artifact를 먼저 중지한다. job 행이나 Storage 객체를 수동 삭제하지 않는다.
2. `record_media_cleanup_jobs`의 상태별 건수와 lease 만료 여부만 확인한다. 파일명 목록,
   signed URL, 토큰, 사용자 콘텐츠는 쿼리 결과·로그·보고서에 남기지 않는다.
3. authenticated의 직접 Storage DELETE grant/policy를 복원하지 않는다. 구버전 앱이
   blob 삭제 전에 실패하는 것이 데이터 보존을 위한 의도된 호환 동작이다.
4. tombstone trigger, no-FK 보존, exact-prefix service trigger, account relationship-close
   barrier는 유지한다. worker가 멈춘 동안 계정 삭제가 Auth 단계에서 대기하는 것은
   안전한 실패이며, 이를 우회해 Auth 사용자를 직접 삭제하지 않는다.
5. 원인을 수정한 이전과 호환되는 Edge artifact 또는 더 큰 번호의 forward migration을
   staging에 적용하고, owner/partner/unrelated/anon, service-role lease, response-loss,
   upload/delete race를 다시 확인한 뒤 scheduler를 재개한다.

이미 적용된 083을 되감기 위해 과거 migration을 수정하거나 tombstone을 drop하지 않는다.
앱 artifact를 되돌려야 한다면 `delete_my_record` RPC를 사용하는 버전만 허용한다.

### 비대칭 연결 해제 데이터가 발견된 경우

먼저 대상 couple ID와 예상 영향 행 수만 read-only로 산출한다. 백업 후 검토된 단일
트랜잭션 data patch를 forward migration으로 실행하고, 두 멤버십·crypto pairing·공유
데이터 접근 상태가 현재 unlink 계약과 일치하는지 확인한다. 콘솔에서 즉흥적인 mass
UPDATE를 실행하지 않는다.

## 5. E2EE write floor / Conversation Bridge / unlink

- `040`/`045`: `crypto_write_floor` 행을 삭제하거나 `min_cipher_format`을 낮추지 않는다.
  활성화 후 평문 `daily_records` 쓰기를 하는 구버전 클라이언트를 재배포하지 않는다.
- `043`: 원본 FK/policy만 부분 복원하지 않는다. 완료 상태, private 전환, exact source
  reference를 함께 보존하는 forward fix를 사용한다.
- `044`: legacy `disconnect_couple()`로 되돌리지 않는다. 양쪽 멤버십과
  `crypto_pairings = UNLINKED` 전이를 모두 유지한다.
- 복구 버전도 GLE1 봉투, exact-scope epoch, revision CAS, active device authority를
  유지해야 한다.

## 6. 완료 증거

복구 완료 보고에는 다음을 남긴다.

- 적용 전/후 exact SHA, 배포 artifact, migration 번호
- DB backup/PITR 기준과 영향 행 수
- 실행한 명령과 PASS / FAIL / BLOCKED / UNVERIFIED 결과
- owner / active partner / former partner / unrelated / anon / NULL actor 검증
- PostgREST reload와 실제 사용자 경로 smoke 결과
- 원격 Supabase, Vercel, App Store/TestFlight 각각의 실제 적용 여부

로컬 fresh-chain PASS는 원격 적용이나 Production 정상화를 증명하지 않는다.

## 7. 일회성 운영 백업 관리 및 폐기 통제 (7일 원칙)

현재 제공업체의 정기 관리형 백업이나 시점 복구(PITR)는 운영하지 않으며, 안전한 시스템
변경·마이그레이션·장애 복구를 위한 백업은 서비스 운영자가 직접 일회성으로 생성·관리한다.

### 운영 통제 원칙

- **소유 및 보관 위치**: 서비스 운영자 소유 장비의 저장소 외부(repo 밖 디렉터리)에 저장한다.
- **접근 권한 제한**: 백업 디렉터리는 `700` (`drwx------`), 내부 파일은 `600` (`-rw-------`)으로 설정한다.
- **메타데이터 기록**: 생성 목적, 생성 시각, 검증 완료 또는 작업 취소 시점, 최장 폐기 기한(delete-by, 생성 후 7일 이내)을 기록한다.
- **삭제 절차**:
  1. 삭제 직전 exact path를 재확인한다.
  2. recoverable trash 이동이 가능한 경우 우선 적용한다.
  3. 삭제 후 경로 부재 상태와 작업 기록을 확인·기록한다.
- **RELEASE HOLD**: 백업이 delete-by 만료일까지 미삭제 상태로 남아있으면 후속 릴리스 및 프로덕션 배포를 중단(RELEASE HOLD)한다.
- **비밀 보호**: 백업 목록 및 문서에는 파일 내용, 해시, 암호화 키, DB 행 값을 절대 포함하지 않는다.

### 활성 일회성 운영 백업 현황 (Redacted Inventory)

- `/Users/han-yejun/Desktop/gomsinlog-production-backups/2026-08-26-pre-record-protection`
  - 생성 목적: record protection 마이그레이션 전 백업
  - 생성 시각: 2026-08-26 16:04 KST
  - 검증 또는 취소 시점: 검증/취소 확인 중
  - delete-by: 2026-09-02 16:04 KST
  - 상태: 아직 필요 / 미삭제 (migration/security change 검증 또는 취소 후 7일 내 삭제 예정)
- `/Users/han-yejun/Desktop/gomsinlog-production-backups/2026-08-27-pre-release-065`
  - 생성 목적: release-065 적용 전 백업
  - 생성 시각: 2026-08-27 04:03 KST
  - 검증 또는 취소 시점: 검증/취소 확인 중
  - delete-by: 2026-09-03 04:03 KST
  - 상태: 아직 필요 / 미삭제 (migration/security change 검증 또는 취소 후 7일 내 삭제 예정)

두 백업 모두 현재 마이그레이션 및 보안 변경 검증을 위해 아직 필요하여 삭제되지 않은 상태이며,
migration/security change 검증 또는 취소 후 7일 내 삭제하고 확인 기록을 남긴다.
