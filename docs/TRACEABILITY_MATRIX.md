# 곰신로그 추적성 매트릭스

제품 문서의 약속이 실제 화면·데이터·검증과 어디에서 이어지는지 찾기 위한 지도다.

| 제품 영역 | 경로/주요 코드 | 주요 데이터·마이그레이션 | 대표 검증 | 상태 |
| --- | --- | --- | --- | --- |
| 인증·복구 | `App.tsx`, `AuthCallbackPage.tsx` | Supabase Auth, 006·013·015 | `authCallbackPkceRace.test.tsx`, 계정 삭제 복구 테스트 | 구현 |
| 온보딩·초대 | `OnboardingPage.tsx` | profiles, couples, invitations; 008·013·016·017 | `OnboardingPage.test.tsx`, `onboardingEntryStep.test.tsx` | 구현/사람 E2E 필요 |
| 역할별 홈 | `HomePage.tsx`, `lib/widgets.tsx` | profiles, records, schedules | 홈·위젯·키보드 테스트 | 구현 |
| 기록 작성 | `TodayLogWidget.tsx`, 기록 서비스 | records, record_media; 001·003·014 | composer·draft·offline queue·upload 테스트 | 구현 |
| 기록 탐색 | `RecordPage.tsx` | records, storage; 007·014 | `RecordPage.test.tsx`, 작성자·원문 이동·재생 테스트 | 구현 |
| 통화 전 60초 | `CallBriefingWidget.tsx`, call briefing 모듈 | records, 로컬 checkpoint; 019의 talk flag | `CallBriefingWidget.test.tsx`와 briefing 테스트 | 구현/효과 검증 필요 |
| 일정 | `SchedulePage.tsx` | schedules; 011·014·019 | `SchedulePage.test.tsx` | 구현/사람 E2E 필요 |
| 공동 할 일 | `SchedulePage.tsx` | shared_tasks; 018 | migration 018·일정 테스트 | 구현/사람 E2E 필요 |
| 여행 목록 | `TripsPage.tsx` | trips; 011·014 | `TripsPage.test.tsx` | 구현 |
| 여행 상세·OCR | `TripDetailPage.tsx` | trip_places, trip_checklist; 018·019 | `TripDetailPage.test.tsx`, migration 테스트 | 구현/OCR 실기기 검증 필요 |
| 우리 | `UsPage.tsx` | profiles, couples, schedules, trips | 기념일 provenance·키보드 카드 테스트 | 구현 |
| 복무·D-Day | `ServicePage.tsx`, D-Day 위젯 | profiles/service fields; 017 | military provenance 테스트 | 구현 |
| 마이·설정 | `MyPage.tsx`, `SettingsPage.tsx` | profiles, couples, deletion RPC | 설정 연결·경로·계정 삭제 테스트 | 구현/파괴 흐름 사람 검증 필요 |
| 시각 디자인 시스템 | `src/styles/index.css`, 공통 UI 컴포넌트 | semantic color·type·spacing·radius token | 320/390px visual QA, light/dark, keyboard·contrast 검사 | v2.1 명세 확정/화면 이관 필요 |
| 홈·기록 정보 위계 | `HomePage.tsx`, `RecordPage.tsx`, 홈 위젯 | 실제 기록·미디어·작성자 메타데이터 | content-first 순서, above-the-fold 과업, editorial timeline 검수 | v2.1 명세 확정/화면 이관 필요 |
| 권한·개인정보 | RLS 정책, storage 정책 | 005·007·009·010·012·014·015·016·017 | migration security contracts, RLS 문서 | 구현/원격 점검 필요 |
| 배포 품질 | CI, Vercel, Supabase | 마이그레이션 001–019 | boundary·web·browser·deno-edge·dependency-policy | 자동화됨 |

## 문서와 구현의 상태 해석

- `구현`: 코드와 자동 검증이 존재한다.
- `사람 E2E 필요`: 실제 두 계정·실제 브라우저·원격 Supabase에서 최종 확인해야 한다.
- `효과 검증 필요`: 기능은 동작하지만 사용자의 통화와 관계에 실제 도움이 되는지는 파일럿으로 판단해야 한다.
- `v2.1 명세 확정/화면 이관 필요`: 디자인 원칙과 수용 기준은 문서로 확정됐지만, 전 화면이 새 visual language로 구현됐다는 뜻은 아니다.
- 디자인 구현의 기준 문서는 `DESIGN_V2.md`, 제품 범위는 `PRODUCT_PRD.md`, 화면 구조는 `WIREFRAMES.md`를 따른다. 충돌 시 제품 요구사항은 PRD, 시각 표현은 최신 DESIGN_V2가 우선한다.
- 이 문서는 코드 파일이 이동하거나 DB 마이그레이션이 추가될 때 함께 갱신한다.
