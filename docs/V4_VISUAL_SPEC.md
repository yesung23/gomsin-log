# V4-1 시각 기반 — 실행 명세

> **이 문서는 구현 지시서다.** 설계 근거는
> [`EXPERIENCE_V4_MASTER_PLAN.md`](EXPERIENCE_V4_MASTER_PLAN.md) §4가,
> 승인된 canonical 조항은 [`DESIGN_V2.md`](DESIGN_V2.md) `### 손글씨`가 소유한다.
> 여기에는 **무엇을 어느 파일에 어떻게 쓰는가**만 둔다.
>
> - 기준 HEAD `3231c4b` · 2026-08-22
> - 선행 조건: **T0 가독성 확인**(`--font-hand-scale` 값). 그 값을 모르면 `1.15`로 두고
>   실기기 확인 후 한 줄만 고친다. 나머지는 전부 지금 만들 수 있다.
> - **`npm run verify` EXIT=0** 이 완료 조건이다.

## 0. 이 단계에서 바꾸지 않는 것

```text
--card · --cream · --navy · --coral · --border · emotion-* · 7단계 타입 스케일
dark 모드 팔레트 · Card 컴포넌트의 radius/border/padding · Astryx layer 순서
```

**팔레트를 건드리지 않는 것이 이 단계의 핵심 제약이다.** 이유는 셋이다.

1. `themeTokens.test.ts`가 `--card: oklch(1 0 0);`을 **리터럴로 단언**한다. 그 값이
   Tailwind `white`와 바이트 단위로 같아야 `bg-white/NN → bg-card/NN` 마이그레이션이
   무해했기 때문이다.
2. **카드를 따뜻하게 만드는 변경은 2026-08-09에 이미 시도되고 되돌려졌다.**
   `index.css` 주석이 그 이유를 보존한다 — *"a white card on a warm page reads as paper,
   not as a panel."* 기반은 이미 종이다.
3. 색을 복사하면 light에서는 맞고 dark에서는 틀린 두 번째 사본이 생긴다.

---

## 1. 폰트 파이프라인

### 1.1 슬라이스를 어디에 두나 — **`src/fonts/hand/`** (`public/`이 아니다)

`vite.config.ts`의 서비스워커 프리캐시 제외 규칙은 **`dist/assets`만 훑는다**
(`isPrecachedAsset`). `public/`에 둔 파일은 `dist/` 루트로 그대로 복사되므로 그 규칙의
바깥이고, 해시도 붙지 않는다.

`src/` 아래에 두고 CSS `url()`로 참조하면 Vite가 **`dist/assets`로 해시와 함께** 내보내므로

- 기존 프리캐시 제외 규칙이 **그대로 적용된다** — `vite.config.ts`를 고칠 필요가 없다
- 파일명이 콘텐츠 해시라 **영구 캐시**가 안전하다
- `sw.js`가 `destination === 'font'`를 런타임 캐시하는 동작도 그대로다

Pretendard가 이미 같은 경로(node_modules → `dist/assets`)를 지난다. **같은 길을 쓴다.**

### 1.2 만드는 법

```bash
python3 -m venv .fontenv && .fontenv/bin/pip install fonttools brotli
.fontenv/bin/python scripts/fonts/build_hand_font.py <나눔손글씨세화체>.ttf src/fonts/hand
```

산출: `src/fonts/hand/hand-0.woff2` … `hand-186.woff2` + `hand.css`
(187개 · 합계 약 3.0 MB · **전부 내려오는 일은 없다** — `unicode-range`가 막는다)

`.fontenv/`는 `.gitignore`에 넣는다. 빌드 산출물인 `.woff2`와 `hand.css`는 **커밋한다** —
CI에 python/fonttools를 넣지 않기 위한 의도적 선택이다.

### 1.3 `src/styles/index.css`에 더할 것

Pretendard `@import` **바로 다음**에:

```css
@import "../fonts/hand/hand.css";
```

그리고 `@theme inline` 블록 안, 폰트 계열 근처에:

```css
  --font-hand: "Gomsin Hand", var(--font-sans);
  --font-hand-scale: 1.15;   /* T0 실측값으로 교체 */
```

### 1.4 기존 주석을 지우지 말고 **갱신한다**

`src/styles/index.css`의 2026-08-09 되돌림 주석(현재 53–62행)은 그 발견이 여전히 사실이므로
남긴다. 아래를 이어 붙인다.

```
 * 2026-08-22: 되돌아왔다. 그때의 두 발견이 여전히 맞고, 적용 방식이 달라져서 통과한다.
 *
 *   가독성 — 그때는 전면 적용이었다. 지금은 사용자가 쓴 글에만 쓴다(DESIGN_V2 손글씨
 *   화이트리스트). UI·시간·숫자·법적 고지는 계속 Pretendard이므로, 폰트가 늦거나
 *   실패해도 화면이 읽힌다. 그리고 설정에서 끌 수 있다.
 *
 *   588 kB — latin만 16 kB였던 그 비교는 단일 서브셋 파일 기준이었다. 빈도순
 *   unicode-range로 60자씩 187개로 자르면 첫 화면이 실제로 내려받는 양은 81–105 kB다
 *   (실측). 단일 파일은 지금도 탈락이다 — KS X 1001 2,350자가 532 kB.
 *
 *   라이선스는 그때도 문제가 아니었고 지금도 아니다. 서체만 바뀌었다(나눔손글씨 세화체).
```

### 1.5 라이선스 고지

`public/licenses/nanum-sehwace.txt`에 라이선스 원문·저작권을 두고,
`설정/약관`의 오픈소스 고지에서 도달 가능하게 한다.

---

## 2. 손글씨 적용 — 화이트리스트와 가드

### 2.1 쓰는 법

Tailwind 유틸리티가 아니라 **의미를 가진 클래스 하나**를 쓴다. 유틸리티로 흩뿌리면
화이트리스트를 강제할 수 없다.

`src/styles/index.css`의 `@layer components`에:

```css
  /*
   * 사람이 쓴 글. 앱이 하는 말(Pretendard)과 구분된다.
   *
   * `font-size`를 건드리지 않는다 — 7단계 스케일은 그대로 두고 배율만 곱한다.
   * 그래서 `text-body.hand-text`는 15px * 1.15 = 17.25px로 그려지되,
   * typeScale.test.ts가 보는 클래스는 여전히 `text-body` 하나다.
   */
  .hand-text {
    font-family: var(--font-hand);
    font-size: calc(1em * var(--font-hand-scale));
    font-weight: 400;          /* 합성 굵기 금지 — weight가 하나뿐이다 */
    letter-spacing: 0;
  }

  /* 손글씨 끄기. 설정 토글이 셸 루트에 이 속성을 건다. */
  [data-hand='off'] .hand-text {
    font-family: var(--font-sans);
    font-size: 1em;
  }
```

### 2.2 화이트리스트 (`DESIGN_V2` 손글씨 절과 동일)

`.hand-text`를 쓸 수 있는 파일만 목록에 둔다.

```text
src/components/media/**            사진 옆 본문
src/components/widgets/**          포스트 카드 · 편지 카드 (V4-3)
src/features/story/**              스토리 카드 본문 · 속표지 (V4-2)
src/features/home/**               지면 (V4-3)
src/features/us/**                 프로필 소개 · 마일스톤 라벨 (V4-4)
src/pages/RecordPage.tsx           기록 상세 본문
```

**절대 금지:** `src/pages/LegalPage.tsx` · `src/pages/SettingsPage.tsx` ·
`src/pages/MyPage.tsx` · `src/components/*Section.tsx`(동의·보안) · 오류 메시지 · 토스트.

### 2.3 가드 테스트 — `src/lib/handwritingScope.test.ts` (신규)

```ts
// 방향에 주의한다. "있어야 할 것을 찾는" 문자열 검사는 버그가 있는 동안 초록이다가
// 고치면 깨진다. 이 가드는 반대 방향이다 — 금지된 곳에 없어야 통과한다.
it('손글씨는 화이트리스트 밖에서 쓰이지 않는다', () => {
  const offenders = walk('src')
    .filter((f) => !WHITELIST.some((p) => f.startsWith(p)))
    .filter((f) => read(f).includes('hand-text'));
  expect(offenders).toEqual([]);
});

it('법적 고지·설정·오류 화면에는 절대 없다', () => { /* 위와 같은 방향 */ });

it('새 폰트 크기 단계를 만들지 않는다', () => {
  // .hand-text 는 font-size 를 calc(1em * ...) 로만 건드린다.
  expect(css).toContain('font-size: calc(1em * var(--font-hand-scale))');
  expect(css).not.toMatch(/\.hand-text[^}]*font-size:\s*\d/);
});
```

**mutation 확인:** 화이트리스트 밖 파일에 `hand-text`를 한 번 넣으면 첫 테스트가
**실제로 FAIL해야 한다.** 확인하지 않은 가드는 가드가 아니다.

### 2.4 CSP 가드

`cspExternalResources.test.ts`가 이미 외부 origin을 잡는다. `hand.css`의 `url()`이
전부 상대 경로인지 확인만 한다. **새 테스트는 필요 없다.**

---

## 3. 손글씨 토글

- 저장: 기기 로컬(`localStorage`). 서버로 보내지 않는다 — 표시 설정이다.
- 자리: **`설정/표시`**. 기본 **켬**.
- 적용: `MobileShell`의 프레임 `<div>`에 `data-hand={enabled ? 'on' : 'off'}`.
  `data-astryx-theme`가 붙어 있는 그 요소다. `OnboardingPage`가 이 프레임을 손으로
  복제하므로 **거기에도 같은 속성을 건다**(`astryxFoundation.test.ts`가 두 곳을
  대조하고 있으니 같은 규칙을 따른다).
- 문구: `손글씨로 보기` / 보조 설명 `끄면 모든 글이 기본 서체로 보여요.`
  **접근성 장치이지 취향 설정이 아니다** — 설명에 "예쁘게" 같은 말을 쓰지 않는다.

---

## 4. 종이 질감

`src/styles/index.css`의 `@layer base`에, 페이지 배경에만.

```css
  /*
   * 종이 결.
   *
   * 이미지 에셋을 쓰지 않는다 — 번들 비용이 들고, CSP의 img-src 를 건드리며,
   * dark 모드에서 두 번째 파일이 필요해진다. 그라디언트 두 겹이면 충분하다.
   *
   * 카드 위에는 얹지 않는다. 카드는 "따뜻한 종이면 위에 놓인 흰 종이 조각"이고
   * (index.css --card 주석), 그 대비가 이 앱의 종이 은유 그 자체다.
   */
  body {
    background-image:
      repeating-linear-gradient(0deg,
        color-mix(in oklch, var(--foreground) 1.2%, transparent) 0 1px,
        transparent 1px 3px),
      repeating-linear-gradient(90deg,
        color-mix(in oklch, var(--foreground) 0.8%, transparent) 0 1px,
        transparent 1px 4px);
  }

  @media (prefers-reduced-transparency: reduce) {
    body { background-image: none; }
  }
```

**대비 영향이 없어야 한다.** 1.2% 이하로 유지하고, 텍스트 위에 얹지 않는다.
`e2e/tokenContrast.spec.ts`가 실측하므로 값을 올렸다면 다시 돌린다.

---

## 5. 컴포넌트 5개 — `src/components/paper/`

전부 기존 관례를 따른다: `cn` from `@/lib/utils` · 토큰만 · 하드코딩 색 금지 ·
7단계 타입 스케일 · hit target 44×44px · dark 대응 · `prefers-reduced-motion` 존중.

### 5.1 `InkRing`

```ts
type InkRingProps = {
  /** 잉크(미확인) / 연필(확인함) / 회색(비활성·초대) */
  state: 'unread' | 'read' | 'idle';
  size?: number;          // 기본 80
  children: ReactNode;    // 아바타
};
```

- 인스타의 보라–주황 그라디언트를 **복제하지 않는다**(트레이드 드레스, §8 R3).
  코랄 단색 SVG stroke이며 `stroke-linecap="round"`, 미세하게 불규칙한 path.
- `unread`는 **뷰어 로컬 상태**다. 이 컴포넌트는 서버 값을 받지 않는다.
- `idle`은 자리를 지키는 상태다 — **숨기지 않는다**(§6.9).

### 5.2 `Stamp` (도장)

```ts
type StampProps = {
  kind: 'empathy' | 'comfort';    // 공감 · 토닥이기
  pressed: boolean;
  onToggle: () => void;
  disabled?: boolean;             // 오프라인·보관 모드
};
```

- **개수를 받지 않는다.** props에 `count`가 없는 것이 §16 비목표의 구현이다.
- 누르면 잉크가 번지는 120ms. `prefers-reduced-motion`에서는 즉시 상태만 바뀐다.
- `aria-pressed`로 상태를 노출한다.

### 5.3 `Bookmark` (책갈피 = 이따 이야기하기)

```ts
type BookmarkProps = { marked: boolean; onToggle: () => void; disabled?: boolean };
```

- 카드 우측에 살짝 끼워진 리본. `aria-label`은 `이따 이야기하기` / `표시 해제`.
- **공유 기록에만 붙는다** — 호출부가 보장하고, 이 컴포넌트는 `disabled`만 받는다.

### 5.4 `PaperCard`

```ts
type PaperCardProps = { flush?: boolean; className?: string; children: ReactNode };
```

- 미디어가 없는 스토리 카드·편지 카드의 바탕.
- **`Card`를 대체하지 않는다.** `Card`는 위젯 표면이고 이것은 전체화면 안의 종이다.
  `rounded-surface` + `bg-card`를 공유하되 border 대신 여백으로 구분한다.

### 5.5 `FoldDivider`

```ts
type FoldDividerProps = { className?: string };
```

- 실선 대신 접힌 자국. `--border` hue를 그대로 쓴 2px 이중선 또는 얇은 점선.
- `role="separator"`.

### 5.6 `PaperSkeleton`

- 기존 `Skeleton`을 감싼다. **`label`은 여전히 필수다** — 그 이유(무엇을 기다리는지
  말하지 않는 로딩은 틀린 상태다)는 바뀌지 않았다.
- **shimmer를 쓰지 않는다.** 반짝임은 유리의 문법이다. `animate-pulse` 대신 정적 종이 블록.

---

## 6. 파일 목록

### 신규

```text
src/fonts/hand/hand-*.woff2          (187개, 빌드 산출물)
src/fonts/hand/hand.css              (빌드 산출물)
src/components/paper/InkRing.tsx
src/components/paper/Stamp.tsx
src/components/paper/Bookmark.tsx
src/components/paper/PaperCard.tsx
src/components/paper/FoldDivider.tsx
src/components/paper/PaperSkeleton.tsx
src/components/paper/paperComponents.test.tsx
src/lib/handwritingScope.test.ts
public/licenses/nanum-sehwace.txt
```

### 수정

```text
src/styles/index.css          @import · --font-hand · .hand-text · body grain · 주석 갱신
src/components/MobileShell.tsx    data-hand 속성
src/pages/OnboardingPage.tsx      같은 프레임이므로 같은 속성
src/pages/SettingsPage.tsx        손글씨 토글
src/lib/store.tsx (또는 설정 저장 위치)  토글 영속화
.gitignore                     .fontenv/
```

### 건드리지 말 것

```text
src/styles/astryx-gomsin.css   layer 순서와 매핑
vite.config.ts                 §1.1대로 하면 고칠 이유가 없다
src/components/ui/Card.tsx     이미 옳다
--card 를 포함한 모든 팔레트 토큰
```

---

## 7. 먼저 쓸 테스트

| # | 무엇 | mutation |
|---|---|---|
| 1 | 화이트리스트 밖에 `hand-text`가 없다 | 밖에 하나 넣으면 FAIL |
| 2 | 법적 고지·설정·오류 화면에 없다 | 넣으면 FAIL |
| 3 | `.hand-text`가 절대 `font-size`를 쓰지 않는다 | 절대값 넣으면 FAIL |
| 4 | `data-hand="off"`면 손글씨가 적용되지 않는다 | 셀렉터 지우면 FAIL |
| 5 | `Stamp`의 props에 개수가 없다 | `count` 추가하면 FAIL |
| 6 | 종이 컴포넌트에 하드코딩 색(`#`)이 없다 | 넣으면 FAIL |
| 7 | hit target 44×44px | 줄이면 FAIL |
| 8 | `themeTokens.test.ts` · `typeScale.test.ts` · `astryxFoundation.test.ts` **그대로 통과** | — |

---

## 8. 완료 조건

```bash
npm run verify        # EXIT=0
```

그리고 **실기기에서 눈으로** 확인한다: 390px light/dark · 손글씨 켬/끔 ·
5줄 본문 가독성 · 네트워크 탭에서 첫 화면 폰트 전송량이 **150 kB 이하**.

마지막 항목이 이 단계의 진짜 수용 기준이다. 숫자를 재지 않고 넘어가지 않는다.
