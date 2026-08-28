# Supabase 마이그레이션 안내

이 폴더의 `.sql` 파일은 **번호 순서대로** 적용합니다. 파일을 직접 수정하지 말고,
변경이 필요하면 새 번호의 파일을 추가하세요.

> **042 번호 예약 충돌 (2026-08-15).** active V1에는 이미 043/044가 있고, frozen
> P6 draft에만 042가 있습니다. 042는 어느 환경에도 적용되지 않은 보존 자산이며,
> 앞으로 P6를 재개할 때는 그 파일을 적용하지 않습니다. 042의 내용을 재검증해
> **047 이상의 새 forward migration**으로 다시 발급해야 합니다. 045는
> write-floor 활성화 보안 수정, 046은 device provisioning actor 결속에
> 사용했습니다. 기존 환경의
> `039 → 040 → 043 → 044` 이력과 fresh 환경의 숫자 순서를 섞어 적용하지 마세요.
> 041 chat migration도 동일하게 frozen/deferred 자산이며 active V1 stack에는 없습니다.

> ⚠️ 이 저장소의 코드만으로는 원격 Supabase 프로젝트의 실제 상태를 알 수 없습니다.
> 아래 "적용 순서"를 반드시 스테이징 프로젝트에서 먼저 검증하세요.

> **📄 057 작성됨 · 운영 미적용 (2026-08-23).** `057_profile_identity_and_caption.sql` —
> owner-only profile identity/caption fields와 database CHECK 및 대소문자 무시 username
> UNIQUE index를 추가한다. **이 파일이 저장소에 있다는 사실은 배포의 증거가 아니다.**
> 원격 카탈로그는 이 작업에서 조회하지 않았고, 운영 Supabase는 변경하지 않았다.
>
> 실제로 실행한 검증: 빈 PostgreSQL 17 에 001–057 을 ORDER대로 적용
> (`npm run test:phase0`, 55 migrations, 309 passed at the earlier checkpoint). 그중 057 계약 13개 — owner update
> 성공 / partner·제3자·anon read·update 거부 / 대소문자 무시 username 중복 거부 /
> 잘못된 username·81자 caption·허용되지 않은 profile_date_type 거부. 기존 profiles
> owner-only 정책을 넓히지 않은 것도 실제 RLS actor로 확인했다.
>
> 실행하지 않은 것: `test:p5` · `test:write-floor` · `test:rollback` 체인에는 넣지
> 않았다. 057은 `daily_records` 의 write floor 와 무관하다.
>
> 다음 사용 가능 번호: **068**.

> **📄 058·059 작성됨 · 운영 미적용 (2026-08-24).** `058_couple_highlights.sql`은
> 활성 커플에 한정된 독립 하이라이트와 순서형 사진 항목, shared-only child RLS,
> SECURITY DEFINER 저장 RPC, private 전환/삭제 시 항목 정리 trigger를 추가한다.
> `059_partner_managed_username.sql`은 본인 username 직접 변경을 막고, 활성 커플의
> 반대편 계정만 갱신하는 잠금·삭제 게이트·충돌 검증 RPC를 추가한다. 두 파일 모두
> 저장소에만 있으며 원격 Supabase에는 적용하지 않았다.
>
> 실제로 실행한 검증: 최신 로컬 phase0 결과는 001–059 체인, 57 migrations,
> 328 assertions PASS이며 058/059의 active partner/private/former/anon/collision
> 경계를 포함한다. 2026-08-24 읽기 전용 table/column 확인과 비변경 anonymous RPC
> negative probe에서 `couple_highlights`는 `404 PGRST205`, `set_partner_username`은
> `404 PGRST202`로 응답해 두 migration의 대상 객체가 원격에 아직 없음을 확인했다.
> 전체 원격 schema dump는 Docker Desktop
> 부재로 BLOCKED이므로 다른 원격 catalog 주장은 `UNVERIFIED`로 남긴다.

> **⚠️ 2026-08-24 실행 순서 오류 진단.** SQL Editor에서 059를 단독 실행하면
> `profiles.username`이 없는 환경에서 `42703`이 발생한다. 057이 해당 컬럼을
> 먼저 만들고 059가 그 컬럼의 trigger/RPC를 추가하므로, 원격 적용 전에는 아래
> read-only 확인을 실행한 뒤 **057 → (058이 아직 없으면 058) → 059** 순서로
> 적용한다. 058이 이미 적용된 경우에는 재실행하지 않는다.

> **현재 사용자 확인:** SQL Editor read-only query에서 `has_highlights = true`가
> 확인되어 058은 원격에 적용된 것으로 기록한다. 057과 059의 컬럼/RPC 확인 전에는
> 059를 재실행하지 않는다.

> **최신 원격 확인 (2026-08-24).** 이후 targeted PostgREST probe에서
> `profiles.username`, `profile_caption`, `couple_highlights`,
> `set_partner_username(text)`가 모두 schema cache에 해석되었고 anon 요청은
> `401/42501`로 거부되었다. 따라서 057–059 대상 객체는 원격에 존재하며 anon
> 경계도 응답한다. 전체 migration ledger는 여전히 별도 확인 대상이다.

> **✅ 031–038 · 043 적용 완료 (2026-08-23, `xzlorqsjajokrlkunxhr`).** 대시보드 SQL
> 에디터로 순서대로 적용했고, 테이블 통계 조회로 확인했습니다: `devices` ·
> `device_certificates` · `scope_keys` · `key_envelopes` · `crypto_pairings` ·
> `crypto_write_floor` · `talk_about_marks` 가 모두 존재합니다.
>
> 이것이 풀어 준 것: **기록 저장**(그 전에는 `no_active_epoch` 로 거부됐다)과
> **이따 이야기하기**(그 전에는 `PGRST205`). 아래 표의 "운영 미적용" 표기는 이 줄보다
> 오래된 것이며, 031–038·043 행에 대해서는 더 이상 사실이 아닙니다.
>
> **남은 미적용: 039 · 040 · 044 · 045 이상.** CLI 추적 테이블은 여전히 비어 있으므로
> 아래 경고는 그대로 유효합니다.

> **원격 실측 (2026-08-22, `xzlorqsjajokrlkunxhr`).** CLI의 마이그레이션 목록 조회와
> 테이블 통계 조회로 직접 읽었습니다. 둘 다 read-only이며 원격을 변경하지 않았습니다.
>
> - **CLI 추적 테이블(`supabase_migrations.schema_migrations`)이 001–055 전부
>   비어 있습니다.** DB가 비었다는 뜻이 아니라 **마이그레이션이 CLI 밖(대시보드 SQL
>   에디터)에서 적용됐다**는 뜻입니다. 그래서 CLI로 일괄 배포하는 명령을 실행하면 이미
>   적용된 001–030을 처음부터 다시 밀어붙입니다. **쓰지 마세요.**
> - 카탈로그 실측: `couples` · `couple_members` · `daily_records` · `events` · `trips` ·
>   `trip_items` · `trip_checklists` · `couple_tasks` · `profiles` · `invitation_codes` ·
>   `invitation_attempts` · `contact_preferences` · `briefings` · `cycle_*` ·
>   `user_sensitive_consents` · `account_deletion_requests` ·
>   `collaboration_invalidations` 존재 → **001–030 적용됨**.
> - `talk_about_marks` **없음**, E2EE 테이블(`devices` · `scope_keys` · `key_envelopes` ·
>   `crypto_pairings` 등) **없음** → **031–055 미적용**. 아래 표의 "운영 미적용" 표기가
>   이 날짜 기준으로 재확인되었습니다.
> - 결과: 로그인 직후 하이드레이션이 `talk_about_marks` 조회에서 `PGRST205`로 실패해
>   `TALK_ABOUT-SERVER` 화면이 뜨고 앱에 들어갈 수 없었습니다. 코드 쪽은 그 조각의
>   실패가 계정 전체의 실패로 번지지 않게 고쳤지만(`talkAbout.ts`의 `isMissingTable`
>   분기), **`이따 이야기하기`는 038과 043을 적용해야 동작합니다.**
> - 038·043 의존성 확인: 두 파일이 참조하는 것은 `daily_records` · `couples` ·
>   `collaboration_invalidations` · `emit_collaboration_invalidation()` ·
>   `get_my_active_couple_id()`뿐이고 전부 원격에 있습니다. 038의 E2EE 언급은 139행
>   **주석 한 줄**이며 실행되는 구문이 아닙니다. 따라서 031–037 없이 이 둘만 적용해도
>   깨지지 않습니다 — 다만 그렇게 하면 위 "042 번호 예약 충돌" 문단이 경고한 **번호
>   순서와 실제 적용 이력의 불일치**가 하나 더 생기므로, 적용한 날짜와 방법을 반드시 이
>   원장에 남기세요.

> **048과 047의 관계 (2026-08-21, 같은 날 갱신).** 위 문단은 원래 "047은 PR #76이 소유하며
> 이 브랜치에는 없습니다 / 여기서 실행한 harness는 047이 빠진 체인입니다"로 끝났습니다.
> **두 문장 모두 이 트리에서 거짓입니다.** 047은 여기 커밋되어 있고 harness `ORDER`에도
> 들어 있습니다. 그때는 참이었고 계보가 합쳐지면서 낡았는데, 하필 **원장이 검증 범위를
> 실제보다 좁게 말하는** 방향으로 낡았습니다 — ONE FACT → ONE AUTHORITATIVE HOME 규칙에서
> 가장 나쁜 방향입니다.
>
> 현재 사실: 001→…→047→048→049→050→051→052→053→054→055가 한 체인이고, 빈 PostgreSQL 17.10에 53개가
> 순서대로 적용되며 272개 assertion이 통과합니다.
>
> **업그레이드 경로는 별도 데이터베이스에서 따로 검증합니다 (2026-08-21).** 빈 클러스터에
> 체인을 한 번에 적용하면 **끝 상태(end state)만** 증명됩니다. repair 문장은 끝 상태가
> 아니라 적용 도중 한 번 일어나는 일이므로, 고칠 행이 하나도 없는 fresh chain에서는
> 영원히 아무것도 보고하지 않습니다. 실제로 054의 repair가 그 사각지대에서 무효였습니다
> (아래 054 항목). phase0 harness는 이제 두 번째 DB `phase0_upgrade`에 001→053을 적용하고,
> **RLS를 통과한 기록 소유자로** `shared_at`을 위조한 뒤 054를 적용해 repair가 실제로
> 동작하는지 확인합니다.

## 상태 표기의 의미

네 가지는 서로 다른 사실이며 절대 섞어 쓰지 않습니다.

| 표기 | 뜻 |
| --- | --- |
| **로컬 존재** | 작업 트리에 파일이 있다. 그 이상 아무것도 뜻하지 않는다. |
| **Git 추적됨** | 파일이 커밋되었다. **배포되었다는 뜻이 아니다.** |
| **운영 적용됨** | 원격 카탈로그에서 직접 확인했다. 확인 날짜를 함께 적는다. |
| **운영 미적용** | 원격에 없다는 것을 확인했거나, 아직 배포한 적이 없다. |

migration 파일이 저장소에 존재한다는 사실은 **운영 적용의 증거가 아닙니다.** 028이
존재하는 이유 자체가 그 혼동입니다(아래 참고). 운영 상태를 적을 때는 반드시 확인
방법과 날짜를 함께 남기세요.

## 파일 목록

| 파일 | 내용 | 상태 |
| --- | --- | --- |
| `001_initial_schema.sql` | 최초 스키마 (profiles, couples, couple_members, invitation_codes, daily_records, briefings, events, trips, trip_items, trip_checklists, contact_preferences) | 적용됨으로 가정 |
| `002_fix_rls_and_rpc.sql` | 초기 RLS/RPC 수정 | 적용됨으로 가정 |
| `002_fix_rls_recursion.sql` | RLS 무한 재귀 수정 (002 중복 번호 — 아래 "002 번호 중복" 참고) | 적용됨으로 가정 |
| `003_add_emotion_flow.sql` | `daily_records.emotion_flow` 추가 | 적용됨으로 가정 |
| `004_create_cycle_tables.sql` | 주기 기록 테이블 | 적용됨으로 가정 |
| `005_secure_rls_policies.sql` | RLS 정책 강화, `events.visibility` → `is_private` | 적용됨으로 가정 |
| `006_auth_and_rpc_fixes.sql` | 인증/RPC 수정 | 적용됨으로 가정 |
| `007_storage_policies.sql` | `couple-media` 비공개 버킷 + Storage 정책 | **필수** |
| `008_membership_integrity.sql` | 멤버십 정합성 | 적용됨으로 가정 |
| `009_remote_core_security_hotfix.sql` | 핵심 보안 핫픽스 (`get_my_active_couple_id`, 커플/초대 RPC, daily_records RLS) | **필수** |
| `010_revoke_anon_rpc_access.sql` | `anon` 역할의 RPC 실행 권한 회수 | **필수** |
| `011_create_missing_feature_tables.sql` | events/trips/cycle 테이블 + Realtime publication | **필수** |
| `012_authenticated_core_table_grants.sql` | `authenticated` 역할 테이블 권한 | **필수** |
| `013_invitation_hardening.sql` | 초대코드 무차별 대입 방어 + 코드 재발급 | **테스트 프로젝트에 적용됨** (아래 주의 참고) |
| `014_feature_privacy_and_collaboration.sql` | 일정/여행/주기 RLS, sanitized support, 협업 Realtime·정합성 | **테스트 프로젝트에 적용됨** |
| `015_security_followup.sql` | 초대 우회·경합 차단, 계정 삭제 트랜잭션, 비공개 일정 알림 차단, 여행 URL/순서 제약 | **테스트 프로젝트에 적용됨** |
| `016_couple_state_visibility.sql` | `get_my_couple_state()` 읽기 전용 RPC (커플 생애주기·초대 유효성) | **신규 / 원격 미적용** |
| `017_partner_profile_hardening_and_schema_reload.sql` | `get_partner_profile()` 의 `search_path` 를 `public, pg_temp` 로 고정 + `NOTIFY pgrst, 'reload schema'` | **신규 / 원격 미적용** |
| `018_shared_tasks_and_trip_places.sql` | 커플 공동 할 일 + 여행 장소 주소·영업시간·좌표·입력 출처 | **신규 / 원격 미적용** |
| `019_call_topics_and_trip_timetable.sql` | 통화 주제 표시 + 여행 장소 방문 시간 | **신규 / 원격 미적용** |
| `020_fix_uuid_active_couple_lookup.sql` | `min(uuid)` 때문에 발생하는 로그인 후 `42883` 복구 | **운영 적용됨 (2026-08-09)** |
| `021_restore_profile_military_info.sql` | 운영에서 누락된 `profiles.military_info` 복구 | **운영 적용됨 (2026-08-09)** |
| `022_cycle_v3_schema.sql` | 주기 V3 테이블 (`cycle_periods`, `cycle_daily_logs`, `user_sensitive_consents`, `cycle_sharing_preferences`) + legacy 안전 이관 | **운영 적용됨 (2026-08-11, 확인됨)** |
| `023_lock_legacy_cycle_backup.sql` | 022 가 만든 `legacy_cycle_entries_backup` 잠금 (RLS + anon 회수) | **운영 적용됨 (2026-08-11, 확인됨)** |
| `024_cycle_v3_account_deletion.sql` | `prepare_account_deletion` 이 주기 데이터와 legacy 백업까지 삭제 | **운영 적용됨 (2026-08-11, 확인됨)** |
| `025_partner_cycle_projection.sql` | `get_partner_cycle_projection()` — 파트너가 볼 수 있는 sanitized 주기 정보만 계산 | **운영 적용됨 (2026-08-11, 확인됨)** |
| `026_projection_requires_consent.sql` | 동의를 철회하면 파트너 공유도 즉시 멈추도록 projection 재정의 | **운영 적용됨 (2026-08-11, 확인됨)** |
| `027_fix_account_deletion_column.sql` | 024 가 잘못된 컬럼명으로 계정 삭제를 전면 중단시킨 것 복구 | **운영 적용됨 (2026-08-11, 확인됨)** |
| `028_restore_couple_media_authorization.sql` | `couple-media` private bucket의 owner/shared-partner SELECT와 owner DELETE 정책 복원 | **Git 추적됨 / 운영 미적용 — 배포 전 read-only 재확인 필요** |
| `029_cleanup_solo_couples_on_account_deletion.sql` | 계정 삭제 시 다른 멤버가 없는 `couples` 관계 메타데이터만 정리 | **Git 추적됨 / 운영 미적용 — 배포 전 read-only 재확인 필요** |
| `030_harden_create_invitation_search_path.sql` | legacy `create_invitation` SECURITY DEFINER의 temp-schema shadowing 차단 | **Git 추적됨 / 운영 미적용 — 배포 전 read-only 재확인 필요** |
| `031_e2ee_key_foundation.sql` | E2EE Phase 1A 키 인프라 (devices, recovery_identities, recovery_public_anchors, device_certificates, device_enrollments, scope_keys, key_envelopes, recovery_challenges, revocation_statements, crypto_pairings, crypto_write_floor, migration_ledger + epoch/삭제 RPC) | **신규 / 어디에도 미적용** |
| `032_e2ee_write_floor.sql` | 되돌릴 수 없는 per-scope write floor + `daily_records` 라우팅 컬럼 (전부 비활성 상태) | **신규 / 어디에도 미적용** |
| `034_e2ee_recovery_challenge_issuance.sql` | 서버 발급 복구 챌린지 (`e2ee_issue_recovery_challenge`), 챌린지-복구 아이덴티티 결속, `e2ee_commit_recovery_authentication` 4-인자 교체 | **신규 / 어디에도 미적용** |
| `035_e2ee_phase1a_p0_closure.sql` | Phase 1A 남은 P0 마감: 2차 기기 인증서 발급자 검증 강화, 승인 직후 ACTIVE 대신 PROVISIONING으로 시작해 envelope 커버리지를 증명한 뒤에만 활성화 | **신규 / 어디에도 미적용** (2026-08-13 문서 정리 중 원장 표 누락을 발견해 추가함 — 이전에는 이 파일이 존재하는데도 표에 행이 없었다) |
| `036_e2ee_device_status_privilege.sql` | G2: `devices.status`를 클라이언트가 위조 가능한 커스텀 GUC가 아니라 컬럼 단위 GRANT로 보호 (035가 실제로는 지키지 못했던 방벽을 대체) | **신규 / 어디에도 미적용** (2026-08-13 문서 정리 중 원장 표 누락을 발견해 추가함) |
| `037_harden_e2ee_account_deletion_survivor_detection.sql` | `e2ee_prepare_account_deletion`이 생존 파트너를 029와 같은 기준(멤버십 row 존재 여부)으로 판정하도록 교체. active만 보던 기존 판정은 disconnected/pending 파트너의 커플 키를 파괴했다 | **Git 추적됨 / 운영 미적용 — 배포 전 read-only 재확인 필요** |
| `038_bilateral_talk_about_marks.sql` | `이따 이야기하기` 양방향 조율용 `talk_about_marks` 테이블. 메타데이터 전용(record_id / couple_id / actor_user_id / created_at)이며 기록 본문·주제·요약을 저장하지 않는다. `daily_records` 쓰기 권한은 그대로 두고 별도 테이블 + RLS로만 해결 | **Git 추적됨 / 운영 미적용 — 배포 전 read-only 재확인 필요** |
| `039_daily_records_content_envelope.sql` | P5. 암호화된 `daily_records` 행이 콘텐츠를 담는 `content_envelope BYTEA`(GLE1 봉투) 추가 + 봉투 헤더의 domain/epoch를 라우팅 컬럼과 대조 + `health` 도메인 거부 + couple 도메인의 active 멤버십 요구. **032의 P0 결함도 함께 고친다** (아래 참고) | **신규 / 어디에도 미적용** |
| `040_e2ee_write_floor_scope_semantics.sql` | 03A follow-up. `e2ee_floor_for(scope_kind, scope_id)` exact-scope lookup, private=user / shared=couple floor routing, PMK-only personal activation, active-couple-only activation, and forward replacement of the 032 enforcement body while preserving the 039 SECURITY DEFINER correction | **신규 / 어디에도 미적용** |
| `043_conversation_bridge_completion.sql` | Conversation Bridge V1: `talk_about_marks`에 완료 상태를 추가하고, 삭제된 원본의 opaque record ID만 보존해 generic unavailable 상태를 표시한다. 원문·preview·주제는 저장하지 않으며 완료 UPDATE는 active couple의 `is_completed = true` 단방향 경로로 제한한다 | **Git 추적됨 / 운영 미적용 — 배포 전 read-only 재확인 필요** |
| `044_unlink_crypto_pairing_authority.sql` | `disconnect_couple()`가 관계 멤버십과 live `crypto_pairings`를 같은 트랜잭션에서 `UNLINKED`로 전환한다. historical key row를 삭제하지 않으며, former partner와 stale local authority가 새 couple scope를 다시 열 수 없도록 하는 forward correction이다 | **Git 추적됨 / 운영 미적용 — 031–040 및 043과 함께 staging actor/RLS 검증 필요** |
| `045_harden_e2ee_write_floor_activation.sql` | 되돌릴 수 없는 exact-scope write floor 활성화를 소유 ACTIVE 기기 + 기기 인증서 + 해당 ACTIVE epoch의 self-notarized envelope에 결속한다. PENDING·recovery·provisioning·failed·revoked 기기는 거부한다 | **신규 / 어디에도 미적용 — 031→032→034→035→036→037→038→039→040→043→044→045 fresh-chain actor 검증 필요** |
| `046_require_actor_for_device_provisioning.sql` | `e2ee_begin_device_provisioning`·`e2ee_finalize_device_provisioning`이 `auth.uid()`가 NULL이면 소유권 비교를 건너뛰던 문제를 forward 수정한다. 두 함수 모두 NULL actor를 먼저 거부하고, 소유자 불일치는 `E2EE_DEVICE_WRONG_ACCOUNT`다. revocation 우선순위·인증서·envelope coverage·허용 상태·idempotent 반환은 그대로 보존한다. PostgREST 캐시를 위해 `NOTIFY pgrst`를 포함한다 | **신규 / 어디에도 미적용 — write-floor harness에서 NULL actor·타 계정·anon 거부를 실제 PostgreSQL로 검증함** |
| `047_care_signal_feeling_unwell.sql` | `cycle_support_signals.kind` CHECK 어휘에 `feeling_unwell`("오늘은 몸이 힘들어요") **한 종류**를 추가한다(4→5). 컬럼 추가·RLS 정책·함수·GRANT 없음이며 014의 couple-scoped 정책을 그대로 상속한다. 서버는 신호를 파생하지 않고, `cycle_daily_logs`를 읽는 문장이 없다. DOWN은 파일 하단에 있으며 해당 kind의 row가 남아 있으면 거부한다 | **신규 / 어디에도 미적용 — phase0 fresh-chain harness에 포함. 048~050과 결합한 001→050 체인도 실행됨(아래 결합 검증 참조)** |
| `048_push_delivery_metadata.sql` | Gate 3 push의 **유일한** 서버 상태. `device_push_tokens`(본인만, 토큰 UNIQUE로 기기 이양 처리) + `push_delivery_state`(수신자별 병합 플래그 하나, **본인만 SELECT**) + 발송 후보 조회·기록·본인 플래그 해제·토큰 회수 함수. `daily_records` AFTER INSERT 트리거가 플래그를 올리되 **`is_private` 기록은 아무것도 올리지 않는다** — 비공개 기록에 알림이 가면 '무언가 썼다'는 사실 자체가 새기 때문이다. **전략은 `couple_members.has_unseen`을 지정했으나 구현·검증 결과 그것이 틀렸다**: 001의 SELECT 정책이 활성 파트너에게 상대 행 전부를 보여주므로 그 자리의 플래그는 곧 읽음 표시가 되고, RLS는 row 단위라 컬럼 하나만 가릴 수 없다. 그래서 전용 테이블로 옮겼다. 토큰 등록은 `register_push_token()`으로만 하며, **같은 토큰을 들고 있던 계정의 행을 먼저 삭제**한다 — APNs·FCM이 재설치·기기 이양 시 같은 토큰을 넘겨주므로, 평범한 INSERT는 UNIQUE에 걸려 새 계정은 알림을 못 받고 **떠난 계정이 그 기기 알림을 계속 받는** 상태가 된다(§14.3 위반). 발송자(Edge Function)는 `service_role`만 호출 가능하며 콘텐츠·이벤트 종류·개수를 볼 수 없다. 029와 같은 in-body gate를 두어 GRANT가 잘못 나가도 본문에서 거부한다. 하루 1회 상한과 연락 가능 시간은 발송자가 아니라 DB가 강제한다. `disconnect_couple`은 양쪽 토큰을 삭제하고 양쪽 플래그를 내린다 | **신규 / 어디에도 미적용 — fresh chain(001→046→048, 45개)에 적용하고 phase0 harness에서 37개 계약을 실제 PostgreSQL 17.10으로 검증함. mutation 6건(비공개 누출·하루 1회·연락 시간·NULL actor·기기 이양·service_role gate) 전부 실패 확인. 플랫폼 검증 mutation 1건은 통과했는데, 테이블 CHECK가 이미 막고 있어 함수 검증은 에러 메시지용이기 때문** |
| `049_product_events.sql` | §19 허용 목록 안의 최소 계측. LV 진입 조건이다(계측 없는 검증은 연극이다). **이 테이블에는 timestamp 컬럼이 없다** — `occurred_on DATE`뿐이다. 다른 모든 테이블이 갖는 `created_at TIMESTAMPTZ DEFAULT now()`를 여기 두면 누가 언제 앱을 여는지의 분 단위 기록이 되고, 그것이 §19가 금지하는 행동 감시다. 리뷰에서 아무도 의심하지 않을 기본값으로 도착한다는 점이 위험하다. `kind`·`screen`은 CHECK 제약의 닫힌 집합, `subject_id`는 UUID라 제목·본문·파일명이 들어갈 수 없다. RLS는 본인 INSERT/SELECT만이고 **파트너에게는 어떤 read 정책도 없다.** UPDATE·DELETE 정책이 아예 없어 이벤트는 사실로 남는다. `user_id`는 payload가 아니라 `auth.uid()` 기본값에서 온다 | **신규 / 어디에도 미적용 — fresh chain 001→049에 적용, phase0 harness에서 19개 계약을 실제 PostgreSQL 17.10으로 검증. mutation 4건(`created_at` 추가·자유 텍스트 컬럼·파트너 read 허용·금지 이벤트 종류) 전부 실패 확인** |
| `050_lv_funnel_readout.sql` | 049를 LV 판독 목록과 대조해 찾은 두 격차를 닫는다. **(1) 측정 단위가 없었다** — 전략은 획득 단위가 '연결된 커플 1쌍'이라고 못박는데 `product_events`에는 `user_id`만 있어 커플 단위 지표 2개(주간 기록 커플 비율·4주 재사용률)를 아예 계산할 수 없었다. `couple_id`를 추가하되 `get_my_active_couple_id()` DEFAULT로 **세션에서 파생**한다 — 클라이언트가 보낼 수 없으므로 속한 적 없는 커플로 귀속시킬 수 없다. RLS 범위는 그대로이고 **파트너 read 정책은 여전히 없다.** **(2) 판독이 곧 행 조회였다** — 함수가 없으면 `service_role`이 raw 이벤트 행을 긁어야 하고 그건 한 사람의 개별 행동을 순서대로 보는 것이다. `lv_funnel_readout`은 **집계만**(metric, value) 반환하며 행 반환 경로가 없다. `lv_couple_return_count`는 **몇 커플이 돌아왔는지**를 주고 어느 커플인지는 주지 않는다. 사용자별 분해·커플 간 순위는 의도적으로 없다. **일별 시계열은 함수가 반환하지 않을 뿐 호출자가 하루짜리 창을 반복 호출해 만들 수 있다** — §19가 날짜 버킷을 허용하므로 위반은 아니지만 함수가 막는 것도 아니며, 그 구분은 LV 운영 규율이 진다 | **신규 / 어디에도 미적용 — fresh chain 001→050에 적용, phase0 harness 197개 중 050이 16개. mutation 5건(클라이언트 위조 가능한 couple_id·service_role gate·커플 대신 계정 집계·재방문이 커플 id 반환·역순 범위 허용) 전부 실패 확인** |
| `051_audit_closure_overload_and_forgeable_couple.sql` | 전수 감사 마감: 034가 지운 recovery 오버로드 제거, `product_events.couple_id` 위조 차단, 기록 회수/공유 전환 시 알림 플래그, NULL 판독 범위 거부 | **운영 미적용** |
| `052_unseen_flag_survives_no_record.sql` | 공유 기록이 **삭제**될 때(계정 탈퇴의 CASCADE 포함) 파트너의 알림 플래그를 내린다 — 048/051이 다루지 않은 경로. **두 가지 정정:** ① 헤더가 계정 탈퇴에서 cascade 순서 때문에 동작하지 않을 수 있다고 얼버무리지만, PostgreSQL 17 실측 결과 **플래그는 내려간다**(harness가 `f`로 고정). ② 헤더의 하강 조건("다른 공유 기록이 없으면")은 **053이 대체**했다 — 오래된 공유 기록이 새 행위의 취소를 막는 결함이 있었다 | **운영 미적용** |
| `053_pending_acts_not_shared_history.sql` | 알림 플래그가 "공유 기록이 있다"가 아니라 **"아직 알리지 않은 행위가 있다"**를 뜻하게 한다. 수신자 경계(`notified_through`) + 기록별 공개 시각(`shared_at`) | **운영 미적용** |
| `054_shared_at_is_server_state.sql` | 053이 취소 규칙 전체를 `daily_records.shared_at`에 의존시켜 놓고 **그 컬럼을 클라이언트가 쓸 수 있게 남겼다.** `authenticated`는 012의 테이블 단위 UPDATE 권한을 갖고, RLS는 row 단위라 컬럼 하나를 가릴 수 없으며, 053의 스탬프 트리거는 `BEFORE INSERT OR UPDATE OF is_private`였다 — `is_private`를 적지 않은 UPDATE는 트리거를 아예 돌리지 않았고, **값을 바꾸지 않고 적기만 한** UPDATE는 아무것도 대입하지 않는 분기로 들어갔다. 실제 체인에서 기록 소유자가 RLS를 통과해 재현했다: 오래된 기록의 `shared_at`을 미래로 밀어두면 유일한 새 행위를 철회해도 파트너 플래그가 **유지된다**(측정값 `t`, 053만으로는 `f`). 트리거를 모든 INSERT/UPDATE로 넓히고 **모든 분기가 대입하게** 해서(전이 없음 → `OLD.shared_at` 복원) 컬럼을 서버 전용으로 만든다. 051 §2와 같은 부류 — 서버가 의존하는 컬럼을, 작성자가 떠올린 경로만 덮는 장치로 지킨 것 **2026-08-21 정정 — repair 문장이 무효였다.** 파일은 트리거를 먼저 설치하고 그 아래에서 이미 왜곡된 행을 UPDATE로 고치려 했다. 그런데 repair 대상은 전부 `is_private = FALSE`이고 그대로 유지되므로, 그 UPDATE는 트리거의 무전이 분기 `NEW.shared_at := OLD.shared_at`로 들어갔고 **트리거가 지우려던 위조값을 그대로 되돌려놓았다.** 두 문장 모두 실행되고 행 수도 보고했지만 아무것도 바뀌지 않았다. 실제 업그레이드 경로에서 측정: 001→053 적용 → 소유자가 RLS를 통과해 `now() + 100 years`로 위조 → 054 적용 → **두 행 모두 2126년 그대로.** 이 파일 자신의 논지가 세 번째로 반복된 것이다(작성자가 떠올린 경로만 덮는 장치). 어디에도 적용되지 않은 파일이므로 새 번호 대신 **054를 직접 수정**했다: repair를 트리거가 붙어 있지 않은 상태에서(DROP TRIGGER 이후, CREATE TRIGGER 이전) 실행한다. DROP은 ACCESS EXCLUSIVE를 잡고 전체가 한 트랜잭션이라 클라이언트가 쓸 수 있는 틈은 생기지 않는다 | **운영 미적용 — fresh chain 001→055(53개)에 적용, phase0 harness 272개 중 054가 10개 + 업그레이드 경로 7개. mutation 4건(054 제거·else 분기 제거·트리거를 `OF is_private`로 되돌림·repair를 트리거 뒤로 되돌림) 전부 실패 확인** |
| `055_notified_through_is_the_send_decision.sql` | 알림이 덮는 범위는 **결정된 시점**의 행위들인데 경계가 그렇게 말하지 않았다. `mark_push_delivered()`가 `notified_through`를 자기 시계(`p_now DEFAULT now()`)로 찍었고, Edge Function은 인자 없이 호출했다. 발송 결정은 그보다 앞선 `push_delivery_candidates()`에서 났으므로 **그 사이에 공유된 기록은 자기를 담을 수 없었던 알림이 그은 경계 뒤로 넘어갔다.** 실제 체인에서 결정적으로 재현(sleep·스레드 없음): R1 공유 → 후보 선정(23:48:00.566) → R2 공유(23:48:00.588) → mark(23:48:00.610) → **`has_unseen = f`, `partner_has_pending_act = f`.** R2는 지연된 게 아니라 **사라졌다** — 플래그가 내려가 다시 선정되지 않고, 스탬프가 경계 뒤라 영원히 세어지지 않는다. 048/051/052/053이 "행위 없는 알림"을 지웠다면 이것은 "알림 없는 행위"를 지운 반대편이다. 수정: `push_delivery_candidates`가 `decided_at`을 함께 돌려주고(발송자는 **자기가 물어본 시각** 하나만 더 알게 된다), `mark_push_delivered(p_user_id, p_decided_at)`가 그 시각으로 경계를 긋되 `GREATEST`로 **뒤로는 절대 못 간다**(그 사이 앱을 연 사람의 자기 경계가 우선). `has_unseen`은 FALSE로 **대입하지 않고** 053의 `partner_has_pending_act()`로 **재계산**한다. `p_decided_at`에 **DEFAULT를 두지 않은 것이 핵심** — 잊은 호출자는 조용히 행위를 지우는 대신 첫 실행에서 즉시 실패한다. 추가하지 않은 것: 이벤트 이력 테이블·알림별 행·pending count·읽음 표시·파트너 가시 상태 없음. 하루 1회 상한과 재시도 안전성은 그대로 **2026-08-22 보강 — 경계는 뒤로 못 갔지만 스탬프는 갔다.** `notified_through`만 `GREATEST`였고 `last_notified_at`은 flat 대입이었다. 두 sender의 mark가 결정 순서의 **역순**으로 도착하면(재시도 큐와 재기동된 스케줄러가 함께 만드는 흔한 순서) 늦게 온 **더 이른** mark가 스탬프를 뒤로 끌었고, 이미 써 버린 그날의 하루 1회 상한이 다시 열려 **같은 날 알림 2건**이 나갔다. 실제 체인에서 재현: D2 mark → D2 새 행위 → 지연된 D1 mark → 스탬프 `2026-08-19 20:00`, `push_delivery_candidates`가 D2에 후보를 다시 반환. 경계 assertion은 **전부 통과하는 채로** 그 옆에서 벌어졌다 — 그것이 이 결함이 리뷰를 통과한 이유다. 어디에도 적용되지 않은 파일이므로 054의 선례대로 새 번호 대신 **055를 직접 수정**했다: 스탬프도 같은 `GREATEST`를 받는다. `GREATEST`는 PostgreSQL에서 NULL을 무시하므로 첫 mark는 그대로 찍힌다. **함께: 계약 테스트가 너무 약했다** — `pg_proc` 행 수 세기와 result type 정규식은 `DEFAULT now()` 복구와 `extra_meta` OUT 컬럼 추가를 **둘 다 통과시켰다**. 이제 `pg_get_function_identity_arguments` · `pronargdefaults` · `pg_get_function_result` · schema 한정 `count(*)`를 한 문자열로 **전량 비교**한다(빈 결과는 선두 `0`이라 우연 통과 불가, 별도 assertion으로 고정) | **신규 / 어디에도 미적용 — fresh chain 001→055(53개)에 적용, phase0 harness에서 055가 32개(A·B·C·D·E·G·H 시나리오 전부 + 영구 negative proof + 카탈로그 계약 전량 비교 + 공백 결과 방지). mutation 5건(재계산 제거 · 경계 `GREATEST` 제거 · **스탬프 `GREATEST` 제거** · **`DEFAULT now()` 복구** · **extra OUT 컬럼** · **stale overload**) 전부 실패 확인** |
| `057_profile_identity_and_caption.sql` | profiles에 nullable `username`·`profile_caption`·`profile_date_type`을 추가하고 username 형식, caption 길이, 날짜 타입 CHECK와 `lower(username)` 대소문자 무시 UNIQUE index를 추가한다. 기존 owner-only profiles RLS 정책과 shared projection/RPC는 변경하지 않는다 | **신규 / 운영 미적용 — fresh chain 001→057에 적용, `npm run test:phase0`에서 55 migrations·309 assertions 통과. 운영 Supabase는 변경하지 않음** |
| `058_couple_highlights.sql` | 독립적인 couple highlight parent/item 모델, 활성 커플 shared-only RLS, SECURITY DEFINER 저장 RPC, private 전환·삭제 시 항목 pruning trigger, `highlights` invalidation slice | **신규 / 운영 미적용 — fresh chain 001→059에 포함, phase0 actor/RLS 계약 검증. 운영 Supabase는 변경하지 않음** |
| `059_partner_managed_username.sql` | 본인 username 직접 수정 차단, 활성 커플의 상대방 username만 갱신하는 SECURITY DEFINER RPC, username 형식·중복·삭제 상태·커플 row lock·`profile` invalidation 검증 | **신규 / 운영 미적용 — fresh chain 001→059에 포함, phase0 actor/RLS 계약 검증. 운영 Supabase는 변경하지 않음** |
| `060_partner_username_projection.sql` | 활성 커플의 상대방 username만 기존 파트너 프로필 projection에 추가로 반환한다. profiles 직접 SELECT/RLS는 넓히지 않고 authenticated 전용 SECURITY DEFINER RPC로 제한한다 | **운영 적용 (2026-08-25) — 사용자가 SQL Editor로 적용, anon probe로 함수 존재·스키마 캐시 반영·anon 거부 확인. fresh chain 001→060 및 phase0 계약 검증 완료** |
| `061_reject_null_partner_profile_actor.sql` | PostgREST 호출 시 JWT subject가 없는 NULL actor(`auth.uid() IS NULL`)를 명시적으로 fail-closed(`42501`) 거부하도록 060 함수를 보강한다. 060 반환 형태와 활성 커플 프로젝션은 유지하되, 060 적용 후 순서대로 적용한다 | **운영 적용 보고됨 (2026-08-25) — 함수 존재는 확인. 다만 본문이 060판인지 061판인지는 anon 경로로 구분 불가하며 인증 actor matrix는 UNVERIFIED. fresh chain 001→061 및 phase0 계약 검증 완료** |
| `062_e2ee_pairing_ceremony_rpc.sql` | 두 계정 기록 보호 페어링 RPC (`e2ee_start_couple_pairing`, `e2ee_confirm_couple_pairing`, `e2ee_mark_couple_pairing_active`), crypto_pairings 직접 write 차단 및 canonical member/slot 분리 | **운영 객체 존재 확인 (2026-08-28) — RPC 3종은 live catalog에 있으나 migration ledger relation이 없어 exact 적용 이력은 재구성하지 않음. fresh chain/actor 계약 검증 완료** |
| `063_partner_service_projection.sql` | 곰신 대상 활성 군화 복무 타임라인 프로젝션 RPC (`get_partner_service_info`), 군 복무 메모(memo) 비공개 유지, 활성 2인 커플 gomsin→soldier 호출만 허용 | **운영 적용 (2026-08-28) — exact SQL·SHA 확인 후 적용. live catalog, PostgREST reload, gomsin/soldier/former/unrelated/anon 경계 검증 PASS** |
| `064_lock_crypto_pairings_table_privileges.sql` | `crypto_pairings` 테이블의 모든 권한을 `PUBLIC, anon, authenticated`로부터 회수 후 `authenticated`에 `SELECT`만 재부여. 062에서 잔존했던 TRUNCATE/TRIGGER/REFERENCES 권한을 완전 차단하여 RLS 우회 위험(P0) 원천 제거 | **운영 적용 (2026-08-28) — authenticated=SELECT only, anon=none, pairing 0행 확인. broad privilege는 복원하지 않음** |
| `065_harden_e2ee_pairing_rpc.sql` | 062 페어링 RPC의 NULL evidence/signature, 만료·확정·활성화 경계를 forward hardening | **운영 적용 (2026-08-28) — RPC 3개 catalog·negative actor 검증 PASS. live active device/scope key가 0이라 실제 두 기기 정상 ceremony는 UNVERIFIED** |
| `066_atomic_push_delivery_claims.sql` | 푸시 발송 후보의 원자적 claim/lease와 claim 소유자 완료·release | **운영 미적용 — live 선행 테이블과 sender가 없어 명시적으로 보류** |
| `067_profile_post_intent.sql` | 기존 기록에 명시적 프로필 게시물 의도 `is_profile_post`를 추가하고 과거 사진은 추측 backfill하지 않음 | **운영 적용 (2026-08-28) — boolean NOT NULL DEFAULT false, 기존 5행 false, actor·rollback 검증 PASS** |
## 047 이 열지 않는 것 — 통증 등급 공유가 아니다 (2026-08-20 초안 → 2026-08-21 개정)

V1_LAUNCH_DECISIONS §5의 제품 결정은 사용자가 **직접** "오늘은 몸이 힘들어요"를 보낼 수
있게 하는 것이며, 승인된 형태는 기존 배려 신호 어휘에 **한 종류를 추가**하는 것입니다.

2026-08-20 초안은 `pain_mild`·`pain_moderate`·`pain_severe` 3단계 어휘를 담았고,
2026-08-21 independent security review가 **CHANGES_REQUIRED**로 반려했습니다. 서버 가시
`kind` 컬럼의 등급 어휘는 개인 HRK 통증 단계(`mild`/`moderate`/`severe`)를 1:1로
재서술하며, 어떤 canonical 문서도 이를 승인하지 않았기 때문입니다. 현재 파일은 반려
사유를 반영해 `feeling_unwell` 하나만 추가합니다.

`get_partner_cycle_projection()`은 손대지 않았습니다. projection은 토글이 켜져 있는 동안
계속 보이는 **상시 창**이고, 그 RPC는 소유자의 원본 테이블을 SECURITY DEFINER로 읽습니다.
이 신호를 거기에 넣었다면 RPC가 `cycle_daily_logs`를 직접 읽어야 했고, 그것이 이 기능에서
절대 만들면 안 되는 결합입니다.

`cycle_support_signals`는 014부터 이미 맞는 모양이었습니다. 한 행 = 한 번의 의도적 행위,
`shared_for_date`는 소유자가 고르고, `expires_at`은 하루, `revoked_at`으로 철회. 그래서
**어휘 한 값만 넓혔습니다.**

`cyclePartnerMessage.ts`의 withholding 문장 "증상, 출혈량, 통증, 기분, 메모는 어떤
경우에도 보이지 않아요"는 **그대로 참**입니다. `feeling_unwell`은 기록된 통증 값이
아니고, 등급이 없으며, 개인 기록에서 파생되지 않는 독립 opt-in 신호이기 때문입니다.

## 039 가 고치는 것 — 032 단독 적용은 `daily_records` 를 쓸 수 없게 만든다 (2026-08-14)

**032 를 아직 어디에도 적용하지 않았다는 사실이 이 결함을 지금까지 무해하게
유지했습니다.** 적용했다면 즉시 전면 장애였습니다.

`enforce_e2ee_write_floor()` 에는 `SECURITY DEFINER` 가 없어서 **호출자 권한**으로
실행됩니다. 그 함수의 첫 문장은 `e2ee_floor_for()` 호출인데, 이 함수는
`authenticated` 에게서 EXECUTE 가 회수되어 있습니다(032:71 — 임의의 user id 를 받는
함수이므로 회수 자체는 올바릅니다). 결과:

```
ERROR 42501: permission denied for function e2ee_floor_for
CONTEXT: PL/pgSQL function enforce_e2ee_write_floor() line 5 at assignment
```

floor 조회는 어떤 분기보다 **먼저** 실행되므로 암호화 쓰기만이 아니라 **평문
INSERT/UPDATE 까지 전부** 실패합니다. 즉 032 를 적용한 순간부터 아무도 기록을
저장할 수 없습니다.

왜 놓쳤는가: `scripts/e2ee/p0-harness.mjs` 는 키 테이블과 RPC 를 실제 액터로
검증하지만 **`daily_records` 에 행을 한 번도 쓰지 않습니다.** 트리거가 실제
`authenticated` 세션에서 실행된 적이 없었습니다. 027 과 같은 종류의 실패입니다 —
plpgsql 은 함수를 만들 때 본문을 검증하지 않으므로 032 는 아무 오류 없이 적용되고,
실제로 호출되는 순간에만 터집니다.

039 는 `ALTER FUNCTION public.enforce_e2ee_write_floor() SECURITY DEFINER;` 로
속성만 바꿉니다. **본문을 다시 선언하지 않습니다** — 그러면 032 와 039 에 규칙이
두 벌 생기고 나중에 실행된 쪽이 이기므로, 이후 032 를 고쳐도 조용히 무효가 됩니다.
`src/lib/migration039.test.ts` 가 이 두 가지(속성 변경 있음 / 본문 재선언 없음)를
함께 고정합니다.

## 039 가 추가하는 것 — 암호문을 담을 곳 (2026-08-14)

032 는 암호화된 행의 `log_text`·`reaction`·`attachments`·`emotion_flow`·
`record_time` 을 전부 금지하면서 **암호문을 담을 컬럼을 추가하지 않았습니다.**
따라서 032 만으로는 암호화된 행을 실질적으로 쓸 수 없습니다.

039 는 `content_envelope BYTEA` 하나를 추가합니다. 필드마다 봉투를 따로 두지 않는
이유는 그러면 행마다 92바이트 헤더와 wrapped DEK 가 5개씩 붙는 데다, **한 기록 안에서
domain 이나 epoch 를 섞어 쓸 수 있게** 되기 때문입니다. 다섯 필드를 하나의 정규
JSON 문서로 직렬화해 한 번 봉인합니다(`src/crypto/recordContent.ts`).

클라이언트가 보낸 `key_domain`·`key_epoch` 는 **증거로 취급하지 않습니다.** 같은
클라이언트가 봉투도 보냈으므로 두 값이 서로 맞는다는 것 이상을 증명하지 못합니다.
039 는 봉투 헤더에서 domain(offset 7)과 epoch(offset 12, big-endian u64)를 직접 읽어
라우팅 컬럼과 대조합니다. 이것이 막는 구체적 공격: **PMK 로 봉인한 암호문을
`key_domain = 'couple'` 로 선언하기** — 032 의 모든 검사를 통과하고 파트너는 영원히
열 수 없는 행을 받게 됩니다.

남는 한계는 정직하게 기록합니다. 헤더와 라우팅 컬럼이 **서로 일치하도록** 위조한
봉투는 서버가 받아들이며, 그 행은 **복호화에 실패**합니다(GLE1 AAD 가 owner·scope·
object·revision 을 묶으므로). 서버가 기계적으로 강제할 수 있는 것만 서버에서
강제하고, 나머지는 AEAD 가 잡습니다.

운영 적용 순서는 **032 → 039 를 한 배포 단위로** 다뤄야 합니다. 032 만 적용하면 위의
전면 장애가 발생합니다.
| `033_rollback_e2ee_key_foundation.sql.disabled` | 031 + 032 + 034 전체 롤백. **번호는 순서를 뜻하지 않습니다** — 정방향은 031 → 032 → 034이고 이 파일은 `.disabled`라 실행 순서에 들어가지 않습니다. E2EE가 활성화된 흔적이 하나라도 있으면 트랜잭션 전체를 중단합니다. | **롤백 전용 / 실행되지 않음** |

## 029 가 보완하는 것 — sole-member couple 개인정보 정리 (2026-08-11)

`couples`는 Auth 외래 키가 없고 `anniversary_date`를 보유합니다. 따라서 계정 삭제가
사용자의 `couple_members`를 cascade 삭제해도, 한 번도 연결되지 않았거나 유일한
멤버였던 couple row는 orphan으로 남습니다.

029는 service-role 전용 `cleanup_account_solo_couples(uuid)`를 추가합니다. 다른
membership row가 하나라도 있으면 상태가 active/pending/disconnected인지와 무관하게
보존하므로 현재·대기·과거 파트너 데이터는 삭제하지 않습니다. Edge Function은
`prepare_account_deletion` 성공 뒤, Auth 삭제 전에 이 RPC를 호출합니다.

운영 적용 순서는 **029 migration → 갱신된 delete-account 배포**입니다. rollback은
반대로 **이전 Edge Function 배포 → RPC 제거** 순서여야 합니다.

## 028 이 복원하는 것 — Storage SELECT/DELETE (2026-08-11)

운영 catalog 재검증 결과 `couple-media`는 private이고 객체는 0개였지만,
`storage.objects`에는 migration 015의 INSERT 정책 하나만 존재했습니다. 저장소의
007 파일에 SELECT/DELETE가 있다는 사실은 운영 적용 증거가 아니므로, 028이 현재
필요한 최종 정책 3개를 forward migration으로 다시 정의합니다.

- 작성자: 자신의 record에 upload/read/delete
- 활성 파트너: shared record media read only
- private media, unrelated user, former partner, anon: read 불가
- partner UPDATE/DELETE: 불가
- 모든 허용 경로: `{couple_id}/{record_id}/{filename}`와 실제 `daily_records` row,
  owner, active couple을 함께 검증

운영 적용 전 스테이징에서 A/B/C 계정과 실제 객체로 검증해야 합니다. 특히 policy
catalog가 맞다는 것과 signed URL이 실제로 발급·거부된다는 것은 별도 증거입니다.

안전한 rollback은 bucket을 private으로 유지한 채 SELECT만 owner-only로 축소하는
것입니다. `public=true`, `USING (true)`, SELECT/DELETE 전체 제거로 되돌리지 않습니다.

## 027 이 고치는 것 — 계정 삭제 전면 장애 (2026-08-11)

024 는 `cycle_support_signals` 를 `user_id` 로 삭제했습니다. 그 테이블의 소유자
컬럼은 `owner_id` 입니다.

plpgsql 은 함수를 만들 때 본문의 SQL 을 검증하지 않으므로 024 는 **아무 오류 없이
적용됐고**, 실제로 호출되는 순간에만 터졌습니다.

```
ERROR 42703: column "user_id" does not exist
CONTEXT: PL/pgSQL function prepare_account_deletion(uuid,uuid[])
```

`prepare_account_deletion` 은 계정 삭제 트랜잭션의 유일한 DB 단계입니다. 즉
024 가 적용된 동안 **아무도 계정을 삭제할 수 없었습니다.** 원격 DB 에서 직접
재현해 확인했습니다.

왜 놓쳤는가: 024 의 테스트는 SQL 텍스트에
`DELETE FROM public.<table> WHERE user_id = p_user_id` 가 있는지만 확인했습니다.
틀린 컬럼을 옳은 컬럼과 똑같은 확신으로 검사한 것입니다.

`src/lib/migration027.test.ts` 는 이제 삭제문의 컬럼명을 **스키마 기준으로**
검증합니다 (해당 테이블의 `CREATE TABLE` / `ALTER TABLE ADD COLUMN` 을 읽어
대조). 컬럼명을 다시 `user_id` 로 되돌리면 3개 테스트가 실패하는 것을 확인했습니다.

전수 검사 결과, 삭제 함수가 참조하는 테이블 중 소유자 컬럼이 `owner_id` 인 것은
`cycle_support_signals` 하나뿐이고 나머지는 모두 `user_id` 가 맞습니다.

**적용 후 확인 (2026-08-11).** service_role 로 실제 호출한 결과:

```json
{"ok": true, "records_deleted": 3, "cycle_periods_deleted": 2,
 "cycle_daily_logs_deleted": 4, "cycle_entries_deleted": 5,
 "cycle_settings_deleted": 1, "cycle_sharing_preferences_deleted": 1,
 "cycle_support_signals_deleted": 1, "sensitive_consents_deleted": 1,
 "legacy_cycle_backup_deleted": 5, "trips_transferred": 1,
 "shared_events_transferred": 1}
```

검증은 트랜잭션 안에서 실행하고 롤백했으므로 실제 데이터는 그대로입니다.

## 025 가 하는 일 (2026-08-11)

022 가 `cycle_sharing_preferences` 를 만들고 앱에 공유 토글 3개가 있었지만,
**파트너가 그 정보를 볼 경로가 존재하지 않았습니다.** 토글을 켜면 DB 행은 저장되고
아무것도 전달되지 않았습니다. 원본 테이블은 소유자 전용 RLS 라서 파트너가 읽을 수
없고 그것은 옳지만, 그 사이를 잇는 sanitized projection 이 없었습니다.

025 가 두 함수를 추가합니다.

- `cycle_prediction_window(uuid)` — 내부 helper. 소유자 한 명의 다음 예상 범위를
  서버에서 계산합니다. 임의의 `owner_id` 를 받으므로 **어떤 클라이언트 역할에도
  EXECUTE 를 주지 않습니다.**
- `get_partner_cycle_projection()` — 파트너용. `authenticated` 만 실행할 수 있고,
  요청자의 active couple 과 상대의 active 멤버십을 검증한 뒤, 상대가 직접 켠
  항목만 불리언과 날짜 범위로 돌려줍니다.

반환하지 않는 것: period/daily log id, 증상, 출혈량, 통증, 기분, 메모,
실제 생리 시작일·종료일, 평균 주기 설정값.

예측 규칙은 `src/lib/cyclePrediction.ts` 의 `predictCycle()` 과 같습니다
(최근 12개 간격, 15~60일 밖 제외, 3개 이상이면 중앙값, 폭은 min(변동폭, 3),
1~2개면 ±2일 고정). 두 구현이 어긋나면 커플이 서로 다른 날짜를 보게 되므로
`src/lib/partnerCycleProjection.test.ts` 가 일치를 고정합니다.

**적용 후 확인 (2026-08-11).**

- 공유 전부 OFF → 파트너 호출 결과 모든 필드 `false` / `NULL`
- 공유 전부 ON → `2026-09-20 ~ 2026-09-24`. 소유자 화면의 "9월 20일 ~ 9월 24일"
  과 정확히 일치
- 파트너 UUID 로 `cycle_periods`, `cycle_daily_logs`, `cycle_settings`,
  `cycle_sharing_preferences`, `user_sensitive_consents`,
  `legacy_cycle_entries_backup` 직접 SELECT → 6개 모두 0행

## 026 이 고치는 것 (2026-08-11)

025 는 공유 토글만 확인했습니다. 그래서 소유자가 **민감정보 동의를 철회한 뒤에도**
켜져 있던 토글이 남아 파트너에게 계속 정보가 전달됐습니다. 운영 DB 에서 직접
확인했습니다: `user_sensitive_consents.revoked_at` 을 채운 뒤에도 파트너 호출이
`has_prediction_window = true` 와 `2026-09-20` 을 반환했습니다.

026 은 projection 이 공유 설정을 읽기 **전에** 상대의 동의 철회 여부를 확인하고,
철회된 경우 모든 필드가 false 인 행만 돌려줍니다.

동의 *버전*은 검사하지 않습니다. 버전이 올라가 재동의가 필요한 상태는 소유자에게
다시 묻는 문제이고, 그 사이에 이미 켜 둔 공유를 조용히 끄는 것은 소유자가
의도하지 않은 변화입니다. 명시적 철회만 공유를 멈춥니다.

클라이언트도 같은 규칙을 지킵니다. 철회 시 공유 토글을 먼저 끄고 그 쓰기가
성공한 뒤에 철회를 실행하므로, 어디서 실패하든 더 엄격한 상태가 남습니다
(`src/components/cycleV3DataPath.test.tsx` 의 `revoking consent also stops
partner sharing`).

**적용 후 확인 (2026-08-11).**

- 동의 유효 + 전부 ON → `true / true / 2026-09-20`
- 동의 철회 + 전부 ON → `false / false / NULL / false`

## 022~024 원격 적용 기록 (2026-08-11)

세 파일 모두 Supabase 대시보드 SQL Editor 에서 실행하고 결과를 직접 확인했습니다.

**적용 전 상태.** `cycle_periods`, `cycle_daily_logs`, `cycle_sharing_preferences`,
`user_sensitive_consents` 네 테이블이 모두 없었고, PostgREST 는 `404 / PGRST205`
(`Could not find the table ... in the schema cache`) 를 반환했습니다. 그래서 앱의
"내 몸의 리듬" 은 기록을 불러오지 못했습니다.

**적용 후 확인.**

- 네 테이블 모두 존재하고, anon 키 요청은 `401 / 42501` (권한 없음) 로 막힙니다.
  `PGRST205` 는 더 이상 나오지 않습니다.
- legacy 이관 결과: `legacy_cycle_entries_backup` 5행(원본 전량 보존),
  `cycle_periods` 2행, `cycle_daily_logs` 4행. 삭제된 데이터는 없습니다.
- RLS 확인: `request.jwt.claims.sub` 를 소유자로 설정하면 자기 데이터가 보이고,
  다른 UUID 로 설정하면 세 테이블 모두 0행입니다.

**022 에서 발견한 결함 두 가지 (023·024 가 고칩니다).**

1. 022 의 `CREATE TABLE ... AS SELECT` 는 원본의 RLS 나 GRANT 를 물려받지 않습니다.
   그 결과 `legacy_cycle_entries_backup` 이 RLS 없이 만들어져, **anon 키로도 전체
   행을 읽을 수 있었습니다** (적용 직후 `200` + 다른 사용자의 생리 기록 확인).
   023 이 RLS 를 켜고 anon 권한을 회수합니다.
2. 같은 이유로 이 백업 테이블에는 `auth.users` 외래 키가 없어 **Auth 삭제
   cascade 가 닿지 않습니다.** 또한 `prepare_account_deletion` 이 주기 테이블을
   전혀 지우지 않았습니다. 024 가 두 문제를 함께 고치고, 지운 건수를 반환값에
   추가합니다.

> 신규 프로젝트에 022 를 적용할 때는 **023 을 반드시 함께 적용**하세요.
> 022 단독 적용은 위 1번 유출 상태를 만듭니다.

### 원격 상태 감사 결과 (같은 시점)

앱이 실제로 사용하는 테이블·RPC 를 전수 대조한 결과, 아래는 모두 존재합니다.

- 테이블: `profiles`, `couples`, `couple_members`, `couple_tasks`,
  `invitation_codes`, `daily_records`, `briefings`, `events`, `trips`,
  `trip_items`, `trip_checklists`, `contact_preferences`,
  `account_deletion_requests`, `collaboration_invalidations`,
  `cycle_settings`, `cycle_entries`, `cycle_support_signals`,
  `cycle_periods`, `cycle_daily_logs`, `cycle_sharing_preferences`,
  `user_sensitive_consents`
- RPC: `get_my_active_couple_id`, `get_my_couple_state`, `get_partner_profile`,
  `create_couple_and_invitation`, `redeem_invitation`, `regenerate_invitation`,
  `disconnect_couple`, `reorder_trip_items`, `begin_account_deletion`,
  `cancel_account_deletion`, `prepare_account_deletion`

**018·019 는 여전히 원격 미적용입니다** (`shared_tasks`, `trip_places`,
`trip_items.opening_hours`, `trip_items.visit_time`, `call_topics`,
`events.show_in_call_topics` 부재 확인). 다만 이 객체들을 참조하는 클라이언트
코드가 없어 (`src/` 전체 검색 결과 테스트 파일만 참조) 현재 사용자 기능에는
영향이 없습니다. 해당 기능을 실제로 구현할 때 함께 적용하세요.

## 002 번호 중복 (이름을 바꾸지 않는 이유)

`002_fix_rls_and_rpc.sql` 와 `002_fix_rls_recursion.sql` 는 번호가 같습니다.
**둘 다 이미 원격에 적용되었으므로 파일 이름을 바꾸지 않습니다** — 이름을 바꾸면
마이그레이션 이력과 실제 DB 상태가 어긋납니다.

- 적용 순서는 파일 이름 전체의 사전순입니다. 즉 `_and_rpc` → `_recursion`.
- **신규 프로젝트에서 위 순서로 그대로 실행하면 002 단계에서 실패합니다.**
  `_recursion` 이 `Users can create couples` 등의 정책을 `DROP POLICY IF EXISTS`
  없이 다시 만들기 때문에 `policy already exists` 오류가 납니다.
  → 신규 프로젝트에서는 `_recursion` 의 `CREATE POLICY` 앞에 해당 정책을 먼저
  `DROP POLICY IF EXISTS` 로 지운 뒤 실행하세요. 두 파일이 만든 정책은 이후
  `005_secure_rls_policies.sql` 와 `009_remote_core_security_hotfix.sql` 가 다시
  정의하므로, 최종 상태는 순서와 무관하게 같습니다.
- 새 마이그레이션은 반드시 새 번호를 쓰세요. 이 규칙은
  `src/lib/migrationSecurityContracts.test.ts` 가 검사합니다 (017 이후 번호 중복 금지).

## 017이 하는 일

1. **`get_partner_profile()` 하드닝.** 트리 안에서 유일하게 `search_path` 에
   `pg_temp` 가 없던 SECURITY DEFINER 함수입니다(`001:278-282` 에서 한 번 만들어진 뒤
   재정의된 적이 없고, 009·010 은 권한만 바꿨습니다). 시그니처와 반환 컬럼은 001과
   **완전히 동일**하며 동작도 그대로입니다. 권한은 `authenticated` 만
   `EXECUTE` 합니다.
2. **PostgREST 스키마 캐시 리로드.** 이 저장소의 어떤 마이그레이션도
   `NOTIFY pgrst, 'reload schema'` 를 실행하지 않았습니다(016:52 는 주석입니다).
   013~016 이 만든/바꾼 함수 시그니처는 모두 사람이 대시보드에서 리로드해 주기를
   기다렸고, 그 사이 클라이언트는 `PGRST202` 를 받습니다. 017 은 트랜잭션 안에서
   `NOTIFY` 를 실행하므로(알림은 COMMIT 시 전달됩니다) 롤백된 적용이 캐시를
   리로드시키는 일은 없습니다. 리로드 한 번이 캐시 전체를 갱신합니다.

017 은 재실행해도 no-op 입니다(정확한 시그니처로 `DROP FUNCTION IF EXISTS` → 동일한
정의로 재생성 → 동일한 권한 재적용). 롤백 블록은 파일 하단에 주석으로 있습니다.
**아직 원격에 적용되지 않았습니다.**

> 013·014·015 는 테스트 Supabase 프로젝트에 수동으로 적용되었고 PostgREST 스키마
> 캐시도 리로드되었습니다. 013 적용 중
> `cannot change return type of existing function redeem_invitation(text)` 오류가
> 발생해, 해당 함수를 정확한 시그니처로 DROP 한 뒤 013~015 를 다시 실행하여
> 해결했습니다. 재발 방지 규칙은 아래 "함수 반환형 변경 규칙" 에 있습니다.
> **016 은 아직 어디에도 적용되지 않았습니다.**

## 013이 하는 일

1. **초대코드 무차별 대입 방어**
   초대코드는 숫자 6자리(100만 가지)이고 24시간 동안 유효합니다. 기존
   `consume_invitation` 에는 시도 횟수 제한이 없어서, 로그인한 사용자라면 누구나
   전체 조합을 대입해 **남의 커플 공간에 들어갈 수 있었습니다.**
   → 10분에 5회, 24시간에 20회 실패로 제한합니다.
   (앱 안에도 같은 제한이 있지만, 그것은 RPC를 직접 호출하면 우회되므로
   서버 쪽 제한이 실제 방어선입니다.)

2. **초대코드 재발급**
   서버에는 코드의 해시만 저장합니다. 그래서 코드를 만든 사람이 브라우저 저장소를
   지우면 코드를 되살릴 방법이 없고, "한 사람은 하나의 활성 커플만" 제약 때문에
   새 공간도 만들 수 없어 **막다른 길**이 됩니다.
   → `regenerate_invitation` 으로 새 코드를 발급하고 이전 코드는 무효화합니다.

3. **`invitation_codes` 읽기 권한 제거**
   앱은 이 테이블을 직접 읽을 필요가 없습니다(모든 변경은 SECURITY DEFINER 함수
   안에서 일어납니다). 읽기를 막아 해시 탐색과 타 커플 메타데이터 조회를 차단합니다.

### 013·015 적용 전에는 초대 연결이 동작하지 않습니다 (의도된 동작)

예전 클라이언트는 `redeem_invitation` 이 없으면 `consume_invitation` 으로
되돌아갔습니다. 그 fallback은 **제거했습니다.** `consume_invitation` 에는 시도
횟수 제한이 없어서, fallback이 남아 있으면 013이 막으려는 무차별 대입을 그대로
다시 열어주기 때문입니다.

이제 클라이언트는 015의 `{ok, couple_id, error_code}` 형태만 받아들이고, 함수가
없거나(`PGRST202`) 예전의 UUID 반환 형태이면 **연결을 거부하고** "서버에 안전한
초대 코드 확인 기능이 아직 배포되지 않았습니다" 를 보여줍니다.

즉 015 배포는 초대 기능의 **선행 조건**입니다. 나머지 화면(기록·일정·여행·주기)은
015 없이도 동작합니다.

## 014가 하는 일

1. **일정 프라이버시**: 비공개는 작성자만, 공유는 현재 활성 커플만 SELECT.
   INSERT/UPDATE/DELETE는 작성자와 활성 workspace를 operation별 정책으로 검사하고
   event 식별자 변경은 트리거로 금지합니다.
2. **공동 여행**: 활성 커플 양쪽이 parent/child를 공동 편집합니다. child 날짜는
   parent row를 잠근 뒤 범위를 검사하고, 순서는 `reorder_trip_items(UUID[], INTEGER[])`
   RPC에서 한 트랜잭션으로 변경합니다.
3. **개인 주기**: `cycle_entries`와 `cycle_settings`는 owner-only이며 Realtime
   publication에서 명시적으로 제거합니다.
4. **최소 배려 공유**: 별도 `cycle_support_signals`만 사용합니다. 사용자가 고른
   비의료 enum + 선택 80자 메시지이며 한국 기준 당일, 최대 24시간, one-way revoke,
   한 owner/couple/date당 active 1개를 강제합니다.
5. **안전한 무효화**: `collaboration_invalidations`에는 민감 본문 없이 couple/slice/time만
   저장해 공유→비공개·철회 시 파트너가 RLS 기준으로 다시 조회합니다.
6. **연결 해제 복구**: `couple_members`, trip children, support, invalidation을 Realtime에
   추가합니다. raw cycle은 추가하지 않습니다.

## 015가 하는 일

1. **초대 우회 차단**: `consume_invitation` 의 `authenticated` 실행 권한을 회수합니다.
   013이 만든 제한은 `redeem_invitation` 안에만 있었기 때문에, 클라이언트가
   `consume_invitation` 을 직접 호출하면 제한이 통째로 우회됐습니다.
2. **실패 기록이 사라지지 않게**: 예전 `redeem_invitation` 은 실패를 기록한 뒤
   `RAISE` 로 예외를 던졌고, 그러면 **같은 트랜잭션의 기록도 함께 롤백**됐습니다.
   → 예상된 실패는 예외 대신 `error_code` 로 반환합니다(반환형이 `JSONB` 로 바뀜).
   시도 횟수 초과(`rate_limited`)처럼 코드를 조회하기도 전에 결정되는 결과는
   횟수에 포함하지 않습니다. 포함하면 재시도하는 클라이언트가 자기 잠금을
   무한히 연장했습니다. "이미 2명" 도 `invalid_or_expired` 로 합칩니다. 구분해서
   알려주면 추측한 해시가 살아 있는 초대와 맞았다는 사실을 알려주게 됩니다.
3. **경합 차단**: 초대 사용·재발급·연결 해제·계정 삭제가 모두 `couples` 부모 row를
   먼저 잠그고, 잠금을 기다린 뒤 멤버십을 다시 확인합니다. 연결 해제와 초대 사용이
   겹칠 때 한쪽만 활성으로 남는 문제를 막습니다.
4. **계정 삭제**: `begin/prepare/cancel_account_deletion` (service_role 전용)으로
   미디어 정리 → 트랜잭션 정리 → auth 삭제 순서를 강제합니다. 공유 일정·여행은
   **활성 파트너에게만** 넘기고, 남은 사람이 없으면 명시적으로 삭제합니다.
   (예전에는 이미 연결이 끊긴 상대에게 넘겨서, 아무도 읽을 수 없는 데이터가
   영구히 남았습니다.)
5. **비공개 일정 알림 차단**: 무효화 트리거를 공유 일정 변화로 제한하고,
   **`public.events` 를 Realtime publication에서 제거합니다.** Realtime은 DELETE
   payload에 RLS를 적용하지 않아서, 트리거만 고쳐도 파트너는 "상대가 방금 비공개
   일정을 지웠다"는 타이밍을 계속 알 수 있었습니다.
6. **여행 정합성**: `url` 은 DB에서 `http(s)` 만 허용하고, 항목 순서는 하루 단위
   유니크 제약 + `reorder_trip_items` 의 permutation 검증으로 고정합니다.
7. **Storage 경로 고정**: `{couple_id}/{record_id}/{파일명}` 3단만 허용합니다.
   더 깊은 이름을 허용하면 Storage가 그 중간 단계를 "폴더"로 보고하고
   `remove()` 가 조용히 무시해서, 계정 삭제 시 폴더를 비울 수 없었습니다.

## 적용 순서 (사람이 직접)

```
1. Supabase 대시보드 → Database → Backups 에서 백업 생성
2. 스테이징 프로젝트에서 013 실행 후 아래 013 검증
3. 스테이징 프로젝트에서 014 실행 후 배포 체크리스트의 014 검증
4. 스테이징 프로젝트에서 015 실행 후 아래 015 검증
5. Supabase 대시보드 → Settings → API → "Reload schema cache" 실행
   (015가 redeem_invitation 의 반환형을 바꾸므로 PostgREST가 새 형태를
    인식해야 합니다. 이 단계를 빼면 클라이언트가 fail closed 로 거부합니다.)
6. `supabase functions deploy delete-account` (015 이후에)
7. `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md`의 A/B/C 테스트 통과
8. 운영 프로젝트에 013 → 014 → 015 순서로 실행하고 5~6단계를 반복
9. 운영에서 초대/일정/여행/주기/연결 해제/계정 삭제 흐름 재확인
```

> ⚠️ 015는 `trip_items.url` 에 `http(s)` 가 아닌 값이 하나라도 있으면 **전체가
> 취소됩니다** (의도된 동작 — 데이터를 조용히 버리지 않습니다). 실행 전에 파일
> 안의 탐지 쿼리를 먼저 돌려 해당 행을 정리하세요.

실행 방법: Supabase 대시보드 → **SQL Editor** → 파일 내용 전체 붙여넣기 → Run.
파일은 `BEGIN; ... COMMIT;` 으로 감싸져 있어 중간에 실패하면 전체가 취소됩니다.

## 013 검증 쿼리

```sql
-- 1. 함수가 생성되었는지
SELECT proname FROM pg_proc
WHERE proname IN ('redeem_invitation','regenerate_invitation','prune_invitation_attempts');
-- 3개 행이 나와야 합니다.

-- 2. anon 역할이 실행할 수 없는지 (결과가 false 여야 합니다)
SELECT has_function_privilege('anon', 'public.redeem_invitation(text)', 'EXECUTE');
SELECT has_function_privilege('anon', 'public.regenerate_invitation(text)', 'EXECUTE');

-- 3. authenticated 역할은 실행할 수 있는지 (true 여야 합니다)
SELECT has_function_privilege('authenticated', 'public.redeem_invitation(text)', 'EXECUTE');

-- 4. invitation_codes 직접 읽기가 막혔는지 (false 여야 합니다)
SELECT has_table_privilege('authenticated', 'public.invitation_codes', 'SELECT');

-- 5. 시도 기록 테이블에 클라이언트가 접근할 수 없는지 (모두 false)
SELECT has_table_privilege('authenticated', 'public.invitation_attempts', 'SELECT');
SELECT has_table_privilege('authenticated', 'public.invitation_attempts', 'INSERT');
```

## 015 검증 쿼리

```sql
-- 1. consume_invitation 우회 경로가 닫혔는지 (false 여야 합니다)
SELECT has_function_privilege('authenticated', 'public.consume_invitation(text)', 'EXECUTE');

-- 2. redeem_invitation 이 JSONB 를 반환하는지 ('jsonb' 여야 합니다)
SELECT pg_catalog.format_type(prorettype, NULL)
FROM pg_proc WHERE proname = 'redeem_invitation';

-- 3. 계정 삭제 RPC 는 service_role 만 (authenticated 는 모두 false)
SELECT has_function_privilege('authenticated', 'public.begin_account_deletion(uuid,uuid[])', 'EXECUTE');
SELECT has_function_privilege('authenticated', 'public.prepare_account_deletion(uuid,uuid[])', 'EXECUTE');
SELECT has_function_privilege('authenticated', 'public.cancel_account_deletion(uuid)', 'EXECUTE');

-- 4. events 가 Realtime publication 에서 빠졌는지 (0 행이어야 합니다)
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events';

-- 5. 무효화 채널은 남아 있어야 합니다 (1 행)
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  AND tablename = 'collaboration_invalidations';

-- 6. 원본 주기 기록은 여전히 publication 밖 (0 행)
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  AND tablename IN ('cycle_entries','cycle_settings');

-- 7. 제약/인덱스가 생성되었는지 (3 행)
SELECT conname FROM pg_constraint
WHERE conname IN ('trip_items_http_url_check','trip_items_unique_day_order');
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_invitation_codes_one_unused_hash';

-- 8. 사용되지 않은 초대 해시가 하나뿐인지 (모든 행의 count 가 1)
SELECT code_hash, count(*) FROM public.invitation_codes
WHERE used = false GROUP BY code_hash HAVING count(*) > 1;
-- 0 행이어야 합니다.
```

### 스테이징에서 반드시 사람이 확인할 것

정적 분석으로는 판단할 수 없어 실제 프로젝트에서만 확인 가능한 항목입니다.

- `begin_account_deletion` 의 `LOCK TABLE storage.objects IN SHARE MODE` 가
  권한 오류(`42501`) 없이 통과하는지. 이 테이블은 `supabase_storage_admin`
  소유이고, 잠금이 유지되는 동안 프로젝트 전체 Storage 메타데이터 쓰기가 대기합니다.
- 비공개 일정을 A가 삭제할 때 B의 채널이 반응하지 **않는지** (4번 쿼리와 짝).
- `reorder_trip_items` 로 같은 날 두 항목의 순서를 바꿀 때 유니크 제약 위반이
  나지 않는지 (`DEFERRABLE` + `SET CONSTRAINTS ... DEFERRED` 동작 확인).
- 제목만 수정하는 저장이 `Trip item order must be changed through
  reorder_trip_items` 없이 성공하는지.
- 계정 삭제 후 상대의 공유 일정·여행이 남아 있고 열람 가능한지.

## 014 롤백 주의

014는 새 테이블·column·정책·publication을 함께 변경하므로 먼저 백업으로 복원하는
방법을 우선합니다. 수동 롤백은 migration 파일 하단 순서대로 5개 Realtime 항목,
`collaboration_invalidations`/`cycle_support_signals`, 관련 함수·트리거,
`cycle_entries.symptoms`, event/trip 정책 순으로 처리합니다.

- `event_type='date'` 행을 변환하기 전에 예전 constraint를 복원하지 마세요.
- support/invalidation 테이블 삭제 전 필요한 감사 데이터를 백업하세요.
- 원격 적용·롤백 모두 아직 실행되지 않았습니다.

## 015 롤백 주의

상세 순서는 `015_security_followup.sql` 파일 하단에 있습니다. 특히:

- **`consume_invitation` 의 `authenticated` 실행 권한은 되돌리지 마세요.**
  그 회수를 롤백하면 초대코드 시도 제한 우회가 다시 열립니다.
- 015를 되돌리면 클라이언트도 함께 되돌려야 합니다. 현재 클라이언트는 015의
  `JSONB` 형태만 받아들이고 예전 형태는 거부합니다.
- 순서 정규화와 모호한 초대코드 무효화는 데이터 변경이라 되돌아가지 않습니다.
- `public.events` 를 publication 에 다시 넣으면 비공개 일정 삭제 타이밍 유출도
  함께 돌아옵니다.

## 016이 하는 일

`016_couple_state_visibility.sql` 은 **추가만 하는(additive) 읽기 전용
마이그레이션**입니다. 기존 테이블·정책·권한·publication 은 하나도 건드리지
않습니다.

추가되는 것: `public.get_my_couple_state()` (`RETURNS JSONB`, `STABLE`,
`SECURITY DEFINER`, `authenticated` 에만 `EXECUTE`).

**왜 필요한가.** 013 §6 이 `invitation_codes` 의 클라이언트 `SELECT` 를 모두
회수했습니다(그 자체로는 올바른 조치입니다 — 해시 probing 을 막습니다). 그 결과
클라이언트가 아래 세 가지를 전혀 구분할 수 없게 되었습니다.

- 공간을 만들고 상대를 기다리는 중 (pending, 코드 유효)
- 초대 코드가 만료됨 (pending, 코드 만료)
- 커플 공간이 아예 없음 (personal)

그래서 초대 코드를 들고 있는 생성자에게 "초대 코드를 입력하세요" 라는 안내가
표시되었습니다. `redeem_invitation` 이 `self_invitation` 으로 거부하는 바로 그
행동입니다.

**반환하지 않는 것.** 초대 코드 평문도, `code_hash` 도 절대 반환하지 않습니다.
반환값은 `couple_id`, `role`, `member_status`, `partner_present`(불리언),
`invitation_active`(불리언), `invitation_expires_at` 뿐입니다. 파라미터가 없으므로
다른 사용자의 상태를 요청할 수단 자체가 없습니다.

**적용 상태: 원격에 아직 적용되지 않았습니다.** 적용 절차는
`docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` §2-6 을 따르세요. 적용 후
**PostgREST 스키마 캐시 리로드가 필수**입니다. 리로드하지 않으면 RPC 가
`PGRST202` 를 반환하고, 클라이언트는 이를 "서버에 기능이 배포되지 않음" 으로
표시합니다(커플 공간이 없다고 잘못 표시하지 않습니다).

### 함수 반환형 변경 규칙 (013 원격 실패에서 배운 것)

013 을 원격에 적용할 때 다음 오류가 발생했습니다.

```
cannot change return type of existing function redeem_invitation(text)
```

`CREATE OR REPLACE FUNCTION` 은 반환형을 바꿀 수 없습니다. 015 는
`DROP FUNCTION IF EXISTS public.redeem_invitation(TEXT);` 로 이미 이 문제를
해결했고, **016 이후 모든 마이그레이션은 정의하는 모든 함수에 대해 정확한 시그니처로
`DROP FUNCTION IF EXISTS` 를 먼저 실행합니다.** 이 규칙은
`src/lib/migration016.test.ts` 가 자동으로 검사합니다.

## 정리 작업 (선택)

`invitation_attempts` 는 계속 쌓입니다. Supabase 대시보드의
**Database → Cron** 에서 하루 한 번 정리하도록 등록할 수 있습니다.

```sql
SELECT cron.schedule('prune-invitation-attempts', '0 4 * * *',
  $$SELECT public.prune_invitation_attempts()$$);
```

## Edge Function

`supabase/functions/delete-account` 는 마이그레이션이 아니라 별도 배포입니다.

```
supabase functions deploy delete-account
```

배포 전에 `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` 를 확인하세요.
이 함수는 서비스 롤 키를 사용하므로 `SUPABASE_SERVICE_ROLE_KEY` 가 함수 환경변수로
설정되어 있어야 합니다.
## 019 — 통화 주제·여행 시간표

`019_call_topics_and_trip_timetable.sql`은 기록·일정·여행 장소에 `통화 때 꼭 얘기` 표시를 추가하고,
여행 장소에 방문 시간을 저장합니다. 018까지 적용한 뒤 Supabase SQL Editor에서 실행하세요.

## 022 — V3 cycle tables
`022_cycle_v3_schema.sql`은 생리 기간(`cycle_periods`), 일별 컨디션(`cycle_daily_logs`), 민감정보 동의(`user_sensitive_consents`), 공유 옵션(`cycle_sharing_preferences`) 테이블을 생성하고 legacy 데이터를 안전하게 이관합니다. (신규 / 원격 적용 미확인)

## 057–061 원격 상태 확인 및 적용 순서 (2026-08-24 / 2026-08-25)

- `057_profile_identity_and_caption.sql`, `058_couple_highlights.sql`,
  `059_partner_managed_username.sql`, `060_partner_username_projection.sql`,
  `061_reject_null_partner_profile_actor.sql`은 저장소에 존재하며 fresh-chain
  계약에서 검증됩니다. 060/061에는 실제 A/B/C/anon actor probe도 포함됩니다.
- 060과 061의 역할 및 순서:
  - **060 (`060_partner_username_projection.sql`)**: `get_partner_profile_with_username()`
    RPC를 생성하여 활성 파트너의 영문 username 프로젝션을 제공합니다 (authenticated 전용, fixed `search_path`).
  - **061 (`061_reject_null_partner_profile_actor.sql`)**: 060 함수에 명시적 NULL actor
    검사(`auth.uid() IS NULL`)를 추가하여 PostgREST 호출 시 익명/NULL JWT subject를
    `42501`로 fail-closed 거부하도록 보안을 강화합니다.
  - **적용 순서**: 원격 카탈로그에 057–059 대상 객체가 존재하는 상태에서, **060 적용 후
    061을 exact SQL로 순서대로 적용**하고 `NOTIFY pgrst, 'reload schema'` 및 actor
    matrix를 검증합니다.
- 원격 상태: 사후 익명 PostgREST probe에서 `profiles.username`, `profiles.profile_caption`,
  `couple_highlights`, `set_partner_username(text)`가 모두 해석되고 `401/42501`로
  익명 접근이 거부되어 057–059 대상 객체는 원격에 존재합니다. 그러나 `get_partner_profile_with_username`
  함수는 없으며, 060과 061은 원격에 **UNVERIFIED / NOT APPLIED by this agent**입니다.
- **2026-08-25 갱신 — 060/061 원격 적용 확인 (APPLIED).** 사용자가 SQL Editor로 060 → 061을
  적용했다고 보고했고, project `xzlorqsjajokrlkunxhr`(저장소 `.env`의 `VITE_SUPABASE_URL`과
  동일)에 대해 anon PostgREST probe로 독립 확인했습니다. 판정 근거는 **없는 함수와 있는
  함수의 응답이 다르다**는 점입니다.

  | probe | 응답 | 의미 |
  |---|---|---|
  | `get_partner_profile_with_username` | `401 / 42501 permission denied for function` | 함수 존재 + 스키마 캐시 반영 + anon EXECUTE 없음 |
  | `get_partner_profile` (legacy) | `401 / 42501` | 기존 함수 유지 |
  | `set_partner_username` (`p_username`) | `401 / 42501` | 059 객체 유지 |
  | `get_my_couple_state` | `401 / 42501` | 016 객체 유지 |
  | `definitely_not_a_real_function_zz` (대조군) | `404 / PGRST202 not found in the schema cache` | 미존재 함수는 다른 코드로 응답 |
  | `GET /rest/v1/profiles` | `401 / 42501 permission denied for table profiles` | 소유자 전용 SELECT 경계 유지 |

  즉 `060`이 만든 함수가 원격에 존재하며 PostgREST 스키마 캐시가 reload된 상태입니다.
  `anon`에는 EXECUTE가 없고 `profiles` 직접 읽기도 계속 차단됩니다.
  **아직 확인되지 않은 것:** 이 함수의 본문이 060판인지 061판(NULL actor를 `42501`
  예외로 명시 거부)인지는 anon 경로로 구분할 수 없습니다. 두 판 모두 anon에게는 동일한
  `permission denied`를 반환하기 때문입니다. 또한 실제 인증된 A/B/전 파트너/비관련 사용자
  actor matrix는 **UNVERIFIED**입니다. 이 두 항목은 인증 세션이 있는 검증에서 닫아야 합니다.
- CLI `supabase_migrations.schema_migrations` 추적 테이블이 비어 있으므로 `supabase db push`
  등의 일괄 배포 명령을 사용하면 안 되며, 개별 SQL을 SQL Editor에서 순서대로 적용해야 합니다.

## 062 — 두 계정 기록 보호 페어링 RPC (2026-08-26)

- `062_e2ee_pairing_ceremony_rpc.sql`은 기존 `crypto_pairings` 테이블의
  authenticated 직접 `INSERT/UPDATE/DELETE` 권한을 회수합니다.
- 대신 `auth.uid()`로 actor를 결정하는 세 RPC만 엽니다.
  - `e2ee_start_couple_pairing`: 정확히 두 명의 active 커플에서만 440-byte
    canonical transcript를 제안
  - `e2ee_confirm_couple_pairing`: 각 actor가 자신의 active device와 canonical
    low/high 확인 칸만 기록
  - `e2ee_mark_couple_pairing_active`: 두 확인과 active couple scope key가 모두
    있을 때 canonical low actor만 `CRYPTO_ACTIVE`로 전환
- fresh PostgreSQL 17에서 001→062 전체 체인과 A/B/C/anon/전 파트너
  actor matrix 362개 assertion을 실행했습니다. 첫 실행에서 active couple이
  없는 C가 SQL `NULL` 비교로 시작 RPC를 통과하는 결함을 발견했고,
  세 active-couple 비교를 모두 `IS DISTINCT FROM`으로 고친 후 362/362 PASS했습니다.
- **원격 적용 상태: NOT APPLIED.** 2026-08-26 read-only catalog 확인에서
  `daily_records.content_envelope`가 없고 `e2ee_floor_for`가 예전 2-argument
  signature여서 039/040이 원격에 없음을 확인했습니다. 추가 함수 본문
  probe는 043 효과는 있지만 044/045/046 강화 효과와 062는 없음을 확인했습니다.
  따라서 062만 단독 적용하지 마세요. backup/catalog/rollback을 확인한 뒤 exact
  039→040→044→045→046→062 순서를 적용 직전 다시 검토하고 사용자 확인을
 받아야 합니다. 빈 migration ledger 때문에 `supabase db push`는 계속 금지합니다.

## 063 — 곰신 대상 활성 군화 복무 타임라인 프로젝션 RPC (2026-08-26)

- `063_partner_service_projection.sql`은 곰신이 연결된 활성 군화 파트너의 복무 타임라인 정보만 읽을 수 있도록 허용 목록(allowlist)만 반환하는 `get_partner_service_info()` SECURITY DEFINER 함수를 정의합니다.
- 반환 허용 목록(allowlist): `branch`, `military_status`, `enlistment_date`, `expected_discharge_date`, `discharge_date`, `discharge_date_source` 6개 필드만 프로젝션하며, 자유 형식 군 복무 메모(`memo`) 및 `profiles` 소유자 전용 행 전체는 비공개로 유지합니다.
- 보안 불변식:
  - `auth.uid()`가 NULL인 경우 `42501 not_authenticated` 예외로 즉시 거부
  - 호출자는 반드시 활성 상태의 `gomsin` (`status = 'active' AND role = 'gomsin'`)
  - 대상 파트너는 반드시 활성 상태의 `soldier` (`status = 'active' AND role = 'soldier'`)
  - 동일 커플의 활성 멤버 수가 정확히 2명이어야 함 (3인 이상 비정상 커플 시 0행 반환)
  - `anon`, 비관련 사용자, 이전(former) 파트너, 군화 본인 호출 시 0행(zero rows) 반환 또는 거부
  - `SET search_path = public, pg_temp` 고정 및 `REVOKE ALL FROM PUBLIC, anon, authenticated` 후 `authenticated`에만 최소 EXECUTE 권한 부여
- 로컬 하네스 검증: throwaway PostgreSQL 17 환경에서 001부터 063까지 61개 마이그레이션 전체 체인 및 369개 assertion 전수 PASS (`npm run test:phase0`).
- **원격 적용 상태: APPLIED (2026-08-28).** exact 파일 SHA를 확인한 뒤 운영 Supabase에
  적용했습니다. live catalog는 함수 1개, authenticated-only EXECUTE, fixed
  `search_path`, `auth.uid()`·active gomsin→soldier 경계, memo 제외를 확인했습니다.
  rollback-only actor matrix는 gomsin 1행, soldier/former/unrelated 0행이었고 anon
  PostgREST는 `401/42501`로 거부됐습니다. migration ledger relation은 여전히 없으므로
  `supabase db push`는 계속 금지합니다.

## 064 — crypto_pairings 테이블 권한 잠금 및 TRUNCATE 차단 (2026-08-27)

- `064_lock_crypto_pairings_table_privileges.sql`은 `public.crypto_pairings` 테이블에 대해 `PUBLIC`, `anon`, `authenticated`로부터 `ALL PRIVILEGES`를 회수한 뒤, `authenticated`에 오직 `SELECT` 권한만 재부여합니다.
- 배경: `062`에서 `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated`를 적용했으나, PostgreSQL 기본 권한 구조상 `TRUNCATE`, `REFERENCES`, `TRIGGER` 권한이 잔존했습니다. 특히 `TRUNCATE`는 RLS를 우회하므로 인증된 사용자가 전체 페어링 데이터를 삭제할 수 있는 P0 결함이었습니다.
- 보안 불변식:
  - `authenticated`는 `SELECT`만 가능(`has_table_privilege` = `true`), `INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES`는 모두 `false`
  - `anon` 및 `PUBLIC`은 모든 테이블 권한이 `false`
  - 인증된 사용자의 직접적인 `TRUNCATE` 시도는 `42501 permission denied`로 즉시 거부되고 기존 데이터는 온전히 보존됨
  - 테이블 변경은 오직 `062`의 SECURITY DEFINER RPC 3종(`e2ee_start_couple_pairing`, `e2ee_confirm_couple_pairing`, `e2ee_mark_couple_pairing_active`)을 통해서만 수행 가능
  - PostgREST 스키마 캐시 reload (`NOTIFY pgrst, 'reload schema'`)
- 롤백 방침: 광범위한 권한(TRUNCATE/REFERENCES/TRIGGER/INSERT/UPDATE/DELETE)을 복원하지 않으며, 필요 시 `SELECT`만 재부여하는 forward repair 방식으로 안전하게 대응합니다.
- 로컬 하네스 검증: throwaway PostgreSQL 17 환경에서 001부터 064까지 62개 마이그레이션 전체 체인 및 375개 assertion 전수 PASS (`npm run test:phase0`).
- **원격 적용 상태: APPLIED (2026-08-28).** live `authenticated` 권한은 정확히
  `SELECT`만 남았고 anon `SELECT`는 false입니다. 적용 전후 pairing은 0행입니다.
  이 보안 변경은 rollback 시 broad privilege를 복원하지 않고 forward repair합니다.
  migration ledger relation은 여전히 없으므로 `supabase db push`는 계속 금지합니다.

## 065 — 페어링 RPC NULL·만료 상태 forward hardening (2026-08-27)

- 원격에 적용된 062를 재작성하지 않고 동일 RPC signature를 `CREATE OR REPLACE`
  하는 forward migration입니다.
- 시작 RPC는 nonce·transcript·hash의 NULL과 잘못된 길이를 모두 거부하고,
  확인 RPC는 NULL signature를 거부합니다.
- 만료된 확인은 예외로 UPDATE를 rollback하지 않습니다. 행을
  `TRANSCRIPT_EXPIRED`로 저장하고 같은 상태 문자열을 반환하며, 클라이언트 adapter가
  이를 기존 `E_TRANSCRIPT_EXPIRED` 오류로 변환합니다.
- 064의 SELECT-only table privilege와 authenticated-only RPC 권한을 재확인합니다.
- **원격 적용 상태: APPLIED (2026-08-28).** 064 다음 exact SQL로 적용했습니다. live
  catalog에서 RPC 3개가 모두 SECURITY DEFINER, fixed `search_path`, `auth.uid()` bound,
  authenticated-only EXECUTE임을 확인했습니다. rollback-only actor 검증은 정상 start,
  NULL evidence/signature 거부, former/unrelated 거부, 비정상 activate 거부를 PASS했습니다.
  다만 live active device와 couple scope key가 각각 0이어서 실제 두 기기
  confirm→activate 정상 경로는 **UNVERIFIED**입니다. 빈 ledger 때문에
  `supabase db push`는 계속 금지합니다.

## 066 — 푸시 발송 후보 원자적 claim (2026-08-27)

- `066_atomic_push_delivery_claims.sql`은 후보 선정과 lease 획득을 하나의
  SECURITY DEFINER 함수 안에서 처리하고, 같은 claim ID를 가진 호출만 발송 완료 또는
  release를 수행하게 합니다.
- 로컬 fresh-chain actor 계약은 authenticated/anon 직접 실행 거부, 다른 claim의
  완료·release 거부, lease 중복 선정 차단, 만료 후 재선정과 정상 완료를 검증합니다.
- **원격 적용 상태: NOT APPLIED.** 2026-08-28 live catalog에는 선행
  `public.push_delivery_state`가 없고 `send-push` Edge Function도 배포되어 있지 않아 exact
  066은 현재 첫 `ALTER TABLE`에서 실패합니다. 048–055 dependency chain과 sender를 함께
  준비할 때까지 명시적으로 보류하며, 빈 ledger에서 `supabase db push`는 계속 금지합니다.

## 067 — 명시적 프로필 게시물 의도 (2026-08-28)

- `067_profile_post_intent.sql`은 `daily_records.is_profile_post BOOLEAN NOT NULL DEFAULT
  false`를 추가합니다. 글·사진·선택 출처를 복제하지 않고, 사용자가 프로필 격자에
  게시물로 발행했다는 불리언 의도만 기존 기록 행에 둡니다.
- 기존 사진 기록은 backfill하지 않습니다. 이전 스키마에는 스토리 사진과 명시적 게시물을
  구별할 증거가 없으므로 추측해서 프로필 격자에 올리지 않습니다.
- 로컬 PostgreSQL 17 fresh-chain 결과: 65 migrations / 420 assertions PASS. 067 범위는
  owner가 marker를 읽고 바꾸는 성공 경로, active partner의 shared-only 읽기, private 차단,
  unrelated/anon 차단, partner의 author marker 변경 거부를 실제 actor로 확인합니다.
- P5 E2EE actor 하네스도 staging 시 marker `false`, complete-media와 intended visibility를
  함께 확정하는 최종 발행, 일반 수정의 marker 보존과 private/former/unrelated/anon 거부를
  실제 PostgreSQL에서 105 assertions로 PASS했습니다.
- **원격 적용 상태: APPLIED (2026-08-28).** exact SQL 적용 뒤 live 열은 `boolean NOT
  NULL DEFAULT false`이고 기존 5행은 모두 false, NULL 0행입니다. rollback-only actor
  matrix에서 owner marker update 1행, partner update 0행, shared/private/former/unrelated
  읽기 경계와 rollback 후 5행·marker 불변을 확인했습니다. anon PostgREST는
  `401/42501`로 거부됐습니다. 롤백은 먼저 이전 클라이언트로 되돌리고 열은 남긴 뒤
  필요하면 후속 forward migration으로 정리합니다.
