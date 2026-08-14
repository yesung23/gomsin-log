> **Status: HISTORICAL EVIDENCE.** This is limited to the dated read-only audit below;
> it is not evidence of current remote or production state.

# 원격 Supabase 읽기 전용 감사 결과

점검일: 2026-07-30  
점검 방식: `.env`의 publishable key로 `limit=0` 및 행 개수만 조회  
데이터 본문 조회·수정: 하지 않음

## 결론

최초 점검에서 발견한 핵심 보안 문제와 누락 스키마는 2026-07-30에
`009`~`011` 마이그레이션을 순서대로 적용해 해소했다.

- 익명 사용자의 멤버십·기록·민감 RPC 접근이 차단됐다.
- 기록의 감정 컬럼이 추가됐다.
- 일정, 여행, 생리주기 테이블과 RLS 정책이 생성됐다.
- 원격 공개 키로 진행한 비로그인 재검증을 통과했다.

다만 로그인한 테스트 계정 A/B/C를 이용한 커플 간 권한 검증은 아직
진행하지 않았다. 따라서 현재 상태는 “비로그인 보안 및 기본 스키마 적용
완료”이며, 실제 사용자 공개 준비가 끝났다는 의미는 아니다.

## 최초 확인 결과

| 대상 | 원격 상태 |
|---|---|
| `profiles` | 존재 |
| `couples` | 존재 |
| `couple_members` | 존재 |
| `invitation_codes` | 존재 |
| `daily_records` | 존재 |
| `briefings` | 존재 |
| `contact_preferences` | 존재 |
| `get_partner_profile` RPC | 존재 |
| `daily_records.emotion_flow` | 없음 |
| `daily_records.emotion_updated_at` | 없음 |
| `events` | 없음 |
| `trips` | 없음 |
| `cycle_settings` | 없음 |
| `cycle_entries` | 없음 |

## 익명 접근 점검

행 내용은 읽지 않고 `Content-Range` 개수만 확인했다.

| 대상 | 익명에게 보인 행 수 |
|---|---:|
| `profiles` | 0 |
| `daily_records` | 0 |
| `invitation_codes` | 0 |
| `get_partner_profile` 결과 | 0 |
| `couple_members` | **1** |

`couple_members` 익명 노출은 `002` 마이그레이션의 `USING (true)` 정책이 원격에 남아 있음을 의미한다.

## 수행한 대응

현재 존재하는 핵심 테이블만 대상으로 하는 별도 핫픽스를 작성했다.

```text
supabase/migrations/009_remote_core_security_hotfix.sql
```

이 파일은 다음을 수행한다.

- 익명 `couple_members` 조회 차단
- 멤버십 직접 INSERT/UPDATE 차단
- 커플 직접 생성 차단
- 작성자가 다른 커플 ID로 기록을 삽입하는 행위 차단
- 누락된 기록 감정 컬럼 추가
- 커플당 두 번째 활성 멤버를 막던 잘못된 인덱스 제거
- 커플 생성·초대 참여·연결 해제를 원자적 RPC로 제한
- 연결 해제 시 양측을 동시에 비활성화

## 적용 당시 확인 조건

1. Supabase 스키마 백업
2. 가능하면 별도 스테이징 프로젝트 생성
3. 핫픽스를 하나의 트랜잭션으로 실행
4. 익명 `couple_members` 결과가 0행인지 재확인
5. 테스트 계정 A/B/C로 `docs/rls-test-matrix.md` 수행

## 최초 점검 당시 자동 적용하지 않은 이유

- publishable key에는 DB 정책을 변경할 권한이 없다.
- Supabase CLI 로그인 또는 Dashboard SQL Editor 접근이 필요하다.
- Windows 브라우저 제어 승인이 시간 초과되어 관리 화면을 확인하지 못했다.
- 백업과 대상 프로젝트 식별 없이 운영 DB를 변경하지 않는 것이 안전하다.

## 적용 후 재검증

2026-07-30에 사용자가 Dashboard SQL Editor에서
`009_remote_core_security_hotfix.sql`을 실행했고 성공 메시지를 확인했다.

읽기 전용 재검증 결과:

| 대상 | 적용 전 | 적용 후 |
|---|---:|---:|
| 익명 `couple_members` 노출 | 1행 | **0행** |
| 기록 감정 컬럼 | 없음 | **존재** |
| 익명 프로필 노출 | 0행 | 0행 |
| 익명 기록 노출 | 0행 | 0행 |
| 익명 초대 코드 노출 | 0행 | 0행 |

읽기 전용 `get_partner_profile` RPC는 익명 호출에 빈 200 응답을 반환했다.
기존에 `anon` 역할에 직접 부여된 실행 권한까지 명시적으로 제거하기 위해
`010_revoke_anon_rpc_access.sql`을 추가했다.

`events`, `trips`, `trip_items`, `trip_checklists`, `cycle_settings`,
`cycle_entries`가 원격에 없으므로 최종 RLS와 Realtime 등록을 포함한
`011_create_missing_feature_tables.sql`을 추가했다.

### 010 적용 결과

사용자가 SQL Editor에서 `010_revoke_anon_rpc_access.sql`을 실행했다.

- 익명 `get_partner_profile` 호출: `401 / 42501`
- 익명 `couple_members` 조회: `401 / 42501`
- 익명 `daily_records` 조회: `401 / 42501`

### 011 적용 결과

사용자가 SQL Editor에서 `011_create_missing_feature_tables.sql`을 실행했다.
publishable key로 각 테이블의 컬럼을 조회했을 때 모두 `401 / 42501`을
반환했다. 존재하지 않는 테이블의 `404 / PGRST205`와 달리, 테이블은
생성되었고 익명 역할에는 접근 권한이 없음을 의미한다.

- `events`
- `trips`
- `trip_items`
- `trip_checklists`
- `cycle_settings`
- `cycle_entries`

## 인증 사용자 테이블 권한 보완

커플 생성과 참여는 SECURITY DEFINER RPC로 성공했지만, 첫 실제 기록 저장
테스트에서 `daily_records` 쓰기가 실패했다. 원격 초기 스키마가 로그인
사용자 역할의 핵심 테이블 권한을 명시적으로 보장하지 않기 때문에 RLS
정책에 도달하기 전에 테이블 권한에서 거절될 수 있다.

`012_authenticated_core_table_grants.sql`은 비로그인 역할의 핵심 테이블
권한을 다시 제거하고, 로그인 역할에는 앱이 사용하는 최소 작업만
허용한다. 각 행에 대한 실제 접근 범위는 기존 RLS 정책이 계속 제한한다.

사용자가 012를 SQL Editor에서 적용했고 Success 결과를 확인했다.

적용 직후에도 기록 저장이 실패해 브라우저 콘솔을 확인한 결과,
`couple_members` 요청이 404로 실행됐고 앱 로그에는
`Cannot save record without an active couple`이 남았다. 화면의 로컬 상태에는
과거 로그인 사용자가 남아 있었지만 실제 Supabase 세션은 없는 상태에서
요청이 익명 역할로 전송된 것이 원인이었다.

프론트엔드는 다음과 같이 보완했다.

- 로컬 상태 복원이 끝난 뒤 Supabase 세션을 확인한다.
- `INITIAL_SESSION`이 비어 있으면 과거 사용자·커플·기록 상태를 제거한다.
- 인증 확인이 끝나기 전에는 보호된 앱 화면을 렌더링하지 않는다.
- 실제 세션이 없는 사용자는 로그인 화면에서 다시 인증하게 한다.
