# Closed Beta 보안 및 RLS 수정본 가이드

본 문서는 결함이 발견되어 수정된 005~007 마이그레이션과 클라이언트 캐시/저장소 로직의 변경 사항을 안내합니다.

## 수정된 보안 원칙
1. **단일 진실 공급원(Single Source of Truth)**: `events`의 권한을 `is_private` 하나로 통일하고 `visibility`를 제거했습니다.
2. **트랜잭션 및 락(Lock) 기반 동시성 제어**: `consume_invitation` 및 `disconnect_couple` 호출 시 경쟁 조건(Race Condition)을 방지하기 위해 `FOR UPDATE` 행 잠금 및 `RETURNING` 패턴을 적용했습니다.
3. **Storage Signed URL 발급 통제**: 프론트엔드가 아닌 Edge Function을 통해 발급하도록 구조를 변경하여 파일 경로뿐만 아니라 DB 레코드의 `is_private` 속성까지 교차 검증합니다.
4. **로컬 캐시 완전 파기**: `localStorage` 내역에서 private 레코드를 부분 마스킹하는 대신 아예 persist 대상에서 제외(또는 더מי 데이터로 덮어쓰기)하고 버전 키를 `v2`로 교체했습니다.

## 테스트 문서 참조
자세한 테스트 시나리오 및 A/B/C 계정별 권한 검증 목록은 `docs/rls-test-matrix.md`를 참고하시기 바랍니다. 장애 대응은 `docs/operations/rollback-runbook.md`에 기재되어 있습니다.
