# [GOMSINLOG CONTROL TOWER] V4 제품·UX·Engineering Audit

- 감사 일시: 2026-09-02 KST
- 작업 위치: `/Users/han-yejun/Desktop/gomsinlog-sol-rc-v4`
- Branch: `codex/sol-gomsinlog-rc-v4`
- 감사 기준 HEAD: `c09f7a485e127d1d9b6ccff7923ed0797a36dcf3`
- Upstream/base: `origin/codex/diary-garden-shop-v2` / `3373ee2f7e4044c89946988cbb12068de0c7cfc3`
- live `origin/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`
- 활성 점유: `sol-ultra` 1건. 다른 활성 AI 점유 없음.
- 원격 mutation: 없음

## Current State

### 한 문장 정의

> 곰신로그는 함께하지 못한 하루를 부담 없이 복구해 실제 대화로 이어주고, 둘이 직접 고른 시간을 사적인 기억으로 축적하는 커플 기록 앱이다.

### 핵심 고객과 문제

- 첫 진입 고객은 군 복무로 생활시간이 크게 어긋난 커플이다.
- 실제 사용자는 군화와 곰신 둘 다이며, 초기 구매 의사결정자는 곰신일 가능성이 높다.
- 장기 고객 범위는 군 복무에 한정하지 않고 교대근무, 장거리, 유학처럼 생활시간이 비대칭인 커플이다.
- 해결하려는 문제는 대화량을 늘리는 것이 아니라, 서로 놓친 맥락을 짧은 시간 안에 되찾고 다음 실제 대화를 쉽게 시작하게 하는 것이다.

### 핵심 사용자 흐름

```text
가볍게 기록
→ 상대방의 오늘
→ source-grounded 요약 항목
→ recordId가 가리키는 정확한 원본
→ 이따 이야기하기
→ 통화 전 모아보기
→ 실제 대화
→ 둘만의 기억 축적
```

이 흐름은 코드에서 실제로 연결돼 있다. `StoryRoute → projectStory → summary line.recordId → /record?record=<id>`와 `talkAboutMarks → /saved → /call` 경로가 핵심 계약이다.

### 현재 5개 탭과 질문

| 탭 | 실제 route | 답해야 하는 질문 | 코드 판단 |
|---|---|---|---|
| 홈 | `/home` | 지금 상대와 나에게 가장 중요한 것은 무엇인가? | 상대 Story, 최근 7일, 대화 주제·통화 진입이 연결됨 |
| 찾기 | `/search` | 날짜·내용·복무 맥락에서 필요한 기록을 어떻게 찾는가? | 검색, 역할별 복무/주기 surface가 연결됨. 현재 역할이 과다함 |
| 일기장 | `/diary` | 우리가 남긴 시간을 월별로 어떻게 다시 읽고 꾸미는가? | 월 기록, 정원, 무료 상점 연결됨 |
| 일정 | `/schedule` | 앞으로 함께 기다리고 준비할 것은 무엇인가? | 일정, 할 일, 여행 연결됨 |
| 우리 | `/us` | 우리가 함께 쌓은 것과 관계 설정을 어디서 보는가? | 프로필, 게시물, 사진, 여행, 설정 진입이 연결됨 |

`/compose`는 탭이 아니라 기록 작성 action route다. `/record`는 검색·요약에서 도착하는 정확한 원본 화면이다.

## Findings

### 기능 Inventory

증거 표현은 다음처럼 구분한다.

- **코드에서 확인됨**: 실제 route와 call path가 연결됨
- **테스트로 확인됨**: 이번 기준 트리에서 명령을 실행해 통과함
- **문서에만 계획됨**: 구현 또는 사용자 경로를 확인하지 못함
- **로컬에만 존재함**: 저장소/기기 로컬 기능이며 원격 운영 증거가 아님
- **원격 상태 미확인 / UNVERIFIED**: 현재 remote catalog, CI, 실기기 또는 Production을 조회하지 않음
- **Production 적용 확인됨**: 이번 감사에서 현재 상태를 직접 확인한 경우만 사용. 이번 감사에는 해당 항목 없음

| 영역 | 실제 상태 | 판정 | 결정 |
|---|---|---|---|
| 인증·온보딩·커플 연결 | route, session restore, create/join, connected/disconnected 경계가 코드에서 확인됨 | 코드에서 확인됨; 실제 두 계정 UNVERIFIED | KEEP |
| 가볍게 기록 | `/compose`, `/record?compose=1`, private/shared, 미디어, offline outbox가 연결됨 | 코드에서 확인됨; 작성/공유 브라우저 회귀 통과 | KEEP |
| 상대방의 오늘 | `/story/partner`, PartnerDay receipt, readable projection이 연결됨 | 코드에서 확인됨 | KEEP |
| 요약 → 정확한 원본 | 요약 line이 원래 `recordId`를 유지하고 `/record?record=`로 이동 | 코드에서 확인됨; 관련 Vitest 존재/통과 기준 포함 | KEEP |
| 이야기할 것·통화 | mark, `/saved`, `/call`, 최대 3개 briefing과 원본 이동 | 코드에서 확인됨 | KEEP |
| Home 최근 기록 | 현재 active partner, visibility, content availability 경계를 사용 | 코드에서 확인됨; focused test 통과 | KEEP / IMPROVE |
| 찾기 | 날짜·본문 검색, 군화 복무 정보, 곰신 주기/응원 신호 | 코드에서 확인됨; 한 화면의 책임이 과다 | IMPROVE |
| 일기장 | 월 요약과 기록 페이지 assembly, local paper/layout metadata | 코드에서 확인됨; 320/390/430 browser 통과 | KEEP / IMPROVE |
| 정원 | `/diary/garden`, 두 캐릭터 bounded motion, drag/keyboard/reduced motion | 코드에서 확인됨; Garden browser 3/3 및 focused test 통과 | KEEP / IMPROVE |
| 무료 상점 | 계정별 local ownership, 하루 1회 중복 없는 무료 뽑기 | 로컬에만 존재함; focused test 통과 | MERGE into Diary/Garden |
| 정원 액세서리 | 기존 equipped 값은 렌더링하나 새 뽑기 결과를 장착하는 현재 UX가 없음 | 코드에서 확인됨 | IMPROVE |
| 일정·할 일 | 월 달력, 일정, task CRUD | 코드에서 확인됨; direct DB boundary가 Store와 혼재 | KEEP / IMPROVE |
| 여행 | `/trips`, `/trips/:id`, 지도 screenshot import, 일정 연계 | 코드에서 확인됨; keyboard dialog browser 통과 | KEEP |
| 우리 프로필 | 커플 profile, stats, profile post/photo/trip 탭, profile edit | 코드에서 확인됨 | KEEP / IMPROVE |
| `/me`, `/my`, `/service` | 기능은 존재하지만 `/us` 하위 의미가 중복·분산 | 코드에서 확인됨 | MERGE gradually |
| 사진 | re-encode/thumbnail/gallery/upload 경로와 테스트 존재 | 코드에서 확인됨; media browser 7/7 통과 | KEEP / IMPROVE |
| 영상·음성 | 일부 저장·재생 경로가 코드에 있으나 V4 핵심 범위 및 운영 완료 증거 없음 | 코드 일부 확인, 운영 UNVERIFIED | DEFER |
| 건강·주기 | 명시적 consent 후 owner data, sanitized support projection | 코드에서 확인됨; consent 전 무접촉 browser 통과; remote RLS UNVERIFIED | KEEP / HIGH-RISK REVIEW |
| 알림 설정 | 앱 내 preference UI와 exact build flag가 존재 | 코드에서 확인됨; delivery/token/remote UNVERIFIED | DEFER until delivery gate |
| 온디바이스 AI | 사용자가 Story에서 눌러 실행, line 수·순서·recordId 검증, 실패 시 deterministic 원문 유지 | 코드에서 확인됨; focused tests 통과; 실제 iPhone 품질·발열·배터리 UNVERIFIED | KEEP / optional |
| E2EE | crypto/use-case/repository/settings 연결과 migration이 존재 | 코드·테스트 artifact 확인; 전체 콘텐츠·remote schema·두 기기 ceremony UNVERIFIED | KEEP / separate security gate |
| Realtime·offline | couple-scoped realtime refresh, recovery/quarantine, IndexedDB outbox | 코드에서 확인됨; 장시간/실기기 UNVERIFIED | KEEP / IMPROVE |
| 계정 삭제·unlink | 관련 gate와 cleanup path가 존재 | 코드·테스트 artifact 확인; 현재 Production actor proof UNVERIFIED | KEEP / separate security gate |
| Memory Product / 우리의 한 달 | 사용자가 고른 원본을 편집·인쇄 상품으로 만드는 사업 방향 | 문서에만 계획됨; Book Studio FROZEN | DEFER after RC |
| CloudKit 전체 백업 | 선택 가능한 장기 방향일 뿐 현재 구현 완료 아님 | 문서에만 계획됨 | DEFER |
| 결제·유료 재화·확률형 뽑기 | 현재 구현 방향이 아니며 무료 연결·보존 원칙과 충돌 | 구현하지 않음 | REMOVE from RC scope |
| 관계 점수·streak·숨은 분석·일반 채팅 | 제품 철학과 명시적으로 충돌 | 구현/제안 대상 아님 | REMOVE |

현재 기능을 통째로 삭제할 합리적 근거는 없다. 다만 Search와 Us 하위 화면의 책임을 정리하고, Shop을 Diary/Garden의 보조 surface로 합치는 IA 개선이 필요하다.

### 제품·UX 관찰

이번에 생성한 48개 screenshot은 mock backend를 사용하되 production build를 실제 Chromium에 띄운 결과다.

1. **Home**
   - 장점: 기능 대시보드가 아니라 Story와 상대 기록이 중심이며, 북마크·통화 진입이 얇게 남아 있다.
   - 문제: 기록이 적은 날에는 화면 대부분이 빈 괘선이고, “지금 무엇을 하면 좋은지”가 약하다. 상태 우선순위는 있지만 CTA 위계가 충분히 드러나지 않는다.
2. **Search**
   - 검색, 복무 진행, 레벨/EXP, 응원 신호 또는 주기 정보가 같은 최상위 화면에 이어진다.
   - 복무율과 레벨을 소수점 네 자리까지 표시해 정보보다 시스템 수치가 먼저 보인다. 경쟁 점수는 아니지만 제품 정서상 과도하게 게임화돼 보인다.
3. **Diary**
   - 월 카드가 `기록 3개`를 말하지만 현재 첫 화면에는 실제 기록 페이지/날짜가 보이지 않아 “내용이 없는 화면”처럼 느껴진다.
   - 정원·상점 아이콘의 의미를 처음 사용자가 설명 없이 이해하기 어렵다.
4. **Schedule**
   - 달력, 함께한 날, 빠른 할 일 입력이 한 화면에 모두 있어 유용하지만 밀도가 높다.
   - 375×667에서는 입력 section이 fold에서 잘려도 가로 overflow는 없었다. 우선 행동과 보조 설명의 대비를 더 분명히 해야 한다.
5. **Us**
   - 프로필·게시물·사진·여행 구조는 익숙하지만, 빈 상태에서 통계와 “프로필 편집/만들기”가 관계의 기억보다 먼저 보인다.
   - 연결되지 않은 상태에서 상단에 의미 없는 빈 outline surface가 관찰됐다.
6. **Loading / Error**
   - 모든 탭의 초기 loading이 문맥 없는 전체 화면 spinner 하나로 동일하다. 사용자는 무엇을 불러오는지, 기존 데이터가 안전한지 알 수 없다.
   - records fetch 실패가 “계정 정보를 확인하지 못했어요”로 표현돼 실제 원인과 복구 행동의 의미가 어긋난다.
7. **Visual consistency**
   - 공책·손글씨·Pretendard·선 드로잉이라는 고유 언어는 강하다.
   - 그러나 Service의 navy filled card, Settings의 pink segmented cards, Home/Us의 무배경 pen surface가 서로 다른 제품 세대처럼 보인다.
   - 다크 모드는 대비 기준을 통과하지만 괘선과 외곽선이 시각적으로 강해 콘텐츠보다 구조가 먼저 보이는 화면이 있다.

### 접근성·모바일 증거

- 402×874: 두 역할×5탭×light/dark를 촬영하고 모두 route-ready 확인.
- 375×667: 5개 탭 모두 수평 overflow `≤ 1px` 통과.
- 320/390/430: Diary layout browser regression 통과.
- 모든 조사 route의 interactive target은 effective 44×44 CSS px 이상.
- Cycle calendar와 Trip dialog는 키보드 open/Escape close/focus return 통과.
- rendered caption floor 12px, 사용자 본문 15px 이상과 한글 line-height 비율 통과.
- semantic surfaces는 light/dark 모두 normal text 4.5:1 이상 통과.
- route change announcement, skip link, safe-area/tabbar 측정 코드는 확인됨.
- **UNVERIFIED**: 실제 iPhone VoiceOver rotor/order, iOS Dynamic Type 연동, 200% browser text reflow 전 화면, switch control, 물리 기기 safe area, 햅틱, 색각별 사용성.

### Engineering 구조

장점:

- Presentation → hook/use-case → repository/crypto/Supabase 방향이 E2EE와 일부 feature에 실제로 존재한다.
- active-couple, visibility, content availability, exact provenance를 별도 helper/use-case로 지키는 구조가 있다.
- offline outbox, realtime recovery, route announcement, global sync/error 경계가 있다.
- CI 문서에는 TypeScript, lint, Vitest, Playwright, Edge, migration/security harness, native build 검증이 정의돼 있다.

부채:

- `src/lib/store.tsx` 4,105줄, `src/app/e2ee/useCases.ts` 2,845줄, `OnboardingPage` 1,689줄, `RecordPage` 1,657줄, `SettingsPage` 1,541줄, `SchedulePage` 1,191줄이다.
- 일부 Page/Component가 Supabase helper를 직접 호출해 Store/use-case gate와 오류·stale-session 의미가 분산된다.
- `any`/`as any` 검색 결과가 src 전체 221건이며 테스트용과 runtime을 분리한 정리가 필요하다.
- 의미 토큰·7단계 type scale·radius·spacing·primitive는 이미 있으나 `paper.css`, legacy semantic tokens, Astryx mapping의 세 레이어가 공존한다. 새 디자인 시스템을 처음부터 만드는 일보다 하나로 수렴시키는 일이 맞다.

### Performance

placeholder production build는 통과했지만 다음을 측정 위험으로 고정한다.

- `paper-pair-v1.webp`: 약 1,489 kB. route-lazy이며 initial precache에서는 제외됨.
- CSS: 약 331 kB, gzip 약 67 kB.
- 주요 JS chunk: 약 442 kB/gzip 135 kB, 약 493 kB/gzip 163 kB.
- `RecordMediaGallery`: 약 176 kB/gzip 51 kB.
- self-hosted Pretendard와 handwriting subset은 privacy/CSP에는 유리하지만 실제 iPhone cold-load·memory 영향은 측정하지 않았다.
- initial load, Core Web Vitals, animation CPU, image memory, realtime battery, background behavior는 **UNVERIFIED**다.

### 개인정보·E2EE·Supabase 경계

- 개인 기록, 공유 기록, 사진, 영상, 음성, 일정, 여행 주소, 건강·주기 원본은 민감한 사용자 콘텐츠다.
- private 및 `contentUnavailable` 기록은 상대 요약/통화에 포함하지 않는다.
- 건강 원본은 owner-only이며 상대에게는 명시적 선택으로 만든 sanitized support signal만 전달한다.
- AI는 on-device에서 deterministic lines를 문장 편집하며 원본의 수·순서·recordId를 바꾸면 결과를 거부한다.
- RLS, authenticated owner, active couple, unlink 상태가 서버 권위다. UI filter는 defense in depth이지 권한의 근거가 아니다.
- Full User-Content E2EE + Minimal Server Metadata는 승인된 방향이나, “현재 모든 콘텐츠가 E2EE이고 서버가 아무것도 읽지 못한다”는 완료 주장은 할 수 없다.
- migration 062–067 파일은 저장소에 있다. 파일 존재는 remote 적용 증거가 아니다.
- 2026-08-28 Production 063/064/065/067 적용과 actor matrix가 `CURRENT_STATE`에 과거 증거로 보고돼 있으나 이번 세션에서 current remote catalog를 조회하지 않았으므로 현재 판정은 **원격 상태 미확인 / UNVERIFIED**다.
- 이번 감사에서 Supabase, Vercel, Production, TestFlight, App Store에 mutation을 하지 않았다.

### 현재 사업모델

- 연결과 보존은 무료다.
- 첫 매출 후보는 사용자가 정확한 원본을 직접 골라 만드는 물리/디지털 Memory Product, 우선 “우리의 한 달”이다.
- AI는 선택자나 관계 평가자가 아니라 제목·문장·배치 편집 보조다.
- 저장 용량, 고화질, E2EE, 개인정보 보호, 핵심 연결을 paywall로 만들지 않는다.
- 정원 아이템은 무료이며 결제 재화·확률형 유료 뽑기·streak를 만들지 않는다.
- 초기 subscription-first는 보류하고, 반복 구매 가치가 검증된 뒤 선택형 Plus를 검토한다.

## Document Conflicts / Uncertainty

| 충돌 | 현재 판정 |
|---|---|
| `WHAT_IS_GOMSINLOG.md`가 E2EE를 현재 완료형으로 설명 | 실제 전체 범위·remote·두 기기 검증이 없어 과장. 방향으로만 해석 |
| `WHAT_IS_GOMSINLOG.md`와 `DESIGN_V2.md` 일부가 Home/Record/Schedule/Us/My 5탭을 설명 | 실제 V4는 Home/Search/Diary/Schedule/Us. 코드와 `V4_AS_BUILT` 우선 |
| `V4_AS_BUILT.md`가 Home에서 Story record를 제외한다고 설명 | 현재 승인 코드에서는 Home recent feed에도 Story record를 표시. 문서 stale |
| `CURRENT_STATE.md` 2026-09-02 Garden candidate가 98×112와 Garden 내 꾸미기를 설명 | 현재 branch는 quiet Garden 49×56, Garden 내 Shop/장착 control 제거. 문서 stale |
| `CANON_AMENDMENTS_V4.md` A9와 `V4_BACKLOG.md` 일부 상태 | 현재 코드/완료 표와 prose가 불일치. 구현 증거 우선 |
| `MobileShell.tsx` 상단 역사 주석 | 실제 가운데 탭은 작성 `+`가 아니라 Diary. runtime은 맞고 주석 stale |
| 기존 `e2e/uiAudit.spec.ts` | `/record`, `/my`를 탭으로 촬영하던 stale audit. 이번 감사에서 V4 실제 탭으로 수정 |
| remote/Production 상태 | 과거 적용 보고는 있으나 current read-only 조회를 하지 않음. UNVERIFIED |

## Current Score

| 영역 | 점수 | 근거 |
|---|---:|---|
| Product clarity | 7.6/10 | 핵심 loop와 금지선이 명확하고 코드에 연결됨. Search/Diary/Us 첫 화면 질문은 흐림 |
| IA | 6.8/10 | 실제 5탭은 합리적. Search의 책임 과다, Us 하위 `/me`·`/my`·`/service` 분산 |
| UX | 6.7/10 | 작성→상대 오늘→원본→통화가 작동. loading, sparse Home/Diary, error copy, 발견성이 미완성 |
| Visual consistency | 6.0/10 | 고유 paper language는 강함. Paper/legacy/Astryx 화면 세대가 혼재 |
| Emotional design | 7.3/10 | 따뜻하고 사적인 손글씨·정원 정체성이 있음. 수치·선·빈 공간이 감정을 가리는 구간 존재 |
| Accessibility | 7.9/10 | 44px, keyboard, text floor, contrast, route focus/announcement가 browser에서 통과. VoiceOver/Dynamic Type 실기기 미검증 |
| Mobile usability | 7.5/10 | 320–430px 회귀와 375/402 screenshots, overflow 통과. 작은 화면 정보 밀도와 실제 safe area 미검증 |
| Code architecture | 6.1/10 | use-case/repository/crypto 경계 존재. 4,105줄 Store, giant pages, direct DB paths가 변경 위험 증가 |
| Reliability | 6.9/10 | offline/realtime/recovery 및 많은 회귀 테스트. 장시간 reconnect, partial/corrupt cache, 실기기 검증 부족 |
| Security | 6.5/10 | 강한 문서·RLS/E2EE 방향·negative harness가 있음. remote current state와 credential rotation은 미확인/미해결 |
| Performance | 6.2/10 | route lazy와 precache 제외가 있음. 큰 JS/CSS/media asset, CPU/battery/initial-load 실측 부족 |
| Test coverage | 8.2/10 | 185 `.test.ts`, 95 `.test.tsx`, 24 e2e spec; 전체 3,944 test와 이번 browser 38 test 통과. coverage threshold 없음 |
| Release readiness | 5.2/10 | 로컬 typecheck/build/test 기반은 좋음. Production/CI/실기기/credential/backup hold가 남음 |

전체 단순 평균은 약 **6.8/10**이다. 기능 시제품 단계는 지났지만 App Store Release Candidate 판정에는 이르다.

## Decision

### 시각 방향 비교

1. **Intimate Editorial Utility — 선택**
   - 공책·원본 문장·편집물 같은 정보 위계, 낮은 chrome, 제한된 따뜻한 accent.
   - 곰신로그의 “복구→연결→축적”과 현재 자산을 가장 잘 보존한다.
2. **Living Memory Garden**
   - 정원·캐릭터·성장을 앱 전체 언어로 확대.
   - 감성은 강하지만 retention game이 핵심 연결 loop를 압도할 위험이 있어 sub-surface로만 사용한다.
3. **Warm Apple Utility**
   - 시스템 카드·sheet·native spacing 중심.
   - 접근성은 쉽지만 고유성이 줄고 일반 일정/커플 앱처럼 보일 위험이 있다.

따라서 방향 1을 전역으로 유지하고, 방향 2는 Diary/Garden에만 제한하며, 방향 3의 접근성·motion 원칙만 차용한다.

### 조사 중 수정하지 않기로 한 결정

초기 정적 검토에서는 Home의 `Post`가 `contentUnavailable`보다 `hasMedia`를 먼저 검사하므로 잠금 기록의 미디어가 노출될 가능성이 제기됐다. 그러나 실제 상위 call path를 끝까지 추적한 결과:

1. Home feed는 `Post`에 전달하기 전에 `isRecordContentAvailable`로 잠금 record를 제외한다.
2. 올바른 GLE1 암호화 쓰기는 평문 `attachments` 컬럼을 같은 DB write에서 비우고 attachment reference를 암호문 document 안으로 옮긴다.
3. 복호화 실패한 정상 encrypted row는 attachment reference를 얻지 못한다.
4. PartnerDay와 legacy paper feed도 readable filter를 upstream에서 적용한다.

따라서 현재 증거로는 실제 사용자 경로에서 재현되는 HIGH 문제가 아니며, 추측만으로 UI 분기나 암호화 의미를 바꾸지 않는다. Home의 도달 불가능한 defensive branch는 별도 정리 후보일 뿐 release blocker가 아니다. 건강 consent cache의 권위 의미는 독립 security/architecture 검토에 남긴다.

## Release Candidate Roadmap

1. **Design system convergence**
   - 이미 존재하는 semantic token, type scale, spacing, radius, Button/Card/List/Empty/Error/Skeleton을 canonical contract로 정리
   - legacy/Astryx/paper가 같은 의미 토큰을 소비하게 하고 새 색·magic number 유입을 막음
2. **Home prototype**
   - 현재 상태 하나를 최우선으로 보여주는 hierarchy
   - new partner record, already read, no news, call soon, disconnected, loading/error, long content를 양 역할·양 테마로 검증
3. **Remaining screens**
   - Search: 검색과 역할 surface를 progressive disclosure
   - Diary/Garden/Shop: 월 기록을 first viewport에 노출하고 accessory equip은 Shop으로 merge
   - Schedule: 달력·추가 흐름과 작은 화면 개선
   - Us/Settings: 중복 경로와 visual generation 통합
4. **Reliability matrix**
   - slow/offline/reconnect/expired/partial/corrupt/duplicate/delayed/empty/disconnected/deleted partner/timezone/large media/denied permission
5. **Performance**
   - route별 load, bundle budget, rerender, image memory, Garden CPU/reduced motion, realtime subscription·battery 측정
6. **Accessibility**
   - 200% reflow, VoiceOver, Dynamic Type bridge, focus order, keyboard, modal, touch target, contrast, reduced motion
7. **Independent security gate**
   - cached consent와 direct DB gate의 권위 의미 검토
   - CRITICAL/HIGH 0건이 아니면 RC 거부
8. **RC closure**
   - exact HEAD의 full local suite/Edge/native/browser/CI 필요 범위, 문서 동기화, rollback, READY TO MERGE 판정

## Verification

이번 감사에서 실행:

```text
bash scripts/agent/session-start.sh
git status --short --branch
git rev-parse HEAD

SHOT_DIR=.unlazy/gomsinlog-rc-v4/artifacts/ui-audit \
NODE_OPTIONS=--max-old-space-size=4096 \
npx playwright test e2e/uiAudit.spec.ts --project=chromium-390 --workers=1
→ 11/11 PASS, 48 screenshots

NODE_OPTIONS=--max-old-space-size=4096 \
npx playwright test \
  e2e/realUsability.spec.ts \
  e2e/renderedTypeScale.spec.ts \
  e2e/semanticSurfaces.spec.ts \
  --project=chromium-390 --workers=1
→ 17/17 PASS
```

현재 candidate에서 앞서 실행·확인된 검증:

- full Vitest: 280 files / 3,944 tests PASS. 단, 가장 마지막 Home 보안 보강 전 전체 실행이므로 최종 HEAD에서 다시 실행해야 한다.
- latest focused Vitest: 10 files / 151 tests PASS.
- TypeScript: PASS.
- touched ESLint: PASS.
- Garden/media Playwright: 10/10 PASS.
- placeholder production build: PASS.
- `git diff --check`: PASS.

실행하지 않음 / UNVERIFIED:

- current remote CI
- current Supabase catalog 및 authenticated actor matrix
- Production Vercel/browser
- physical iPhone install, VoiceOver, Dynamic Type, Foundation Models, battery/thermal
- TestFlight/App Store

## Risks

### Release HOLD

- 운영 runbook은 delete-by가 지난 일회성 백업이 남으면 후속 release/Production deploy를 중단한다.
- `/Users/han-yejun/Desktop/gomsinlog-production-backups/2026-08-26-pre-record-protection`은 현재 존재하고 권한은 directory `700`, files `600`으로 확인됐다. 문서 delete-by `2026-09-02 16:04 KST`는 지났다.
- 두 번째 backup도 현재 존재하며 delete-by는 `2026-09-03 04:03 KST`다.
- 백업 삭제는 실제 운영 데이터의 파괴적 작업이므로 이번 작업에서 수행하지 않는다. 필요성 확인과 사용자의 명시적 승인 전까지 RC/Production은 HOLD다.

### Security / Production

- 이전 Supabase CLI dry-run에서 DB credential이 세션 출력에 노출됐다는 canonical 기록이 있다. rotation 완료를 현재 확인하지 못했으므로 manual release blocker다.
- Home `contentUnavailable + media` 의심은 upstream readable filter와 encrypted-column clearing을 확인해 현재 사용자 경로의 결함으로 재현되지 않았다. 이 판단은 remote catalog 증거를 대신하지 않는다.
- health consent cached fallback은 의도와 실제 권위 경계를 독립 security/architecture review에서 재검토해야 한다.
- current remote migration/RLS는 UNVERIFIED다.

### Product / UX

- Garden 무료 draw가 보유 상태를 늘리지만 현재 새 액세서리를 장착하는 자연스러운 경로가 없다.
- Search의 service level/EXP precision은 경쟁 기능은 아니지만 제품 철학과 정서가 충돌할 수 있다.
- global loading과 generic account error는 복구·신뢰 UX를 약화한다.

## Next Highest-ROI Goal

**기존 디자인 토큰을 하나의 접근성 계약으로 수렴시키고, Home을 출시 수준의 상태 우선 화면으로 완성한다.**

다음 기능 구현 전에 반드시 다시 확인할 질문은 다음과 같다.

1. 변경 대상이 현재 active V4 route에서 실제 호출되는가?
2. source recordId, private/shared, active couple, content availability 의미를 바꾸는가?
3. remote migration 또는 Production 사실을 요구하는가? 그렇다면 현재 증거가 있는가?
4. 건강·E2EE·계정 lifecycle을 건드리는가? 그렇다면 Architect와 negative test가 포함됐는가?
5. mock browser 결과를 실기기/Production PASS로 잘못 승격하고 있지 않은가?
6. 새 기능이 아니라 현재 핵심 loop의 마찰을 줄이는 일인가?
