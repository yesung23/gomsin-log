# Kiro 실행 지시 — 곰신로그 디자인 v2.1 구현

곰신로그의 디자인을 확정된 제품·디자인 문서를 기준으로 실제 제품 전체에 구현한다. 일부 색상만 변경하는 작업이 아니라 과대 카드형·AI 템플릿형 UI를 제거하고 정보 구조, 시각 위계, 컴포넌트 밀도, 기록 표현을 통일하는 작업이다.

## 작업 전 필수 확인

저장소의 현재 브랜치와 `git status`, `git diff`를 먼저 확인한다. 기존 사용자 변경 사항과 작성 중인 디자인 문서 및 레퍼런스를 보존하고 `reset`, 강제 checkout, stash 삭제, force-push, history rewrite를 하지 않는다.

다음 문서를 순서대로 읽는다.

1. `docs/SERVICE_OVERVIEW.md`
2. `docs/PRODUCT_PRD.md`
3. `docs/FEATURE_SPEC.md`
4. `docs/USER_FLOWS.md`
5. `docs/WIREFRAMES.md`
6. `docs/DESIGN_V2.md`
7. `docs/PRODUCT_REVIEW.md`
8. `docs/TRACEABILITY_MATRIX.md`

시각 참고 이미지는 `docs/design-references/clean-couple-ui-reference.jpg`다. 해당 이미지의 브랜드·캐릭터·로고·카피·화면을 복제하지 말고 visual density, information hierarchy, spacing rhythm, editorial timeline, low-chrome interface, restrained color application만 참고한다.

기능·제품 범위는 `PRODUCT_PRD.md`와 `FEATURE_SPEC.md`, 시각 표현은 `DESIGN_V2.md`의 **확정된 시각 개정(2026-08-08)**을 최우선 기준으로 사용한다.

## 디자인 포지셔닝

**Intimate Editorial Utility — 친밀한 에디토리얼 도구**

곰신로그는 카드가 많은 커플 대시보드가 아니다. 상대의 실제 하루를 편집된 타임라인처럼 빠르게 읽고, 일정과 여행에서 필요한 결정을 즉시 실행하는 content-first relational utility다.

다음 원칙을 전 화면에 적용한다.

- `Content-first hierarchy`: 사진·음성·시간·사용자 원문이 자동 제목·요약·추천·감정 배지보다 높은 위계를 가진다.
- `Progressive disclosure`: 기록 유형 선택 → 필요한 입력 → 공개 범위·최종 확인 순서로 노출한다.
- `Surface economy`: 반복 정보는 카드 대신 list row + divider 또는 editorial timeline으로 표현한다.
- `Low-chrome`: 중첩 카드, 과도한 테두리·그림자·gradient·pill·장식적 이모지를 제거한다.
- `Compact readability`: 글자를 무조건 줄이지 않고 과도한 제목·패딩·카드 높이·빈 공간을 줄인다.
- `Visual footprint ≠ hit target`: 컨트롤은 컴팩트하게 보이되 실제 hit target은 최소 44×44px이다.
- `Semantic chroma`: 코랄=관계·primary action, 블루=계획, 민트=완료, 옐로=확인 필요, 빨강=오류·삭제로 고정한다.
- `Authentic over synthetic`: 사용자의 실제 콘텐츠보다 앱 생성 문구가 앞서지 않는다.

## 화면별 필수 결과

### 곰신 홈

- 글·사진/영상·음성·반응을 고르는 compact capture launcher를 최상단에 둔다.
- 대형 4분할 기능 타일과 긴 인라인 입력 폼을 사용하지 않는다.
- 바로 아래에 오늘의 실제 기록 일부를 보여주고 축소형 D-Day를 보조 정보로 둔다.
- 일반적인 AI 감성 인사말이나 큰 요약 카드가 실제 기록보다 앞서지 않는다.

### 군화 홈

- 기본 구조는 `통화 전 60초 → 상대방의 오늘 → 축소형 D-Day` 세 영역이다.
- 브리핑은 최대 3건이며 판단 정보만 제공한다.
- `상대방의 오늘`은 실제 사진·음성·원문을 보여주는 근거 영역이다.
- 390×844 첫 화면에서 `여기까지 확인`과 실제 기록 일부가 동시에 보여야 한다.
- 파생 위젯은 삭제하지 않고 `더 보기` 또는 위젯 추가에서 접근시킨다.

### 기록

- 메신저 말풍선과 개별 대형 카드 대신 editorial timeline을 적용한다.
- 읽기 순서는 `날짜 → 시간 → 미디어 → 사용자 원문 → 작성자·공개 범위·상태`다.
- 목록 원문은 2~3줄, 상세에서 전체 내용을 제공한다.
- 작성자와 공개 범위를 색만으로 구분하지 않는다.
- 브리핑에서 이동하면 해당 timeline row를 명확하게 강조한다.

### 일정·할 일·여행

- 일정과 장소마다 큰 독립 카드를 반복하지 않는다.
- 시간, 제목·장소명, 담당자·영업시간, 상태를 빠르게 스캔할 수 있는 행으로 표현한다.
- 여행에서는 기존 OCR, 직접 입력, 링크, 체크리스트, 자동·수동 정렬을 유지한다.
- 유료 API 또는 생성형 AI API를 새로 추가하지 않는다.

### 온보딩·우리·복무·마이·설정

- 같은 type scale, spacing rhythm, semantic color와 low-chrome list pattern을 사용한다.
- 한 화면의 주요 결정은 하나만 강조한다.
- 삭제·연결 해제 등 파괴적 행동은 일반 저장 동작과 명확히 분리한다.

## 디자인 토큰 기준

- spacing: 4, 8, 12, 16, 20, 24px
- gutter: 390px에서 16~20px, 320px에서 14~16px
- control radius: 약 12px
- meaningful surface radius: 약 16px
- display 26/32·700
- page title 22/30·700
- section title 17/24·600
- body emphasis 16/24·600
- body 15/22·400
- label 13/18·500
- caption 12/16·400
- primary CTA visual height 48px
- 일반 control visual height 40~44px
- bottom navigation 56~60px + safe-area
- elevated surface 최대 3개, primary CTA 최대 1개, 주요 강조색 최대 2개

## 구현 제약

- 기존 라우트, 인증, 저장 계약, Supabase 스키마, RLS, 개인정보 규칙을 임의로 변경하지 않는다.
- 비공개 범위와 작성자별 수정·삭제 권한을 약화하지 않는다.
- 디자인 단순화를 이유로 기존 기능을 삭제하지 않는다.
- 운영 DB, Supabase, Vercel 설정과 시크릿을 변경하지 않는다.
- 다크 모드, 키보드 조작, `focus-visible`, reduced motion을 유지한다.
- 새로운 사용자 입력이나 미디어를 외부 분석 서비스로 보내지 않는다.

## 구현·검증 순서

1. 현재 UI와 문서의 차이를 화면별로 audit한다.
2. 공통 token과 primitive를 먼저 정리한다.
3. 역할별 홈과 기록 화면을 우선 이관한다.
4. 일정·여행·온보딩·우리·마이·설정을 같은 언어로 이관한다.
5. 320×568, 390×844, 430px에서 라이트·다크 모드와 긴 한국어를 확인한다.
6. horizontal overflow, clipped CTA, sticky layer 충돌을 검사한다.
7. 기존 회귀 테스트를 보존하고 필요한 접근성·레이아웃 테스트를 추가한다.
8. `npm run verify`를 실행한다.
9. 주요 화면의 실제 브라우저 캡처를 남겨 문서의 수용 기준과 비교한다.

## Git 처리

- 기존 변경을 보존하는 안전한 디자인 브랜치에서 작업한다.
- 의미 있는 단위로 커밋하고 직접 `master`를 수정하지 않는다.
- PR을 만들고 CI 전체 성공과 mergeable 상태를 확인한다.
- 예상하지 못한 충돌이나 사용자 변경을 발견하면 덮어쓰지 말고 정확히 보고한다.
- CI가 green일 때만 merge commit 방식으로 병합한다.
- force-push와 브랜치 삭제는 하지 않는다.

## 최종 보고 형식

비전공자도 이해할 수 있도록 다음을 보고한다.

1. 어떤 화면이 어떻게 달라졌는지
2. 참고 이미지의 어떤 설계 원칙을 반영했는지
3. 기존 기능과 개인정보 보호가 유지됐는지
4. 실행한 테스트와 결과
5. PR 링크와 병합 여부
6. 사람이 직접 확인해야 하는 항목
