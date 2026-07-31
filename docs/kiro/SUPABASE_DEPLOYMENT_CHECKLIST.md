# Supabase 배포 체크리스트 (비개발자용)

이 문서는 **개발을 몰라도** 순서대로 따라 할 수 있도록 썼습니다.
모든 단계는 Supabase 웹사이트(대시보드)에서 마우스로 할 수 있습니다.

> ⚠️ **이 작업은 아직 실행되지 않았습니다.**
> 원격 데이터베이스를 바꾸는 일이라 반드시 사람이 직접 확인하고 실행해야 합니다.

---

## 0. 준비물

- Supabase 계정과 이 앱의 프로젝트 접근 권한
- 시간 30분 정도
- **운영(실제 사용자용) 프로젝트와 별도로 스테이징(연습용) 프로젝트**
  - 없다면 만드는 것을 강력히 권합니다. 실수했을 때 되돌릴 수 있습니다.

---

## 1. 백업 만들기 (건너뛰지 마세요)

1. Supabase 대시보드 접속 → 프로젝트 선택
2. 왼쪽 메뉴에서 **Database** 클릭
3. **Backups** 클릭
4. 백업 목록에 최근 날짜가 있는지 확인
   - 유료 플랜: 자동 백업이 있습니다. 날짜만 확인하세요.
   - 무료 플랜: 자동 백업이 없습니다. 아래를 실행해 직접 내려받으세요.

무료 플랜에서 백업하는 법:
1. **Database → Backups → Download** 버튼이 없으면
2. 왼쪽 메뉴 **SQL Editor** → 새 쿼리 → 아래를 실행하고 결과를 복사해 보관

```sql
-- 데이터 양 확인 (숫자를 메모해 두세요. 나중에 비교용)
SELECT 'profiles' AS t, count(*) FROM profiles
UNION ALL SELECT 'couples', count(*) FROM couples
UNION ALL SELECT 'couple_members', count(*) FROM couple_members
UNION ALL SELECT 'daily_records', count(*) FROM daily_records
UNION ALL SELECT 'invitation_codes', count(*) FROM invitation_codes;
```

메모한 숫자: ______________________________

---

## 2. 마이그레이션 013 적용

**무엇을 하는 건가요?**
초대코드는 숫자 6자리입니다. 지금은 **아무나 코드를 계속 찍어보면 남의 커플
공간에 들어갈 수 있습니다.** 013은 그것을 막습니다. 또 초대코드를 잃어버렸을 때
새로 발급할 수 있게 해 줍니다.

### 2-1. 먼저 스테이징에서

1. 스테이징 프로젝트 선택
2. 왼쪽 메뉴 **SQL Editor** → **New query**
3. 이 저장소의 `supabase/migrations/013_invitation_hardening.sql` 파일을
   **전체 복사**해서 붙여넣기
4. 오른쪽 아래 **Run** 클릭
5. 초록색 성공 메시지가 나오는지 확인
   - 빨간 오류가 나오면 **아무것도 바뀌지 않았습니다** (파일이 하나의 트랜잭션으로
     묶여 있습니다). 오류 메시지를 그대로 개발자에게 전달하세요.

### 2-2. 검증

같은 SQL Editor에서 아래를 실행하고, 오른쪽에 적힌 기대값과 같은지 확인하세요.

```sql
-- (1) 함수 3개가 만들어졌는지  → 3개 행이 나와야 함
SELECT proname FROM pg_proc
WHERE proname IN ('redeem_invitation','regenerate_invitation','prune_invitation_attempts');

-- (2) 로그인하지 않은 사람은 실행 못 하는지  → 둘 다 false
SELECT has_function_privilege('anon','public.redeem_invitation(text)','EXECUTE');
SELECT has_function_privilege('anon','public.regenerate_invitation(text)','EXECUTE');

-- (3) 로그인한 사람은 실행 가능한지  → true
SELECT has_function_privilege('authenticated','public.redeem_invitation(text)','EXECUTE');

-- (4) 초대코드 표를 앱이 직접 못 읽는지  → false
SELECT has_table_privilege('authenticated','public.invitation_codes','SELECT');

-- (5) 시도 기록을 앱이 못 건드리는지  → 둘 다 false
SELECT has_table_privilege('authenticated','public.invitation_attempts','SELECT');
SELECT has_table_privilege('authenticated','public.invitation_attempts','INSERT');
```

**하나라도 기대값과 다르면 운영에 적용하지 마세요.**

### 2-3. 운영에 적용

스테이징에서 (1)~(5) 모두 통과하고, 앱에서 초대/연결이 정상 동작하면
운영 프로젝트에서 2-1, 2-2를 똑같이 반복합니다.

---

## 3. Storage(사진·영상·음성 저장소) 확인

사진 업로드가 동작하려면 아래가 맞아야 합니다.

1. 왼쪽 메뉴 **Storage**
2. `couple-media` 라는 버킷이 있는지 확인
   - 없으면 **New bucket** → 이름 `couple-media` → **Public bucket 체크 해제**
     (반드시 비공개여야 합니다) → Create
3. 이미 있으면 버킷 이름 옆 **⋯ → Edit bucket** 에서
   **Public** 이 **꺼져 있는지** 확인

그리고 SQL Editor에서:

```sql
-- 비공개여야 합니다 → public 컬럼이 false
SELECT id, public FROM storage.buckets WHERE id = 'couple-media';

-- 정책이 4개 정도 있어야 합니다 (insert/select/delete)
SELECT policyname FROM pg_policies
WHERE schemaname='storage' AND tablename='objects';
```

정책이 없으면 `supabase/migrations/007_storage_policies.sql` 을 SQL Editor에서
실행하세요.

---

## 4. 로그인 설정 (Authentication)

1. 왼쪽 메뉴 **Authentication** → **URL Configuration**
2. **Site URL**: 앱을 올린 주소 (예: `https://gomsinlog.vercel.app`)
3. **Redirect URLs** 에 아래를 **모두** 추가

```
https://<앱-주소>/auth/callback
http://localhost:5173/auth/callback
gomsinlog://auth/callback
```

> 마지막 `gomsinlog://auth/callback` 은 안드로이드 앱에서 구글 로그인이
> 돌아올 주소입니다. 없으면 앱에서 로그인이 안 됩니다.

4. **Authentication → Providers → Google** 을 켜고, Google Cloud에서 받은
   Client ID / Secret 을 넣습니다.
5. Google Cloud Console → 해당 OAuth 클라이언트 → **승인된 리디렉션 URI** 에
   Supabase가 안내하는 주소(`https://<프로젝트>.supabase.co/auth/v1/callback`)를
   추가합니다.

---

## 5. Edge Function 배포 (계정 삭제 기능)

**이것을 하지 않으면 "계정 삭제" 버튼이 실패합니다.**

이 단계만은 컴퓨터에서 명령어를 입력해야 합니다. 개발자에게 아래를 전달하세요.

```bash
# 1) Supabase CLI 설치 (한 번만)
npm install -g supabase

# 2) 로그인
supabase login

# 3) 프로젝트 연결 (<project-ref>는 대시보드 주소에 있는 값)
supabase link --project-ref <project-ref>

# 4) 배포
supabase functions deploy delete-account
```

배포 후 대시보드 **Edge Functions → delete-account → Secrets** 에서
`SUPABASE_SERVICE_ROLE_KEY` 가 설정되어 있는지 확인하세요.
(보통 자동으로 주입되지만, 없으면 **Settings → API** 의 `service_role` 키를 넣습니다.)

> 🔐 `service_role` 키는 절대 앱 코드나 GitHub에 넣지 마세요. 이 키는 모든 보안
> 규칙을 무시할 수 있습니다.

---

## 6. 앱 환경변수

앱을 배포하는 곳(Vercel/Netlify 등)에 아래 두 개를 넣습니다.
`.env` 파일은 GitHub에 올리지 않습니다.

```
VITE_SUPABASE_URL=https://<프로젝트>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon / publishable 키>
```

`.env.example` 에 형식이 적혀 있습니다.
**`service_role` 키는 여기에 넣으면 안 됩니다.**

---

## 7. 마지막 확인

- [ ] 백업 완료
- [ ] 013 스테이징 적용 + 검증 통과
- [ ] 013 운영 적용 + 검증 통과
- [ ] `couple-media` 버킷 비공개 확인
- [ ] Storage 정책 존재 확인
- [ ] Redirect URLs 3개 등록 (`gomsinlog://` 포함)
- [ ] Google 로그인 제공자 설정
- [ ] `delete-account` 배포 + 시크릿 확인
- [ ] 배포 환경변수 2개 설정
- [ ] `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` 의 2계정 테스트 통과

문제가 생기면 `docs/operations/rollback-runbook.md` 와
`docs/kiro/ROLLBACK_GUIDE.md` 를 보세요.
