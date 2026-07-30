# RLS Test Matrix

다음 테스트 매트릭스는 A(작성자), B(A의 파트너), C(제3자) 계정을 사용해 005~007 마이그레이션이 정상 동작하는지 검증하기 위한 시나리오입니다.

## 1. 사전 조건 (Pre-conditions)
- **A** 계정: 곰신 (커플 ID: X)
- **B** 계정: 군화 (커플 ID: X) - A와 active 상태
- **C** 계정: 군화 (커플 ID: Y) - C는 다른 커플에 속해 있음

## 2. 테스트 시나리오

### 2.1 Daily Records 접근
| 대상 레코드 | 수행 주체 | 액션 | 예상 결과 |
| --- | --- | --- | --- |
| A의 `is_private = true` 레코드 | A | SELECT, UPDATE, DELETE | **허용 (Allow)** |
| A의 `is_private = true` 레코드 | B | SELECT | **거부 (0 rows)** |
| A의 `is_private = true` 레코드 | B | UPDATE, DELETE | **거부 (0 rows updated)** |
| A의 `is_private = false` 레코드 | B | SELECT | **허용 (Allow)** |
| A의 `is_private = false` 레코드 | B | UPDATE, DELETE | **거부 (0 rows updated)** |
| A의 모든 레코드 | C | SELECT, UPDATE, DELETE | **거부 (0 rows)** |

### 2.2 Record 주입 방어 (Injection Prevention)
| 대상 커플 ID | 수행 주체 | 액션 | 예상 결과 |
| --- | --- | --- | --- |
| X (A의 커플 ID) | B | INSERT (user_id = B, couple_id = X) | **허용 (Allow)** |
| X (A의 커플 ID) | C | INSERT (user_id = C, couple_id = X) | **RlsPolicyViolation 예외** |

### 2.3 Storage 접근 권한
| 파일 경로 | 수행 주체 | 액션 | 예상 결과 |
| --- | --- | --- | --- |
| `X/private_record_id/a.jpg` | A | Edge Function을 통한 Signed URL 생성 | **허용 (URL 발급)** |
| `X/private_record_id/a.jpg` | B | Edge Function을 통한 Signed URL 생성 | **거부 (권한 없음 예외)** |
| `X/shared_record_id/a.jpg` | B | Edge Function을 통한 Signed URL 생성 | **허용 (URL 발급)** |
| `X/shared_record_id/a.jpg` | C | Edge Function을 통한 Signed URL 생성 | **거부 (권한 없음 예외)** |

### 2.4 커플 연결 해제 시나리오
| 사전 상태 | 수행 주체 | 액션 | 예상 결과 |
| --- | --- | --- | --- |
| A와 B가 active 커플 (X) | A | `disconnect_couple()` 호출 | A와 B 둘 다 `status = 'disconnected'`로 변경 |
| A와 B가 disconnected | A | B의 shared 레코드 SELECT | **거부 (0 rows)** |
| A와 B가 disconnected | B | A의 shared 레코드 SELECT | **거부 (0 rows)** |
| A와 B가 disconnected | A | A 본인의 historical 레코드 SELECT | **허용 (본인 작성 글 유지)** |

### 2.5 초대 로직 (Concurrency)
| 사전 상태 | 액션 | 예상 결과 |
| --- | --- | --- |
| B와 C가 동시에 A의 초대 코드 사용 시도 | B와 C의 `consume_invitation` 동시 호출 | 1명만 성공, 다른 1명은 `Invalid, expired, or already used` 예외 발생 |
| A(작성자)가 본인의 초대 코드 사용 시도 | A가 `consume_invitation` 호출 | **거부 (self-invite attempted 예외)** |
