# 곰신로그 (GomsinLog)

**군화와 곰신을 위한 1:1 비공개 데일리 로그 서비스**

> "답장이 늦어도, 오늘의 순간은 놓치지 않도록."

---

## 1. 제품 정의

**곰신로그**는 대한민국 군화와 곰신이 서로의 하루를 사진, 짧은 영상, 음성, 한 줄 기록으로 부담 없이 남기고, 제한된 연락 시간(저녁 통화 전 등)에 서로의 하루를 시간순으로 놓치지 않고 훑어볼 수 있는 **닫힌 초대 기반의 1:1 비공개 데일리 로그 앱**입니다.

### 핵심 제품 원칙
1. **이 앱은 “AI 브리핑 앱”이 아닙니다.**
   - AI, 브리핑, 감정 분석을 브랜드 메인 가치로 내세우지 않습니다.
   - 핵심 가치는 **가벼운 일상 기록 → 시간순 확인 → 자연스러운 대화**입니다.
   - "오늘의 빠른 정리"는 군화가 1분 안에 상대의 하루를 빠르게 훑도록 돕는 **작은 보조 정리 카드**일 뿐입니다.
   - 요약 문장이나 항목을 누르면 **해당 원본 기록 위치로 스크롤하여 1~2초간 시각적으로 강조**됩니다.

2. **단순하고 명확한 프라이버시 (기본: 우리 공유)**:
   - **기본값**: 우리 둘에게 공유 (`is_private = false`).
   - **필요 시**: "나에게만 남기기" (`is_private = true`) 작은 토글 제공.
   - `is_private = true` 기록은 상대방 타임라인, 달력 및 자동 빠른 정리 분석에서 **완전히 제외**됩니다. 서버에서는 RLS 정책이 상대방의 조회를 차단하고, 클라이언트에서도 `src/lib/privacy.ts` 가 한 번 더 걸러냅니다.

3. **곰신의 쉬운 기록 (2~3터치)**:
   - 감정, 에너지 슬라이더, 배려 요청 필수 입력을 강요하지 않습니다.
   - `지금찍기` / `사진·영상` / `음성` / `한줄` 4개 주요 CTA를 최우선으로 배치합니다.
   - 곰신과 군화 **양쪽 모두** 동일한 작성기로 글과 미디어를 남길 수 있습니다.
   - 선택 리액션: `좋았어` / `이런 일이 있었어` / `힘들었어` / `네 생각났어` (선택 사항).

4. **군화 홈의 본질: 시간순 타임라인**:
   - 폰을 받거나 접속했을 때 상대방의 오늘 순간들을 시간순(사진, 영상, 음성, 텍스트)으로 있는 그대로 감상합니다.

5. **기록 아카이브 & 월간 달력 (기억의 입구)**:
   - 기록 탭은 일정 관리 도구가 아닌, 과거의 일상이 쌓인 날짜를 발견하고 날짜별 타임라인으로 접속하는 아카이브 공간입니다.

---

## 2. 기술 스택 및 운영 데이터 구조

- **Core**: React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + React Router v7 + Sonner
- **백엔드**: Supabase (Postgres + RLS, Auth, 비공개 Storage 버킷, Edge Function)
- **상태 및 데이터**: Supabase를 단일 원본으로 사용. `localStorage`에는 테마·위젯 배치와 사용자가 고른 기기 전용 장식 사진만 저장하고, 전송 대기 기록은 계정별 IndexedDB outbox에 임시 보관
- **네이티브**: Capacitor 7 (Android / Google Play)

```bash
npm install

npm run verify      # 타입검사 + 린트 + 테스트 + 빌드 (한 번에)

npm run typecheck   # tsc -b --force
npm run lint        # eslint
npm test            # vitest (전체 스위트)
npm run build       # 프로덕션 빌드

# Capacitor (Android / iOS)
# android/ 와 ios/ 는 Git에 포함된 "설정"입니다. cap add 로 다시 만들지 마세요.
# (결정 배경: docs/kiro/NATIVE_RELEASE_GUIDE.md)
npm run cap:sync          # 빌드 + android/ 동기화
npm run cap:sync:ios      # 빌드 + ios/ 동기화 (pod install 은 macOS 필요)
npm run cap:open          # Android Studio 열기
npm run cap:open:ios      # Xcode 열기 (macOS)

npm run verify:native     # 네이티브 설정 불변식 검사 (권한/딥링크/백업/개인정보)
npm run verify:assets     # 아이콘·스플래시가 생성기 출력과 바이트 단위로 동일한지
npm run assets:generate   # public/favicon.svg 에서 모든 래스터 자산 재생성
```

> **필수 설정**: `VITE_SUPABASE_URL`과 `VITE_SUPABASE_PUBLISHABLE_KEY`가 없거나
> 올바르지 않으면 운영 빌드를 만들 수 없습니다. 앱은 인증된 실제 계정과 Supabase
> 데이터만 사용하며, 로그인하지 않은 상태에서 가짜 사용자 데이터로 진입하지 않습니다.

### 문서

시작 지점은 **[`docs/kiro/AI_HANDOFF.md`](docs/kiro/AI_HANDOFF.md)** 입니다.

| 문서 | 용도 |
| --- | --- |
| [`docs/kiro/AI_HANDOFF.md`](docs/kiro/AI_HANDOFF.md) | 실제 라우트 구조와 반드시 알아야 할 구조적 제약 |
| [`docs/kiro/RELEASE_AUDIT_2026-07-31.md`](docs/kiro/RELEASE_AUDIT_2026-07-31.md) | 수정한 결함과 남은 위험 |
| [`docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`](docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md) | 배포 절차 (비개발자용) |
| [`docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md`](docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md) | 2계정 수동 검증 |
| [`docs/kiro/NATIVE_RELEASE_GUIDE.md`](docs/kiro/NATIVE_RELEASE_GUIDE.md) | Android/iOS 네이티브 설정 결정, 권한·백업·개인정보 근거, 버전 절차 |
| [`docs/kiro/PLAY_STORE_ROADMAP.md`](docs/kiro/PLAY_STORE_ROADMAP.md) | Google Play 출시 |
| [`docs/kiro/ROLLBACK_GUIDE.md`](docs/kiro/ROLLBACK_GUIDE.md) | 문제 발생 시 되돌리기 |
| [`supabase/migrations/README.md`](supabase/migrations/README.md) | 마이그레이션 목록과 적용 순서 |

---

## 3. 인증 및 온보딩 아키텍처

- **로그인 방식**:
  - `Google로 계속하기` (Supabase OAuth 연동 필요)
  - `이메일로 시작하기` (Magic Link 연동 필요)
  - `Apple로 계속하기` (iOS 환경 조건부 노출 UI)
- **수집하지 않는 개인정보**: 실명, 성별, 생년월일, 부대명, 계급, 군번, 부대 위치.
- **6단계 온보딩**:
  1. 역할 선택 (`곰신` / `군화`)
  2. 닉네임 입력 (2~12자)
  3. 우리 공간 (새 공간 생성 / 초대 코드 참여)
  4. 우리의 시작일 (`anniversaryDate`, 사귄 날짜)
  5. 복무 정보 (`branch`, `militaryStatus`, `enlistmentDate`, `expectedDischargeDate` - 군화 역할 중심)
  6. 연락 가능 시간 (`weekdayStart`~`weekdayEnd`, `weekendStart`~`weekendEnd`)

---

## 4. 라이선스

Private - All rights reserved (곰신로그)
