# 시간별 스토리: 작성자 프로필 사진

## 방향 / 범위
- 최신 사용자 요청: 시간순 나열 유지, 문서 아이콘 대신 스토리 주인의 My 사진 사용.
- Product: 최신 요청 / V4. Business: NOT APPLICABLE. Engineering: 기존 원본·권한 계약 유지. Current State / 최신 WORK_LOG 확인. Conflict: NO (이전 첨부 썸네일 표현을 최신 요청이 대체).
- 기준: `codex/beta-device-gates` / `f1039bc07eabdfbbc6a22671186f8ded2ec8397b`.
- Tesla Terra High 구현, 부모는 코드 미작성·diff/실행/시각 검증. Native XCTest WIP 동결·분리.

## 변경
- PaperHome.tsx / notebookHome.css: 활성 partner ID의 기존 권한 hook을 레일당 한 번 사용. 각 시간에 동일 작성자 사진, 실패/부재는 기존 PenFace. 새 사진 URL은 복구 가능.
- 매 기록마다 ProfileAvatar를 마운트하는 대안은 중복 서버 읽기/이벤트 구독 때문에 제외. 사진 첨부 썸네일과 FileText 장식 제거.
- PaperHome.test.tsx / e2e/profileAvatars.spec.ts: 작성자·실패 복구·사진 변경/삭제·정확한 원본 접근 회귀 검증.
- 시간순·기록 ID·acknowledgment·private/undecryptable 필터·DB·crypto·Book·native 의미 변경 없음.

## 검증
- 부모: avatar hook/transport 15 PASS; 최종 Home 36 PASS; diff-check PASS.
- Worker: Home 36 PASS, typecheck/lint PASS.
- 부모 초기 browser 4 PASS: 402 light, 320 dark, 원본 이동, My 사진 변경/삭제. 불필요 effect 제거 전 빌드이므로 최종 재검증 별도 진행.
- 최종 real release build PASS, index SHA256 `1cdb2a660cf254e5ae59f590b774c6bc464f8757bed498521f13ccd021c83f4f`.
- 최종 소스로 fresh QA build 후 같은 browser 4개 모두 PASS (부모 실행). `CI=true GOMSINLOG_E2E_PORT=4194 GOMSINLOG_NOTEBOOK_SCREENSHOT_RUN=owner-avatar-final node node_modules/@playwright/test/cli.js test e2e/notebookHome.spec.ts e2e/profileAvatars.spec.ts --config=playwright.config.ts --grep 'time rail opens|Notebook Home screenshot (402-light-horizontal|320-dark-horizontal)|My photo appears'`.
- 실제 4193 미리보기 immutable artifact로 교체·새로고침·화면 확인. 문서 아이콘 제거 확인. 현재 실제 계정은 기본 아바타 표시: 실제 사진 등록/운영 RPC 정상 여부는 이 화면만으로 입증되지 않음.
- 합성 QA의 사진 표시 성공을 Production 사진 기능 완료로 표현하지 않음. 사용자 기록/사진 원문 로그·커밋 없음.

## 경계 / 다음
- REVIEW IMPACT: scoped UI DELTA, 이전 전체 release verdict 승계 안 함.
- Production DB/provider/public deployment: NOT APPLIED. Local preview: APPLIED. 이번 변경 native 설치 미실행.
- Native/AI 실기기 gate와 운영 호환성·백업·배포는 미완료.
- Rollback: 이 작업의 Home 4파일 변경만 되돌리고 기존 미리보기 artifact 재연결; 사용자 데이터 변경 없음.
