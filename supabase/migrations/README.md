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

> **048과 047의 관계 (2026-08-21).** 047(care signal `feeling_unwell`)은 PR #76이 소유하며
> 이 브랜치에는 없습니다. 048은 047과 겹치는 객체가 없어 순서 충돌은 없지만, **두 계보가
> 합쳐진 뒤 001→048 전체 fresh chain을 다시 한 번 실행해야** 결합 상태가 검증됩니다.
> 이 브랜치에서 실행한 harness는 047이 빠진 체인입니다.

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
| `048_push_delivery_metadata.sql` | Gate 3 push의 **유일한** 서버 상태. `device_push_tokens`(본인만, 토큰 UNIQUE로 기기 이양 처리) + `push_delivery_state`(수신자별 병합 플래그 하나, **본인만 SELECT**) + 발송 후보 조회·기록·본인 플래그 해제·토큰 회수 함수. `daily_records` AFTER INSERT 트리거가 플래그를 올리되 **`is_private` 기록은 아무것도 올리지 않는다** — 비공개 기록에 알림이 가면 '무언가 썼다'는 사실 자체가 새기 때문이다. **전략은 `couple_members.has_unseen`을 지정했으나 구현·검증 결과 그것이 틀렸다**: 001의 SELECT 정책이 활성 파트너에게 상대 행 전부를 보여주므로 그 자리의 플래그는 곧 읽음 표시가 되고, RLS는 row 단위라 컬럼 하나만 가릴 수 없다. 그래서 전용 테이블로 옮겼다. 토큰 등록은 `register_push_token()`으로만 하며, **같은 토큰을 들고 있던 계정의 행을 먼저 삭제**한다 — APNs·FCM이 재설치·기기 이양 시 같은 토큰을 넘겨주므로, 평범한 INSERT는 UNIQUE에 걸려 새 계정은 알림을 못 받고 **떠난 계정이 그 기기 알림을 계속 받는** 상태가 된다(§14.3 위반). 발송자(Edge Function)는 `service_role`만 호출 가능하며 콘텐츠·이벤트 종류·개수를 볼 수 없다. 029와 같은 in-body gate를 두어 GRANT가 잘못 나가도 본문에서 거부한다. 하루 1회 상한과 연락 가능 시간은 발송자가 아니라 DB가 강제한다. `disconnect_couple`은 양쪽 토큰을 삭제하고 양쪽 플래그를 내린다 | **신규 / 어디에도 미적용 — fresh chain(001→046→048, 45개)에 적용하고 phase0 harness에서 37개 계약을 실제 PostgreSQL 17.10으로 검증함. mutation 6건(비공개 누출·하루 1회·연락 시간·NULL actor·기기 이양·service_role gate) 전부 실패 확인. 플랫폼 검증 mutation 1건은 통과했는데, 테이블 CHECK가 이미 막고 있어 함수 검증은 에러 메시지용이기 때문** |
| `049_product_events.sql` | §19 허용 목록 안의 최소 계측. LV 진입 조건이다(계측 없는 검증은 연극이다). **이 테이블에는 timestamp 컬럼이 없다** — `occurred_on DATE`뿐이다. 다른 모든 테이블이 갖는 `created_at TIMESTAMPTZ DEFAULT now()`를 여기 두면 누가 언제 앱을 여는지의 분 단위 기록이 되고, 그것이 §19가 금지하는 행동 감시다. 리뷰에서 아무도 의심하지 않을 기본값으로 도착한다는 점이 위험하다. `kind`·`screen`은 CHECK 제약의 닫힌 집합, `subject_id`는 UUID라 제목·본문·파일명이 들어갈 수 없다. RLS는 본인 INSERT/SELECT만이고 **파트너에게는 어떤 read 정책도 없다.** UPDATE·DELETE 정책이 아예 없어 이벤트는 사실로 남는다. `user_id`는 payload가 아니라 `auth.uid()` 기본값에서 온다 | **신규 / 어디에도 미적용 — fresh chain 001→049에 적용, phase0 harness에서 19개 계약을 실제 PostgreSQL 17.10으로 검증. mutation 4건(`created_at` 추가·자유 텍스트 컬럼·파트너 read 허용·금지 이벤트 종류) 전부 실패 확인** |
| `050_lv_funnel_readout.sql` | 049를 LV 판독 목록과 대조해 찾은 두 격차를 닫는다. **(1) 측정 단위가 없었다** — 전략은 획득 단위가 '연결된 커플 1쌍'이라고 못박는데 `product_events`에는 `user_id`만 있어 커플 단위 지표 2개(주간 기록 커플 비율·4주 재사용률)를 아예 계산할 수 없었다. `couple_id`를 추가하되 `get_my_active_couple_id()` DEFAULT로 **세션에서 파생**한다 — 클라이언트가 보낼 수 없으므로 속한 적 없는 커플로 귀속시킬 수 없다. RLS 범위는 그대로이고 **파트너 read 정책은 여전히 없다.** **(2) 판독이 곧 행 조회였다** — 함수가 없으면 `service_role`이 raw 이벤트 행을 긁어야 하고 그건 한 사람의 개별 행동을 순서대로 보는 것이다. `lv_funnel_readout`은 **집계만**(metric, value) 반환하며 행 반환 경로가 없다. `lv_couple_return_count`는 **몇 커플이 돌아왔는지**를 주고 어느 커플인지는 주지 않는다. 사용자별 분해·커플 간 순위는 의도적으로 없다. **일별 시계열은 함수가 반환하지 않을 뿐 호출자가 하루짜리 창을 반복 호출해 만들 수 있다** — §19가 날짜 버킷을 허용하므로 위반은 아니지만 함수가 막는 것도 아니며, 그 구분은 LV 운영 규율이 진다 | **신규 / 어디에도 미적용 — fresh chain 001→050에 적용, phase0 harness 197개 중 050이 16개. mutation 5건(클라이언트 위조 가능한 couple_id·service_role gate·커플 대신 계정 집계·재방문이 커플 id 반환·역순 범위 허용) 전부 실패 확인** |

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
