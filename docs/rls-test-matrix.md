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


## 3. 마이그레이션 014 추가 매트릭스

### 3.1 Events
| 행 | A(작성자) | B(활성 파트너) | C(제3자) | 연결 해제 후 |
| --- | --- | --- | --- | --- |
| A shared event | SELECT/UPDATE/DELETE 허용 | SELECT만 허용 | 모두 거부 | 양쪽 SELECT 거부 |
| A private event | SELECT/UPDATE/DELETE 허용 | 모두 거부 | 모두 거부 | A만 SELECT/UPDATE/DELETE 허용 |

추가 계약: `id`, `couple_id`, `created_by` UPDATE는
`enforce_event_identity_immutable` 트리거가 거부해야 합니다. shared→private 변경 후
B는 invalidation을 받고 재조회 결과에서 해당 행이 사라져야 합니다.

### 3.2 Trips와 children
| 액션 | A | B | C |
| --- | --- | --- | --- |
| trip CRUD | 허용 | 허용 | 거부 |
| item/checklist CRUD | parent가 활성 커플 소속이면 허용 | 허용 | 거부 |
| `reorder_trip_items` | 같은 trip의 유효 payload 허용 | 허용 | 거부 |
| 다른 trip ID 혼합/중복 ID/음수 순서 | 거부 | 거부 | 거부 |
| parent 기간 밖 item insert/update | DB trigger 거부 | DB trigger 거부 | RLS 거부 |
| 기존 item을 제외하는 parent 기간 축소 | DB trigger 거부 | DB trigger 거부 | RLS 거부 |

동시성 검증: 트랜잭션 1이 item insert, 트랜잭션 2가 parent 기간 축소를 동시에 실행할
때 parent row lock 때문에 둘 다 모순 상태로 commit되어서는 안 됩니다.

### 3.3 Raw cycle과 sanitized support
| 대상 | A(owner) | B(partner) | C |
| --- | --- | --- | --- |
| `cycle_entries/settings` | CRUD 허용 | 거부 | 거부 |
| raw cycle Realtime | 수신 안 함 | 수신 안 함 | 수신 안 함 |
| current support signal | CRUD/one-way revoke | 당일·미철회·미만료 SELECT | 거부 |
| support의 raw 날짜/증상/메모 | 테이블에 필드 자체 없음 | 노출 없음 | 노출 없음 |

support insert는 DB가 Asia/Seoul 당일로 고정하고 최대 24시간만 허용합니다. 선택
메시지는 파트너에게 그대로 보이는 사용자 입력이며 80자 이하입니다. 같은
owner/couple/date에는 active 1개만 허용하고, 다른 커플로 재연결한 경우 이전 커플
signal과 충돌하지 않아야 합니다.

### 3.4 연결 해제와 무효화
1. A 또는 B가 연결을 해제하면 `get_my_active_couple_id()`가 즉시 NULL이어야 합니다.
2. shared records/events/trips/children/support SELECT는 즉시 0 rows여야 합니다.
3. 기존 owner-private event와 raw cycle은 owner A가 계속 접근할 수 있어야 합니다.
4. `collaboration_invalidations`는 활성 커플만 SELECT 가능하고 클라이언트 INSERT는
   권한이 없어야 합니다.
5. 브라우저가 Realtime 이벤트를 놓쳐도 foreground/online 복귀 시 membership RPC
   재검증으로 공유 cache가 제거되어야 합니다.
