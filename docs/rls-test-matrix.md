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


## 4. 마이그레이션 015 추가 검증

015는 앞 절들의 정책을 유지한 채, RLS만으로는 막을 수 없던 경로를 닫습니다.
아래 항목은 SQL 콘솔에서 각 역할로 직접 확인해야 합니다.

### 4.1 초대 코드 — 우회와 정보 노출
| 액션 | A(초대자) | B(수락자) | C(무관한 계정) |
| --- | --- | --- | --- |
| `redeem_invitation(hash)` | `self_invitation` | 유효 코드면 성공 | 유효하지 않으면 `invalid_or_expired` |
| **`consume_invitation(hash)` 직접 호출** | **권한 거부** | **권한 거부** | **권한 거부** |
| `invitation_codes` 직접 SELECT | 거부 | 거부 | 거부 |
| `invitation_attempts` SELECT/INSERT | 거부 | 거부 | 거부 |

- `consume_invitation` 이 거부되지 않으면 013의 시도 제한이 **전부 무의미**합니다.
  이 한 줄이 015에서 가장 중요한 확인입니다.
- 이미 두 명이 연결된 공간의 코드로 시도했을 때 응답이 `invalid_or_expired` 여야
  합니다. `couple_full` 이 돌아오면 추측한 해시가 유효했다는 사실을 알려주는
  것이므로 015가 적용되지 않은 상태입니다.
- `rate_limited` 응답을 받은 뒤 계속 호출해도 `invitation_attempts` 행 수가
  **늘지 않아야** 합니다. 늘어나면 사용자가 스스로 잠금을 연장하게 됩니다.
- 사용되지 않은(`used = false`) 코드 해시는 전체에서 **중복이 없어야** 합니다.
  중복이 있으면 수락자가 엉뚱한 커플로 연결될 수 있습니다.

동시성 검증: A가 연결 해제를 실행하는 동시에 B가 같은 커플의 코드를 수락할 때,
두 트랜잭션이 모두 commit되어 **한쪽만 활성으로 남는 상태가 되어서는 안 됩니다.**
(양쪽 모두 `couples` 부모 row를 먼저 잠그고 잠금 후 멤버십을 재확인합니다.)

### 4.2 계정 삭제
| 액션 | authenticated | service_role |
| --- | --- | --- |
| `begin_account_deletion` | 거부 | 허용 |
| `prepare_account_deletion` | 거부 | 허용 |
| `cancel_account_deletion` | 거부 | 허용 |
| `account_deletion_requests` SELECT/INSERT | 거부 | 허용 |
| `is_my_account_deletion_pending()` | 허용 (본인 기준) | 허용 |

- 삭제 표식이 있는 동안 해당 사용자의 Storage INSERT는 **거부**되어야 합니다.
  (미디어 정리와 삭제 사이의 업로드 경합을 닫는 장치입니다.)
- `prepare_account_deletion` 은 미디어 정리 전에 기록한 record id 집합과
  현재 집합이 **양방향으로 일치하지 않으면 실패**해야 합니다.
- 파트너가 **활성**이면 공유 events/trips의 `created_by` 가 파트너로 이전되고,
  삭제 후에도 파트너가 그 행을 읽을 수 있어야 합니다.
- 파트너가 없거나 이미 연결이 끊겼으면 공유 events/trips는 **삭제**되어야 합니다.
  이전된 채 남아 있으면 아무도 읽을 수 없는 데이터가 영구히 쌓입니다.
- 소유권 이전은 service_role + 트랜잭션 로컬 capability 두 조건이 모두 있을 때만
  가능합니다. authenticated 세션에서 `events.created_by` / `trips.created_by` 를
  바꾸려는 UPDATE는 트리거가 거부해야 합니다.

### 4.3 비공개 일정 알림
| 액션 | A(작성자) | B(파트너) |
| --- | --- | --- |
| 비공개 일정 INSERT/UPDATE/DELETE | 본인만 반영 | **알림 없음** |
| 공유 일정 INSERT/UPDATE/DELETE | 반영 | 무효화 수신 후 재조회 |
| 공유 → 비공개 전환 | 반영 | 무효화 수신, 재조회 결과에서 사라짐 |
| 비공개 → 비공개 UPDATE | 반영 | **알림 없음** |

- `pg_publication_tables` 에 `public.events` 가 **없어야** 합니다. 트리거만
  필터링해도, 테이블이 publication에 남아 있으면 DELETE payload에는 RLS가
  적용되지 않아 파트너가 삭제 시각을 알 수 있습니다.
- `collaboration_invalidations` 는 publication에 **있어야** 합니다.
- `cycle_entries` / `cycle_settings` 는 여전히 publication에 **없어야** 합니다.

### 4.4 여행 항목 정합성
| 액션 | 기대 |
| --- | --- |
| `url` 에 `javascript:` / `data:` / 상대경로 저장 | CHECK 제약 거부 |
| `url` 에 2048자 초과 문자열 | 거부 |
| 같은 날 같은 `sort_order` 두 행 | 유니크 제약 거부 |
| `reorder_trip_items` 로 두 항목 순서 교체 | 허용 (제약이 deferred) |
| `reorder_trip_items` 에 기존 순서의 재배열이 **아닌** 값 | 거부 |
| REST로 `sort_order` / `item_date` / `trip_id` 직접 UPDATE | 트리거 거부 |
| 제목·메모·카테고리·url만 UPDATE | 허용 (순서 트리거가 발동하지 않아야 함) |
| 동시 append 2건 | 부모 잠금으로 직렬화, 순서 중복 없음 |

- 마지막 두 줄이 짝입니다. 순서 열을 **언급하지 않는** 수정은 반드시 통과해야
  하고, 언급하는 수정은 반드시 거부되어야 합니다.

### 4.5 Storage 경로
| 경로 | 기대 |
| --- | --- |
| `{활성couple}/{내record}/{파일}` | INSERT 허용 |
| `{활성couple}/{내record}/nested/{파일}` | **거부** (3단만 허용) |
| `{활성couple}/{내record}/.hidden` | 거부 |
| `{남의couple}/…` | 거부 |
| `{활성couple}/{남의record}/{파일}` | 거부 |
| 삭제 표식이 있는 동안 모든 INSERT | 거부 |

중첩 경로가 허용되면 Storage가 중간 단계를 pseudo-folder로 보고하고 `remove()` 가
그것을 조용히 무시해서, 계정 삭제 시 폴더를 비울 수 없게 됩니다.
