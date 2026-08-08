# Design v2.1 구현 인수인계 (Intimate Editorial Utility)

- 작성일: 2026-08-08
- 브랜치: `design/v2.1-editorial-density`
- 분기 지점: `3207b19` (`design/token-migration`)
- 상태: **기반 작업 완료, 화면 재설계 미착수** — 16개 작업 중 4개 완료
- 권위 문서: `docs/KIRO_DESIGN_IMPLEMENTATION_PROMPT_EN.md`, `docs/DESIGN_V2.md`의 `확정된 시각 개정 (2026-08-08) — 최우선` 절
- 시각 레퍼런스: `docs/design-references/clean-couple-ui-reference.jpg`

## 사람이 읽는 요약

현재 UI가 “시니어 모드 / 업무용 앱 / AI 템플릿”처럼 읽히는 문제를 고치는 작업입니다.
지금까지는 **토큰과 공용 부품만** 바꿨습니다. 글자 크기 체계를 7단계로 다시 잡고, 카드의
그림자와 과한 둥근 모서리·여백을 걷어내고, “반복되는 목록을 카드가 아니라 줄(row)로
표현하는 부품”을 새로 만들고, 하단 탭바를 70px에서 58px로 줄였습니다.

이 변경만으로 앱 전체 글자·모서리·여백이 한 번에 촘촘해집니다. 다만 **각 화면의 구조**
(곰신 홈, 군화 홈, 기록 타임라인, 일정, 여행)는 아직 손대지 않았습니다. 남은 일은 그
화면들을 새 부품으로 다시 조립하는 것입니다.

테스트는 하나도 죽이지 않았습니다. 밀도·색상 변경으로 기준이 달라진 테스트는 삭제하거나
느슨하게 만들지 않고, 새 기준을 검증하도록 이유와 함께 고쳐 썼습니다. 현재 유닛 테스트
1294개 전부 통과합니다.

---

## 1. 이 저장소에서 일할 때의 도구 사용법 (먼저 읽을 것)

`npm` 래퍼가 이 셸에서 동작하지 않는다. 바이너리를 node로 직접 호출한다.

```
node node_modules/typescript/bin/tsc -b --force
node node_modules/eslint/bin/eslint.js . --max-warnings 0
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader runner
node node_modules/@playwright/test/cli.js test --config playwright.config.ts
```

Vitest 출력은 ANSI 이스케이프가 많아 그대로는 읽을 수 없다. 파일로 받고 이스케이프를 지운다.

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader runner > out.txt 2>&1
$t = (Get-Content out.txt -Raw) -replace "\x1b\[[0-9;]*m",""
$t -split "`n" | Where-Object { $_ -match "Test Files|Tests  |failed" }
```

디자인 프리뷰 캡처(스크린샷 + 가로 오버플로 감사):

```
node node_modules/vite/bin/vite.js build --config design-preview/vite.config.ts --outDir <dist>
node design-preview/capture.mjs <dist> design-preview/captures
```

**기준선: 유닛 테스트 98파일 / 1294개 전부 통과.** 작업 종료 시 이 숫자가 유지되어야 한다.

---

## 2. 완료된 작업

### 커밋 `5e2e749` — 디스크에만 있던 작업물 보존

코드를 만지기 전에, 커밋되지 않은 문서와 추적되지 않던 파일을 먼저 커밋해 보존했다.
`DESIGN_V2.md`(v2.1, 확정된 시각 개정 포함), `SERVICE_OVERVIEW.md`,
`TRACEABILITY_MATRIX.md`, 구현 브리프 2종, 재작성된
`PRODUCT_PRD` / `FEATURE_SPEC` / `USER_FLOWS` / `WIREFRAMES` / `PRODUCT_REVIEW`,
시각 레퍼런스 이미지, 독립 실행되는 `design-preview/` 하네스.

### 커밋 `bf091d2` — 토큰과 공용 프리미티브

**타입 스케일 (`src/styles/index.css`)** — 6단계에서 7단계로. 이름은 유지하고 값만
재조정했으므로 기존 573개 사용처가 자동으로 촘촘해진다.

| 유틸리티 | 크기/행간/굵기 | 용도 |
| --- | --- | --- |
| `text-display` | 26/32/700 | D-Day 같은 숫자. 화면당 1개 이하 |
| `text-title` | 22/30/700 | 화면 제목 |
| `text-heading` | 17/24/600 | 섹션·카드 제목 |
| `text-emphasis` | 16/24/600 | **신규.** 브리핑 핵심, 중요한 사용자 원문 |
| `text-body` | 15/22/400 | 기록 본문, 설명, 입력값 |
| `text-label` | 13/18/500 | 필터, 담당자, 상태, 버튼 라벨 |
| `text-caption` | 12/16/400 | 시간, 메타데이터 |

하한을 13px에서 12px로 **내렸다.** 직전 스케일은 하한을 올리면서 천장도 같이 올려
(28px 숫자, 20px 제목, 모든 본문 16px) 시니어 모드처럼 읽혔다. 대신 사용자 원문은
`body`(15) / `emphasis`(16)로 못박고 테스트가 이 두 값을 지킨다. 12~13px은 시간·상태
같은 메타데이터에만 허용된다.

**반경** — `--radius-control: 0.75rem`(12px), `--radius-surface: 1rem`(16px).
`--radius`를 `0.5rem`으로 재기준화해 이미 쓰이던 `rounded-xl`이 12px,
`rounded-2xl`이 16px에 정확히 떨어진다. `rounded-3xl`(24px) 38곳은 전부
`rounded-surface`로 바꿨고, 재발하면 테스트가 실패한다.

**프리미티브**

- `Card` — 16px 반경, 16px 패딩, **그림자 없음**. 페이지 위에 놓이는 표면이지 떠 있는
  표면이 아니다. 진짜 떠야 하는 표면은 명시적으로 요청해야 한다.
- `Button` — `lg`=48px 주요 CTA, `md`=44px 일반 컨트롤, `sm`=**신규** 36px로 그리되
  `::before` 오버레이로 히트영역 44px 유지. 보이는 크기와 터치 영역을 분리한 것이 핵심.
- `Badge` — `caption`/700 → `caption`/500. 모든 메타데이터에 굵은 pill을 붙이는 것이
  반복 행을 “생성된 템플릿 카드”처럼 보이게 한 원인이었다.
- `src/components/ui/List.tsx` — **신규 파일.** `SectionHeader`, `RowGroup`, `ListRow`,
  `PressableRow`, `TimelineRow`, `TimelineDateHeader`. 반복 데이터를 카드 하나씩이 아니라
  줄로 표현하기 위한 어휘. 모든 누를 수 있는 행은 최소 44px.
  `TimelineRow`의 열 폭은 시간 44px, 미디어 `w-[68px] min-[360px]:w-[76px]`로
  `기록의 에디토리얼 타임라인 문법` 표를 그대로 구현한 것이다.
- `MobileShell` 탭바 — 70px → **58px + safe-area**, 아이콘 21px, 그림자 제거, 활성
  라벨 아래 중복 코럴 인디케이터 바 삭제. 활성색은 `text-coral-strong`(대비 확보).
  `<main>`의 `pb-24` → `pb-20`. 탭바 높이는 여전히 실측되어
  `--gomsin-tabbar-height`로 공개되므로 오프라인 배너·플로팅 CTA가 자동으로 따라온다.

**갱신한 테스트 (약화 아님)**

- `src/lib/typeScale.test.ts` — 7단계로 갱신. 각 단계의 **행간과 굵기까지** 검증하도록
  강화했고, 하한 12px과 함께 `body=15` / `emphasis=16`을 명시적으로 못박아 이후 “조금만
  더 줄이자”가 사용자 문장에 닿지 못하게 했다. 본문 두 단계의 행간 1.4 이상 검증 추가.
  24px 블롭 반경이 돌아오지 않는지 검사하는 가드 추가(주석은 스캔에서 제외).
- `src/lib/coralContrast.test.ts` — 삭제된 탭 인디케이터 항목을 인벤토리에서 제거하고,
  새 타임라인 점(`w-1.5 h-1.5 rounded-full bg-coral`) 항목을 사유와 함께 추가.

**검증 결과 (실제 실행함)**

```
node node_modules/typescript/bin/tsc -b --force        -> exit 0
node node_modules/eslint/bin/eslint.js . --max-warnings 0 -> exit 0
전체 유닛 스위트                                       -> Test Files 98 passed, Tests 1294 passed
```

---

## 3. 남은 작업

아래 4개 그룹은 **파일이 겹치지 않으므로 병렬로 진행할 수 있다.** 각 그룹의 상세 지시는
5절에 그대로 옮겨 두었다.

| # | 작업 | 상태 |
| --- | --- | --- |
| 5 | 곰신 홈 재설계 | 미착수 |
| 6 | 군화 홈 재설계 | 미착수 |
| 7 | 기록 타임라인을 에디토리얼 타임라인으로 | 미착수 |
| 8 | 일정 + 공유 할 일을 시간순 행으로 | 미착수 |
| 9 | 여행(목록·상세)을 컴팩트 일정표로 | 미착수 |
| 10 | 온보딩·우리·서비스·마이·설정에 같은 언어 적용 | 미착수 |
| 11 | 밀도·색상 변경에 영향받는 테스트 갱신 | 부분 완료 (토큰 관련만) |
| 12 | `verify` + e2e + 320/390/430 + 라이트/다크 검증 | 미착수 |
| 13 | 캡처 스크린샷을 수용 기준과 대조하는 시각 리뷰 | 미착수 |
| 14 | 레퍼런스 경로와 적용 원칙을 디자인 문서에 기록 | 미착수 |
| 15 | 리뷰 가능한 단위로 커밋, PR, CI green 확인 후 merge commit 병합 | PR 생성됨, 병합 전 |
| 16 | 비기술 최종 보고서 | 미착수 |

---

## 4. 다음 담당자가 반드시 지켜야 할 것

### 읽기 전용 (이미 완료됨, 고치지 말 것)

```
src/styles/index.css
src/components/ui/Card.tsx  Button.tsx  Badge.tsx  List.tsx  EmptyState.tsx  Skeleton.tsx
src/components/MobileShell.tsx
src/lib/typeScale.test.ts  themeTokens.test.ts  paletteMigration.test.ts  coralContrast.test.ts
```

이 중 하나를 반드시 바꿔야 한다고 판단되면, 고치지 말고 **왜 그런지 보고**할 것.

### 살아남아야 하는 테스트 훅

- 기록 행의 열기 버튼은 실제 `<button>`이며 접근 이름이 `자세히 보기`로 끝나야 한다.
  `e2e/renderedTypeScale.spec.ts`가 `button[aria-label$="자세히 보기"]`로 선택한다.
- 기록 본문은 `data-testid="record-log"`를 유지한다.
- **시간을 클릭하면 상세 모달이 열려야 한다.** `recordAuthorDistinction.test.tsx`가
  `'08:00'` 텍스트를 클릭한다. 즉 시간은 열기 버튼 안에 있어야 한다.
- 목록 내 인라인 미디어 재생이 유지되어야 한다. `AttachmentMedia variant="timeline"`이
  `<video controls>` / `<audio controls>`를 그리고 `recordMediaPlayback.test.tsx`가 덮는다.
  `<button>`은 컨트롤을 자손으로 가질 수 없으므로 **미디어는 열기 버튼 밖**이어야 한다.
- `#record-{id}` 요소의 `data-author-role` / `data-author-own` 유지.
- `src/pages/keyboardOperableCards.test.tsx`는 div/span/li의 `onClick`을 금지한다.
- `e2e/renderedTypeScale.spec.ts`는 아직 **하한 13px, 본문 16px**을 검증한다. 타임라인을
  다시 만들 때 **12px / 15px로 내려야 한다.** (이 파일은 7번 작업의 담당 범위다.)
- `e2e/semanticSurfaces.spec.ts`는 `/record /schedule /my /settings /us /trips`를 돌며
  `bg-warning-surface` `bg-info-surface` `bg-success-surface` `bg-info` `bg-destructive`
  `bg-lilac`를 지닌 요소의 라벨 대비를 **양 테마에서** 실측한다. 남기는 틴트는 4.5:1을
  통과해야 한다.

### 기록 타임라인의 어려운 문제 (7번 작업)

`src/lib/recordAuthor.ts`는 작성자를 **3중 채널**로 구분한다. 색상이 유일한 신호가 되지
않게 하려는 의도(WCAG 1.4.1)이며, 남성 약 8%가 색각 이상이라는 근거가 주석에 있다.

1. 색조 — 역할별 좌측 스트라이프 (`bg-coral` / `bg-info`)
2. **위치 — `alignClass` `ml-auto`/`mr-auto` + `max-w-[94%]`**
3. 텍스트 — `🌸 곰신 · 춘향` 칩 + `sr-only` 문장

**채널 2는 채팅 말풍선 문법이고 에디토리얼 타임라인과 충돌한다.** 94% 폭을 좌우로 밀면
고정 시간 열이 무너지는데, 그 열은 문법 전체가 의존하는 성질이다. 그래서 채널 2는
**버리는 것이 아니라 교체**해야 한다. 색상 아닌 채널이 최소 2개 남아야 한다.

교체안: **소유권을 기준으로 한 기하학.** 타임라인 노드 마커의 *모양*을 다르게 한다.
내 기록은 채운 점, 상대 기록은 같은 지름의 빈 링. `recordAuthorPresentation`에
`markerClass`를 추가하고(`stripeClass`는 역할 기준 유지, 마커는 소유권 기준),
파일 주석에 교체 이유를 남긴다. `recordAuthorDistinction.test.tsx`의
`channel 2 -- position` 테스트를 `channel 2 -- geometry`로 고쳐 쓰되, 들여쓰기가 왜
사라졌는지 주석으로 설명한다. 나머지 단정은 전부 그대로 통과해야 한다.

행 구조 제안 (시간 클릭과 인라인 재생을 동시에 만족):

```
<li class="relative">                      ← #record-{id}, data-author-*
  <button aria-label="… 자세히 보기">      ← 시간 열 + 미디어 폭 투명 스페이서 + 본문 열
  <div class="absolute left-[54px] … z-10"> ← 미디어. 버튼의 형제, 스페이서 위에 겹침
</li>
```

`54px = 시간 열 44px + 간격 10px`. 실제로 쓰는 간격에 맞춰 산수를 다시 확인할 것.
더 깔끔한 구조를 찾으면 그것을 쓰고, 무엇을 왜 바꿨는지 밝힐 것.

### 절대 바꾸지 않는 것

- 라우트, 인증, 영속화 계약, Supabase 스키마, RLS, 권한, 프라이버시 동작
- 비공개 기록 격리, 작성자 전용 수정·삭제 권한
- 프로덕션 DB / Supabase 설정 / Vercel 설정 / 도메인 / 시크릿
- 다크 모드, 키보드 조작, 보이는 포커스 링, 접근 이름, `prefers-reduced-motion`
- 주기 기능의 공유 대상·만료·철회 로직. `CycleTrackerSection`은 작성자가 아니면
  섹션 자체를 렌더링하지 않는다(“권한 없음” 안내조차 데이터 존재를 암시하므로).
- 감정 표현의 비정량화: 텍스트 칩 + 중성 배경. 감정별 고정색·수치 축·꺾은선·점수 금지.
- 새 외부 분석, 새 유료 API, 생성형 AI API 도입 금지
- 기능을 “단순화”를 위해 제거하지 않는다. 오늘 동작하는 것은 전부 계속 동작해야 한다.

### 디자인 시스템 요약 (화면 작업 시 이것만 보면 됨)

- 간격은 4 / 8 / 12 / 16 / 20 / 24px만. 좌우 gutter 390px에서 16~20px, 320px에서 14~16px.
  같은 행 내부 8px, 그룹 내 행 사이 12px, 섹션 사이 20~24px. **큰 카드 사이의 큰 빈
  공간으로 위계를 만들지 않는다.**
- 화면당 elevated surface 최대 3개, 주요 CTA 최대 1개, 강조색 최대 2개.
- 반복 데이터는 절대 카드 하나씩이 아니다. `List.tsx`의 부품을 쓴다.
- 모든 조작의 히트영역 44×44px 이상. 보이는 컨트롤을 키우지 말고 히트영역을 넓힌다.
- 의미색: 코럴=관계·주요 행동, `info`=계획, `success`=완료, `warning`=확인 필요·비공개,
  `destructive`=오류·파괴. 원시 팔레트(`bg-blue-500` 등) 사용 시 빌드 실패.
  글자를 얹는 코럴 채움은 `bg-coral-strong` + `text-coral-strong-foreground`.
  맨 `bg-coral`은 틴트·테두리·점 전용이며 새로 쓰면 `coralContrast.test.ts`가 실패한다.
- 색은 항상 두 번째 신호. 작성자·공개 범위·상태를 먼저 글자나 아이콘으로 말한다.
- 320×568에서 가로 오버플로·잘린 CTA 금지. 긴 한국어는 `break-keep`으로 리플로.

### 테스트를 고쳐야 할 때의 규칙

옛 표현을 검증하는 테스트를 만나면, **같은 의도로 새 표현을 검증하도록 고쳐 쓴다.**
설명 주석을 유지하고 표현이 왜 바뀌었는지 덧붙인다. 테스트를 삭제하거나 통과시키려고
느슨하게 만들지 않는다. **동작·프라이버시·권한을 검증하는 테스트는 건드리지 않는다.**

---

## 5. 남은 4개 작업 그룹의 상세 지시

파일이 겹치지 않으므로 동시에 진행 가능하다. 각 담당자는 4절을 먼저 읽어야 한다.

### 그룹 A — 기록 타임라인

담당 파일: `src/pages/RecordPage.tsx`, `src/lib/recordAuthor.ts`,
`src/pages/recordAuthorDistinction.test.tsx`, `e2e/renderedTypeScale.spec.ts`,
(썸네일 크기를 바꿔야 할 때만) `src/components/AttachmentMedia.tsx`

- 채팅 말풍선/반복 카드를 에디토리얼 타임라인으로 교체.
  읽기 순서 `날짜 → 시간 → 미디어 → 작성자·원문 → 공개/상태 → 보조 행동`.
- 열 폭: 시간 44px(`w-11`, 우측 정렬, `text-caption` + `tabular-nums`),
  미디어 `w-[68px] min-[360px]:w-[76px]` 정사각, 본문은 나머지(`min-w-0`).
- 사진·음성 없는 텍스트 기록은 **미디어 열을 아예 제거**한다. 빈 박스를 남기지 않는다.
- 목록에는 원문 2~3줄(`line-clamp-3`), 전체는 상세에서. **기록별 자동 제목을 만들지 않는다.**
- 날짜 제목은 날짜가 **바뀔 때만** (`TimelineDateHeader`).
- 감정·반응·AI 요약 chrome을 줄여, 첫 시선이 배지가 아니라 실제 미디어와 사용자 문장에
  가게 한다.
- 3중 작성자 채널 문제는 4절 참조.
- 플로팅 CTA는 화면의 유일한 주요 CTA로 48px. `--gomsin-tabbar-height` /
  `--gomsin-bottom-banner-height`에서 위치를 계산해 오프라인 배너와 절대 겹치지 않게 유지.
- 미디어 필터 칩과 라일락 `빠른 정리` 블록은 사용자 실제 기록 위에 놓인 앱 생성 chrome이다.
  압축하되 **모든 필터를 유지**하고, 브리핑에서 진입할 때의 스크롤 + `record-highlighted`
  펄스 동작을 유지한다.
- `e2e/renderedTypeScale.spec.ts`의 `CAPTION_FLOOR_PX`를 12로, `BODY_PX`를 15로 내리고
  행간 1.4 이상은 유지. 하한이 왜 내려갔고 15~16px이 왜 보호 구간인지 주석에 남긴다.

### 그룹 B — 두 역할의 홈

담당 파일: `src/features/home/WidgetDashboard.tsx`, `src/components/widgets/*.tsx`,
`src/lib/widgets.tsx`, `src/lib/widgetComponents.tsx`, 해당 디렉터리의 테스트 파일

**곰신 홈**

- 상단에 4개 기록 유형(글·사진/영상·음성·반응)의 **컴팩트한 캡처 런처**. 현재는
  `py-4 rounded-2xl … min-h-[60px]` 타일 4개 + 긴 인라인 컴포저이고
  `TodayLogWidget.tsx`는 32KB짜리 인라인 폼이다. 큰 타일 4개를 컴팩트한 유형 컨트롤 한
  줄로 바꾸되 **4개 유형과 기존 입력 경로 전부 유지.**
- Progressive disclosure: 홈에는 유형 선택과 핵심 맥락만. 감정·공개 범위·`통화 때 꼭 얘기`는
  유형을 고른 뒤 필요한 단계에서 공개한다. **첫 페인트에 빈 입력창을 두지 않는다**
  (빈 입력창은 그 자체로 과제로 읽힌다).
- 런처 **바로 아래**에 오늘의 **실제** 기록 미리보기.
- D-Day는 컴팩트한 보조 정보. 화면에서 가장 큰 요소가 되면 안 된다.
- 앱 생성 감성 인사말, 큰 생성 요약 카드를 실제 콘텐츠 위에 두지 않는다.
- 수용 기준: 390×844에서 기록 유형 선택 + 오늘의 실제 기록 일부 + 축소형 D-Day가 보인다.

**군화 홈**

기본 위계는 정확히 3개, 이 순서: `통화 전 60초` → `상대방의 오늘` → 축소형 전역 D-Day.

- 브리핑 항목은 **최대 3개.** 브리핑은 **결정 표면**이다. 제목·설명을 줄이고 항목은
  시간·배지·내용이 1~2줄에 들어가는 간결한 리스트로, `여기까지 확인`만 유일한 채움
  주요 CTA로 남기고 나머지는 `더 보기`로 접는다.
- `상대방의 오늘`은 **근거 표면**이며 상대의 실제 사진·음성·원문을 담아야 한다.
- **강한 수용 기준: 390×844에서 브리핑 완료 행동과 상대의 실제 기록 일부가 스크롤 없이
  같은 첫 뷰포트에 보여야 한다.** 지금은 브리핑 카드 하나가 화면 대부분을 차지한다.
  수직 공간을 예산으로 잡고, 첫 실제 기록까지의 렌더 높이 합계를 최종 보고에 적는다.
- 기본값에서 내려오는 4개(`partner_emotion_flow` `partner_emotion_summary` `care_hint`
  `today_word`)는 **코드를 전부 유지**하고 `더 보기` / 위젯 관리 / 상세 화면으로 계속
  도달 가능해야 한다. 위젯 레지스트리에서 제거하지 않는다.

**공통** — 위젯마다 독립 카드인 현재 구조에 surface economy 적용(화면당 elevated surface
3개 이하, 반복 행은 `List.tsx` 부품으로). 배지·파스텔 틴트 수를 절반 가까이 줄인다.
감정은 중성 배경의 텍스트 칩. 위젯 드래그 정렬·편집 모드와 `animate-wiggle`의
reduced-motion 처리를 유지한다.

### 그룹 C — 일정, 공유 할 일, 여행

담당 파일: `src/pages/SchedulePage.tsx`, `src/pages/TripsPage.tsx`,
`src/pages/TripDetailPage.tsx`, `src/components/PlanSectionNav.tsx`, 해당 테스트 파일

**일정 + 공유 할 일**

- 일정·할 일마다 큰 카드를 주지 않는다. 시간이 먼저, 그다음 제목·유형·담당자·상태인
  스캔 가능한 시간순 행. `ListRow` / `PressableRow` / `RowGroup` 사용.
- 시간·날짜가 가장 먼저 읽혀야 한다. 고정 좌측 열에 `text-caption` + `tabular-nums`.
- 공유 여부와 `꼭 얘기`는 작은 보조 배지(`text-caption` 500)이며, 행에서 가장 시끄러운
  요소가 아니다. 색상 외에 글자나 아이콘으로도 말해야 한다.
- 따뜻하고 가벼워야 한다. 촘촘한 회색 표, 모든 필드마다 상태 pill = 업무 앱.
- 달력 그리드는 유지하되 날짜 셀과 월 이동 컨트롤의 히트영역 44px 이상. 보이는 셀이
  44px보다 작다면 셀을 키우지 말고 히트영역을 넓힌다.
- 유지: 비공개/공유 일정, 담당자, 완료 토글, 일정 상세 모달(탭바 위에 오도록 `z-[60]`이
  의도된 것이다), 공유 할 일 CRUD 전부.

**여행**

- 여행과 각 날짜의 장소를 **컴팩트한 일정표**로. 시간·장소명·영업시간·주소·확정 상태·순서가
  한 행에서 스캔 가능해야 한다.
- 장소마다 독립적인 고강조 카드를 주지 않는다. 날짜별 시간순 리스트 하나, 장소 사이
  divider, 날짜는 섹션 헤더.
- 순서 변경 컨트롤은 작고 단정하게. 히트영역 44px의 컴팩트 아이콘 버튼.
- 체크리스트는 평범한 iOS 리스트 행(체크박스·라벨·담당자)처럼.
- **동작 변경 없이 그대로 보존:** OCR 장소 캡처(`tesseract.js`, `src/lib/placeOcr.ts`),
  직접 입력, 외부 링크, 체크리스트, 자동 정렬, 수동 순서 변경. 유료 API·생성형 AI 금지.
  `src/lib/tripPhase.ts`의 여행 단계 계산 변경 금지.

**공통** — `info`/`info-surface`가 계획의 색. 코럴은 관계와 유일한 주요 행동. 한 표면에서
코럴과 info가 경쟁하지 않게 한다. 320px에서 이 행들이 앱에서 가장 넓다
(시간+제목+담당자+상태+chevron). 가로 오버플로·잘린 CTA 금지, 긴 한국어 장소명은
의도적으로 리플로 또는 말줄임.

### 그룹 D — 온보딩, 우리, 서비스, 마이, 설정

담당 파일: `src/pages/OnboardingPage.tsx` `UsPage.tsx` `ServicePage.tsx` `MyPage.tsx`
`SettingsPage.tsx` `LegalPage.tsx`, `src/components/CycleTrackerSection.tsx`
`CycleSupportSection.tsx` `CoupleStatusBanner.tsx` `EmotionFlowSummarySection.tsx`
`EmotionFlowInsightCard.tsx` `EmotionChipEditor.tsx` `RecordEmotionCorrection.tsx`,
해당 테스트 파일

- 같은 타입 스케일·간격 리듬·의미색·low-chrome 리스트 패턴 적용.
- **화면당 주요 결정 1개**를 강조. 나머지는 텍스트 버튼이나 얇은 보조 버튼.
- 단순 메뉴는 카드가 아니라 리스트 행. `SettingsPage`는 `rounded-3xl` 표면이 14개였고
  `MyPage`는 통계 카드가 있다. 반복 메뉴는 `RowGroup` + `PressableRow`로
  (`boxed`는 그룹 자체가 주제일 때만).
- 통계·D-Day 표면이 `우리`/`마이`의 핵심 관계 맥락을 압도하지 않게 한다.
- 파괴적 행동은 일반 저장 행동과 시각적·행동적으로 분리. `variant="destructive"`,
  별도 그룹, 일반 행동보다 아래, 기존 확인 단계는 그대로.
- 온보딩은 progressive disclosure, 단계당 결정 1개, 단계의 주요 행동이 유일한 48px CTA.
- 프라이버시 규칙은 4절 참조. **표현이 아니라 동작이므로 옮기지 않는다.**
- `ServicePage`의 네이비 히어로는 의도적으로 테마 불변인 `text-white` on `bg-navy`와
  반투명 `bg-white/20` 칩을 쓴다. 테마 불변 의도를 유지하고 크기·반경·밀도만 정렬한다.
- `OnboardingPage`는 여기서 가장 큰 파일(57KB, 스케일 사용 73곳, 반경 사용 36곳)이다.
  섹션 단위로 진행하며 `OnboardingPage.test.tsx`, `onboardingEntryStep.test.tsx`,
  `onboardingMilitaryProvenance.test.tsx`를 자주 재실행한다.

---

## 6. 마무리 절차 (그룹 A~D 이후)

1. 320×568 / 390×844 / 430px, 라이트·다크, 긴 한국어, 글자 확대, safe-area 검증.
2. 가로 오버플로, 잘린 CTA, 겹친 sticky/floating 레이어, 깨진 포커스 순서 점검.
3. 전체 유닛 스위트 + `node node_modules/@playwright/test/cli.js test --config playwright.config.ts`.
4. `design-preview/capture.mjs`로 캡처하고 **PNG를 실제로 열어** 수용 기준과 대조한다.
   `DESIGN_V2.md`의 `시각 수용 기준` 절이 판정 기준이다.
5. `DESIGN_V2.md`에 레퍼런스 이미지 경로와 적용한 원칙을 기록한다. 이미지는 삭제하지 않는다.
6. PR의 CI가 green인 것을 확인하고 **merge commit**으로 병합한다(squash·rebase 금지).
   `master` 직접 수정, force-push, 브랜치 삭제 금지.
7. 비기술 제품 오너가 이해할 수 있는 최종 보고서: 바뀐 화면과 방식, 적용한 레퍼런스 원칙,
   기존 기능·프라이버시 보존 여부, 실행한 테스트와 결과, PR 링크와 병합 상태,
   사람이 직접 확인해야 하는 항목.

## 7. 알려진 미해결 항목

- `docs/kiro/AI_HANDOFF.md` §4.1의 4번: 설정의 `내 기록 JSON으로 내보내기`,
  `내 작성 기록 전체 삭제` 두 버튼에서 포커스 링이 페인트되지 않는다(픽셀 변화 0.00%).
  원인 미확정이며 **추측 수정 금지.** 원인을 확정한 뒤 별도 PR로 처리한다.
- `dev-server.log`가 추적되지 않은 채 작업 트리에 남아 있다. 커밋하지 않았다.
