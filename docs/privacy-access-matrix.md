# Privacy & Access Matrix (Zero Trust Model)

GomsinLog는 프라이빗 커플 일기장으로서 철저한 데이터 격리를 지향합니다.
모든 접근 통제는 프론트엔드의 UI 렌더링 조건문이 아닌, **데이터베이스 계층(Supabase RLS) 및 Storage 정책을 최종 경계(Final Boundary)**로 하여 강제됩니다.

## 1. 데이터 소유권 및 열람 권한 매트릭스

| 도메인 / 테이블 | 속성 / 조건 | 본인 (Author) | 파트너 (Partner) | 제3자 (Other Users) |
| --- | --- | --- | --- | --- |
| **`profiles`** | 인증된 회원 정보 | **CRUD** (소유자) | **R** (연결된 경우만) | 접근 불가 |
| **`couples`** | 커플 고유 정보 | **R / U** | **R / U** | 접근 불가 |
| **`couple_members`**| 상태 및 역할 (active) | **R / U** (본인 상태) | **R** (활성 파트너) | 접근 불가 |
| **`daily_records`** | `is_private = false` | **CRUD** | **R** | 접근 불가 |
| **`daily_records`** | `is_private = true` | **CRUD** | 접근 불가 | 접근 불가 |
| **`events`** | `visibility = 'shared'` | **CRUD** (작성자 기준)| **R** | 접근 불가 |
| **`events`** | `is_private = true` | **CRUD** | 접근 불가 | 접근 불가 |
| **Storage (`media`)**| 커플 공유 사진/음성 | **C / R / D** | **C / R / D** | 접근 불가 |
| **Local Storage** | PWA 오프라인 캐시 | 전체 덤프 (평문) | 해당 없음 | 기기 물리 탈취 시 비공개 기록은 마스킹됨 |

## 2. 권한 탈취 및 데이터 주입(Injection) 방어 규칙

### A. RLS 재귀 참조 방지 방어선
`couple_members` 테이블에 대해 단순히 `USING(couple_id = ...)` 구조로 양방향 조인을 걸면 무한 재귀 에러(Infinite Recursion)가 발생합니다.
- **조치**: `SECURITY DEFINER` 권한을 가진 `get_my_active_couple_id()` 헬퍼 함수를 사용하여 RLS 체인을 끊고 안전하게 내 소속 커플 ID를 반환받아 모든 테이블의 RLS 기준으로 삼습니다.

### B. 파트너의 비공개 데이터 무단 조회 방어
- **조치**: 프론트엔드에서 `isPrivate=true`인 레코드를 가리더라도, 누군가 API로 직접 쿼리하는 것을 막아야 합니다.
- `daily_records` 및 `events` RLS의 `SELECT` 정책에서 `user_id != auth.uid()`인 경우 반드시 `visibility = 'shared'` 및 `is_private = false` 조건이 만족될 때만 반환되도록 DB 단에서 차단합니다.

### C. 타 커플 데이터 주입(Injection) 방어
악의적인 사용자가 자신의 토큰으로 파라미터만 변조하여 타 커플의 ID(`couple_id`)에 데이터를 `INSERT`하는 것을 방지합니다.
- **조치**: `WITH CHECK (couple_id = get_my_active_couple_id())` 제약을 통하여 오직 자신이 활성화된 커플 공간 내로만 쓰기 동작이 가능하도록 검증합니다.

### D. 연결 해제 시의 동기화 (Asymmetric Access 방지)
- **조치**: `disconnect_couple()` RPC 실행 시, 호출한 사람의 상태만 끊는 것이 아니라 트랜잭션을 통해 해당 `couple_id`에 속한 **양쪽 사용자의 `status`를 모두 `disconnected`로 변경**합니다.
- 이를 통해 한쪽만 해제되어 파트너가 남은 데이터를 계속 훔쳐보는 비대칭 접근 상황을 원천 차단합니다.
