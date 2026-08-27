# App Store 첫 출시 백엔드 결정

## 결론

곰신로그는 App Store 첫 출시까지 **managed Supabase를 유지한다**. GitHub Student
Developer Pack 혜택을 이유로 Appwrite, Azure VM, self-hosted Supabase 또는 직접 만든
백엔드로 지금 이전하지 않는다.

## 판단 근거

- 현재 앱은 PostgreSQL 테이블 외에도 Supabase Auth와 Apple/Google OAuth, RLS, PostgREST,
  SQL RPC, Storage, Edge Functions, 세션 복구를 실제 사용자 경로에서 사용한다.
- 따라서 지금의 이전은 테이블 복사가 아니라 로그인 토큰, OAuth redirect, 권한 정책,
  사진 객체, 함수 배포, 계정 삭제와 푸시 운영을 함께 교체하는 출시 범위 변경이다.
- Appwrite Education 플랜은 공식 FAQ상 상업적 사용이 허용되지 않아 정식 서비스의 기반으로
  선택할 수 없다.
- Azure for Students는 12개월 단위 크레딧이다. 서버 운영을 직접 맡으면 패치, 모니터링,
  백업, 복구, 고가용성, 비밀 관리 책임도 함께 생긴다.
- Supabase 공식 self-host 문서 역시 서버·보안·PostgreSQL·백업·재해복구·모니터링을
  운영자 책임으로 명시한다. Platform 복원 시에도 Storage 객체와 Edge Functions, OAuth,
  SMTP, DNS는 별도 이전이며 기존 세션 토큰은 유지되지 않는다.

## 출시 구조

```text
iPhone / Web·PWA
        ↓
managed Supabase
  - Auth / OAuth
  - PostgreSQL + RLS / RPC
  - Storage
  - Edge Functions
        ↓
Vercel web deployment
```

첫 출시 전에 Free 프로젝트를 운영 근거 없이 self-host로 바꾸는 대신, 실제 서비스라면
managed backup이 포함되는 적절한 Supabase 유료 플랜과 비용 상한을 검토한다. 플랜 변경도
원격 과금 작업이므로 별도 action-time 확인 없이는 실행하지 않는다.

## 지금 추가할 이전 가능성

1. 모든 스키마와 RLS/RPC 변경을 저장소 migration으로 관리한다.
2. 정기 logical dump와 복원 연습을 운영 runbook으로 만든다.
3. Storage 객체 목록·해시·내보내기 절차를 별도로 둔다.
4. Auth provider, redirect, Edge Function, scheduler 설정을 비밀값 없이 inventory로 관리한다.
5. 새 기능은 가능한 범위에서 repository/use-case 경계를 거쳐 Supabase 호출을 UI에서 늘리지 않는다.

## 향후 이전 trigger

다음 중 하나가 실제 계측으로 확인될 때 별도 migration 프로젝트를 시작한다.

- 필요한 SLA·지역·규정 요구를 managed Supabase가 충족하지 못한다.
- 3개월 이상 측정한 비용이 대체 managed stack과 운영 인력 비용을 포함해도 현저히 불리하다.
- 제품에 필요한 서버 작업이 PostgREST/RPC/Edge Functions 경계로 안정적으로 구현되지 않는다.
- 장애 대응과 데이터 복구 요구가 현재 플랜의 backup/PITR 범위를 넘는다.

그때도 첫 선택은 단일 VPS의 직접 운영이 아니라 **managed PostgreSQL + 작은 TypeScript API +
관리형 object storage**다. 데이터, Auth, Storage, 함수 순으로 rehearsal 환경에서 검증하고,
사용자 재로그인과 rollback을 포함한 dual-run/cutover 계획을 만든다.

## 상태

- Repository: 문서만 변경
- Database/migration: 변경 없음
- Supabase Production: NOT APPLIED
- Vercel Production: NOT APPLIED
- Apple/App Store Connect: NOT APPLIED

## 확인한 공식 자료

- [GitHub Student Developer Pack](https://education.github.com/pack)
- [Appwrite Education FAQ](https://appwrite.io/education)
- [Azure for Students](https://azure.microsoft.com/en-us/free/students)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase self-hosting responsibilities](https://supabase.com/docs/guides/self-hosting)
- [Supabase Platform에서 self-hosted로 복원](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
