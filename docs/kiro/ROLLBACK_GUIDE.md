# 되돌리기(롤백) 안내 — 비개발자용

문제가 생겼을 때 **당황하지 말고** 아래 순서대로 하세요.
"무엇이 잘못됐는지" 에 따라 볼 곳이 다릅니다.

---

## 상황 A: 앱 화면이 하얗게 뜨거나 로딩만 계속됨

가장 빠른 해결: **앱을 이전 버전으로 되돌리기**

### Vercel / Netlify 를 쓴다면

1. 배포 사이트(예: vercel.com) 로그인
2. 프로젝트 선택 → **Deployments** 목록
3. 잘 동작했던 이전 배포를 찾기 (날짜 확인)
4. 그 항목의 **⋯ → Promote to Production** (Netlify는 **Publish deploy**)
5. 1~2분 후 앱 주소를 새로고침

> 데이터베이스는 건드리지 않으므로 사용자 기록은 그대로입니다.

### 그래도 안 되면 (사용자 기기 캐시)

사용자에게 안내: 앱을 완전히 닫고 다시 열기 → 그래도 안 되면
브라우저 설정에서 이 사이트의 데이터 삭제 후 재로그인.

---

## 상황 B: 마이그레이션 013을 실행했는데 문제가 생김

013은 `BEGIN; ... COMMIT;` 으로 묶여 있습니다.
**빨간 오류가 났다면 아무것도 바뀌지 않았습니다.** 그냥 오류 메시지를 개발자에게
전달하세요.

성공했는데도 초대/연결이 안 된다면 되돌립니다.

1. Supabase 대시보드 → **SQL Editor** → New query
2. `supabase/migrations/013_invitation_hardening.sql` 파일 **맨 아래**
   `-- ROLLBACK` 아래에 있는 블록을 복사
3. 각 줄 앞의 `-- ` 를 지워서 실행 가능한 SQL로 만든 뒤 **Run**
4. 그 다음 `supabase/migrations/009_remote_core_security_hotfix.sql` 의
   **"6. Atomic invitation consumption"** 부분만 복사해서 실행
   (원래 `consume_invitation` 함수를 되살리는 작업입니다)

되돌린 뒤 확인:

```sql
-- 함수가 사라졌는지 → 0개 행
SELECT proname FROM pg_proc
WHERE proname IN ('redeem_invitation','regenerate_invitation');
```

> 앱은 `redeem_invitation` 이 없으면 자동으로 예전 방식으로 동작합니다.
> 다만 **초대코드 무차별 대입 방어가 사라지므로** 되돌린 상태를 오래 두지 마세요.

---

## 상황 C: 계정 삭제 기능이 실패함

증상: "계정을 삭제하지 못했습니다" 토스트.

**이 경우 사용자 데이터는 삭제되지 않았습니다.** 다시 시도할 수 있습니다.

원인 확인:
1. Supabase 대시보드 → **Edge Functions** → `delete-account`
2. **Logs** 탭에서 빨간 오류 확인
3. 자주 있는 원인:
   - 함수가 배포되지 않음 → `SUPABASE_DEPLOYMENT_CHECKLIST.md` 5번
   - `SUPABASE_SERVICE_ROLE_KEY` 없음 → 같은 문서 5번
   - 외래키 오류 → 개발자에게 로그 전달

임시 조치: 사용자에게 "잠시 후 다시 시도해 주세요" 안내.
급하면 대시보드 **Authentication → Users** 에서 해당 사용자를 직접 삭제할 수
있지만, **공유 일정/여행이 함께 사라질 수 있으므로** 개발자와 상의하세요.

---

## 상황 D: "일부 첨부파일이 남아 있을 수 있습니다" 경고가 나옴

계정은 삭제됐지만 저장소 파일 정리가 일부 실패한 경우입니다.
데이터베이스 기준으로는 삭제가 끝났고, 남은 파일은 아무 기록도 가리키지 않습니다.

정리 방법:
1. Supabase 대시보드 → **Storage** → `couple-media`
2. 해당 커플 ID 폴더를 찾아 수동 삭제

---

## 상황 E: 사진이 안 보임 / 업로드가 실패함

확인 순서:

1. **Storage → `couple-media` 버킷이 있는지**
   없으면 만들고 **Public 체크 해제** (`SUPABASE_DEPLOYMENT_CHECKLIST.md` 3번)
2. **정책이 있는지**
   ```sql
   SELECT policyname FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects';
   ```
   비어 있으면 `007_storage_policies.sql` 실행
3. 커플이 연결되어 있는지 (연결 전에는 업로드할 수 없습니다)

---

## 상황 F: 구글 로그인이 안 됨

1. Supabase → **Authentication → URL Configuration → Redirect URLs** 에
   아래가 **모두** 있는지 확인
   ```
   https://<앱-주소>/auth/callback
   gomsinlog://auth/callback
   ```
2. **Authentication → Providers → Google** 이 켜져 있는지
3. Google Cloud Console의 승인된 리디렉션 URI에
   `https://<프로젝트>.supabase.co/auth/v1/callback` 이 있는지

안드로이드 앱에서만 안 된다면 `gomsinlog://auth/callback` 누락이 가장 흔한 원인입니다.

---

## 상황 G: 코드를 이전 상태로 완전히 되돌리고 싶음

이번 작업은 모두 `kiro/release-hardening-2026-07-31` 브랜치에 있고
`master` 는 **전혀 건드리지 않았습니다.**

즉 `master` 를 배포하면 작업 이전 상태로 완전히 돌아갑니다.
(단, 그 상태에는 이 문서가 정리한 개인정보/데이터 손실 문제들이 그대로 있습니다.)

---

## 연락 전에 모아두면 좋은 정보

- 무슨 화면에서, 무엇을 눌렀을 때 생겼는지
- 화면 캡처
- 발생 시각
- Supabase → Edge Functions → Logs 의 빨간 줄
- Supabase → Logs → Postgres 의 오류 메시지
- 브라우저 콘솔 로그 (`F12` → Console)

## 관련 문서

- `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` — 배포 순서
- `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` — 2계정 검증
- `docs/kiro/RELEASE_AUDIT_2026-07-31.md` — 무엇을 고쳤고 무엇이 남았는지
- `docs/operations/rollback-runbook.md` — 기존 운영 런북
