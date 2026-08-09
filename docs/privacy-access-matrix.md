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
| **`daily_records.emotion_flow`** | 확정 감정 항목 JSONB | **R** (전 항목) | **R** (`visibility='shared'` 항목만, 비공개 아닌 레코드만) | 접근 불가 |
| **`daily_records.emotion_flow`** | `matchedText` (일기 조각) | 저장 자체를 하지 않음 (`emotionFlowForStorage`) | 접근 불가 | 접근 불가 |
| **감정 흐름 분석 결과** | 흐름 요약·분류·전환 | 클라이언트에서 매번 재계산 (미저장) | 자신에게 보이는 항목으로만 재계산 | 접근 불가 |
| **`events`** | `is_private = false` | **CRUD** (작성자만 mutation) | **R** (활성 커플) | 접근 불가 |
| **`events`** | `is_private = true` | **CRUD** (연결 해제 후에도 본인 접근) | 접근 불가 | 접근 불가 |
| **`trips` / children** | 활성 커플 workspace | **CRUD** | **CRUD** | 접근 불가 |
| **`cycle_entries/settings`** | raw 주기·증상·메모·설정 | **CRUD** | 접근 불가 | 접근 불가 |
| **`cycle_support_signals`** | 명시적 당일 opt-in 상태/메시지 | **CRUD / revoke** | **R** (당일·미철회·미만료) | 접근 불가 |
| **`collaboration_invalidations`** | 본문 없는 slice 무효화 | **R** | **R** | 접근 불가 |
| **Storage (`couple-media`)**| 커플 공유 사진/영상/음성 | **C / R / D** | 공유 기록만 **R** | 접근 불가 |
| **Local Storage** | 기기 설정·장식 사진 | 테마·위젯 배치·설치 안내 여부와 계정별 기기 전용 장식 사진; 인증·프로필 원문·커플·기록·일정·여행·주기 원문 미저장 | 접근 불가·동기화 안 됨 | 장식 사진은 로그아웃·탈퇴 때 모든 계정 키 삭제 |
| **IndexedDB outbox** | 아직 전송되지 않은 본인 기록·첨부 | 본인 기기의 해당 계정 큐만 | 접근 불가 | 계정별 분리, 로그아웃·탈퇴 시 정리 |

## 2. 권한 탈취 및 데이터 주입(Injection) 방어 규칙

### A. RLS 재귀 참조 방지 방어선
`couple_members` 테이블에 대해 단순히 `USING(couple_id = ...)` 구조로 양방향 조인을 걸면 무한 재귀 에러(Infinite Recursion)가 발생합니다.
- **조치**: `SECURITY DEFINER` 권한을 가진 `get_my_active_couple_id()` 헬퍼 함수를 사용하여 RLS 체인을 끊고 안전하게 내 소속 커플 ID를 반환받아 모든 테이블의 RLS 기준으로 삼습니다.

### B. 파트너의 비공개 데이터 무단 조회 방어
- **조치**: 프론트엔드에서 `isPrivate=true`인 레코드를 가리더라도, 누군가 API로 직접 쿼리하는 것을 막아야 합니다.
- `daily_records` 및 `events` RLS의 `SELECT` 정책에서 상대가 읽는 경우 반드시
  `is_private = false` 이고 현재 `get_my_active_couple_id()`와 같은 workspace여야 합니다.
- raw 주기 테이블은 `user_id = auth.uid()`만 허용하며 publication에서도 제거합니다.
  파트너 공유는 원본 FK가 없는 `cycle_support_signals`의 최소 필드만 허용합니다.

### C. 타 커플 데이터 주입(Injection) 방어
악의적인 사용자가 자신의 토큰으로 파라미터만 변조하여 타 커플의 ID(`couple_id`)에 데이터를 `INSERT`하는 것을 방지합니다.
- **조치**: `WITH CHECK (couple_id = get_my_active_couple_id())` 제약을 통하여 오직 자신이 활성화된 커플 공간 내로만 쓰기 동작이 가능하도록 검증합니다.

### D. 연결 해제 시의 동기화 (Asymmetric Access 방지)
- **조치**: `disconnect_couple()` RPC 실행 시, 호출한 사람의 상태만 끊는 것이 아니라 트랜잭션을 통해 해당 `couple_id`에 속한 **양쪽 사용자의 `status`를 모두 `disconnected`로 변경**합니다.
- 이를 통해 한쪽만 해제되어 파트너가 남은 데이터를 계속 훔쳐보는 비대칭 접근 상황을 원천 차단합니다.


### E. Realtime과 DB 정합성
- `couple_members` 변경을 구독하고 foreground/online 복귀 때 authoritative RPC로
  멤버십을 재확인합니다. 불일치하면 공유 records/events/trips를 즉시 제거합니다.
- 공유 일정이 비공개로 바뀌거나 support가 철회되면 source row 자체는 상대 RLS에서
  사라질 수 있으므로, 민감 본문이 없는 `collaboration_invalidations`가 재조회를 알립니다.
- trip item 날짜 검사는 parent row를 `FOR UPDATE`로 잠그고, reorder는 단일 RPC로
  수행해 concurrent range 변경이나 부분 순서 저장을 막습니다.

### F. 비공개 일정의 "활동 시각" 유출 방어 (015)

내용이 새지 않아도 **언제 무엇을 했는지**는 그 자체로 사생활입니다.

- Realtime은 INSERT/UPDATE에는 구독자의 SELECT 정책을 적용하지만, **DELETE
  payload에는 RLS를 적용하지 않습니다.** 지워진 행은 replica identity 열만 담고
  있어서 필터링될 내용이 없습니다.
- 그래서 `public.events` 를 구독하는 파트너는, 작성자가 **비공개** 일정을 지울
  때마다 해석할 수 없는 메시지를 받고 재조회로 반응했습니다. 내용은 못 보지만
  "상대가 방금 비공개 일정을 하나 지웠다"는 사실과 시각은 알 수 있었습니다.
- **조치**: 015가 `public.events` 를 publication에서 제거하고, 클라이언트도 그
  테이블 직접 구독을 없앴습니다. 일정 알림은 트리거가 서버에서 필터링하는
  `collaboration_invalidations` 만 통과합니다. 그 트리거는 공유 일정의 변경과
  공유↔비공개 전환에만 기록하고, 비공개→비공개 활동에는 아무것도 남기지 않습니다.
- 같은 이유로 `cycle_entries` / `cycle_settings` 는 publication에 **넣지 않습니다.**

### G. 첨부 파일의 출처 신뢰 금지

- DB의 `attachments` 에 담긴 임의의 `http(s)` URL을 그대로 렌더링하면, 그 주소가
  tracking pixel로 동작해 열람 시각·IP·User-Agent가 외부로 나갑니다.
- **조치**: 읽기 시점에 `{couple_id}/{record_id}/{파일명}` 형태의 정규 경로만
  인정하고, DB에 들어 있던 `url` 값은 **버립니다.** 표시용 URL은 매번 새로
  발급한 signed URL만 사용합니다. 서명에 실패하면 URL 없이 반환되어 아무것도
  렌더링되지 않습니다.
- Storage INSERT 정책도 같은 3단 경로만 허용합니다(015). 더 깊은 이름을 허용하면
  계정 삭제 시 폴더를 비울 수 없게 되는 문제도 함께 생깁니다.

### H. 로컬 저장소에는 기기 설정과 명시적으로 고른 장식 사진만

- 인증된 세션에서 앱이 `localStorage` 에 저장하는 것은 `widgetLayout`,
  `soldierWidgetLayout`, `hasSeenInstallPrompt`, `theme`과 사용자가 직접 고른 계정별
  장식 사진뿐입니다. 장식 사진은 서버·상대방에게 동기화되지 않으며 로그아웃·탈퇴
  시 `gomsinlog.avatar.*` 키를 모두 삭제합니다. 프로필 원문·커플·초대·복무·연락
  설정·기록은 저장하지 않습니다.
- 남은 항목: Supabase 클라이언트의 `persistSession: true` 가 access/refresh 토큰을
  `localStorage` 에 유지합니다(access token 클레임에 이메일 포함). 로그인 유지를
  위해 필요한 동작이라 **수락하고 기록**합니다.

### I. 미디어 메타데이터와 현재 암호화 경계

- 사진은 업로드 직전에 최대 2048px JPEG로 재인코딩합니다. 원본 EXIF/GPS/기기
  메타데이터는 복사하지 않으며, 변환에 실패하면 원본을 대신 올리지 않고 거부합니다.
- 영상·음성은 현재 원본 바이트를 업로드하므로 컨테이너 메타데이터가 남을 수
  있습니다. UI와 개인정보 처리방침에서 이 한계를 알리고 군사·위치 정보가 담긴
  파일을 첨부하지 않도록 안내합니다.
- 전송 구간은 TLS, 서버 저장은 Supabase의 기본 저장 암호화와 RLS/비공개 버킷으로
  보호하지만, 이는 **종단간 암호화(E2EE)가 아닙니다**. 운영 권한을 가진 서버
  관리자가 기술적으로 평문에 접근하지 못하게 하는 구조는 별도 E2EE 프로젝트로
  설계·마이그레이션해야 합니다.
- 오프라인 outbox의 본문과 `File`은 IndexedDB에 기기 로컬 평문으로 대기합니다.
  OS 기기 암호화의 보호를 받지만 앱 수준 암호화는 아직 적용되지 않았습니다.
