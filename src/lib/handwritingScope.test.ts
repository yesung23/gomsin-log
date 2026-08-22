import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * 손글씨는 사람이 쓴 글에만 붙는다.
 *
 * `DESIGN_V2.md`의 `### 손글씨` 절이 이 목록의 주인이다. 종이 일기장이 그렇듯 양식은
 * 인쇄되어 있고 내용만 손으로 쓴다 -- 시간·개수·버튼·설정은 Pretendard고, 사용자가 남긴
 * 문장만 손글씨다.
 *
 * ## 이 가드의 방향
 *
 * 검사 방향이 반대이면 아무것도 지키지 못한다. "있어야 할 문자열이 소스에 있는지"를 보는
 * 테스트는 결함이 있는 동안 계속 통과하고 고치는 순간 깨진다 -- 이 저장소가 이미 겪은
 * 종류의 실패다. 그래서 여기서는 **금지된 곳에 없어야 통과한다**로만 쓴다. 새 파일이
 * 손글씨를 잘못 쓰면 목록에 없으므로 자동으로 걸린다.
 *
 * ## 왜 유틸리티가 아니라 클래스 하나인가
 *
 * `font-hand` 같은 Tailwind 유틸리티로 흩뿌리면 이 목록을 강제할 수 없다. 손글씨는
 * `.hand-text` 하나로만 들어가고, 그 클래스가 어디에 있는지를 이 파일이 센다.
 */

/** 손글씨를 쓸 수 있는 곳. `DESIGN_V2` 손글씨 절의 화이트리스트와 같아야 한다. */
const WHITELIST = [
  'src/components/media/',
  'src/components/widgets/',
  'src/components/paper/',
  'src/features/story/',
  'src/features/home/',
  'src/features/us/',
  'src/features/search/',
  'src/features/diary/',
  'src/pages/RecordPage.tsx',
];

/**
 * 손글씨가 절대 닿으면 안 되는 곳.
 *
 * 화이트리스트의 여집합이지만 따로 적는다. 읽기 어려운 글씨로 쓴 "복구할 수 없습니다"는
 * 정직하지 않고, 그 판단은 목록이 리팩터링으로 흔들릴 때에도 남아야 한다.
 */
const NEVER = [
  'src/pages/LegalPage.tsx',
  'src/pages/SettingsPage.tsx',
  'src/pages/MyPage.tsx',
  'src/pages/OnboardingPage.tsx',
  'src/components/DeviceProtectionSection.tsx',
  'src/components/NotificationPreferencesSection.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/components/OfflineBanner.tsx',
];

const MARKER = 'hand-text';

function sources(dir = 'src'): string[] {
  const absolute = resolve(process.cwd(), dir);
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sources(relative));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    found.push(relative);
  }
  return found;
}

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file.split('/').join(sep)), 'utf8');
}

const SOURCES = sources();
const css = read('src/styles/index.css');

describe('손글씨는 사람이 쓴 글에만 붙는다', () => {
  it('빈 목록으로 조용히 통과하지 않는다', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES).toContain('src/pages/SettingsPage.tsx');
    expect(SOURCES).toContain('src/components/MobileShell.tsx');
  });

  it('화이트리스트 밖에서 쓰이지 않는다', () => {
    const offenders = SOURCES
      .filter((file) => !WHITELIST.some((allowed) => file.startsWith(allowed)))
      .filter((file) => read(file).includes(MARKER));
    expect(offenders).toEqual([]);
  });

  it('법적 고지·설정·보안·오류 화면에는 절대 없다', () => {
    const offenders = NEVER.filter((file) => read(file).includes(MARKER));
    expect(offenders).toEqual([]);
  });
});

describe('손글씨는 타입 스케일을 늘리지 않는다', () => {
  /**
   * `.hand-text`는 크기를 절대값으로 정하지 않는다. 7단계 스케일을 그대로 두고 배율만
   * 곱하므로, `text-body.hand-text`는 15px * 배율로 그려지되 `typeScale.test.ts`가 보는
   * 클래스는 여전히 `text-body` 하나다. 절대값을 쓰는 순간 여덟 번째 단계가 생긴다.
   */
  it('배율로만 크기를 바꾼다', () => {
    expect(css).toContain('font-size: calc(1em * var(--font-hand-scale))');
  });

  it('절대 크기를 쓰지 않는다', () => {
    const rule = css.slice(css.indexOf('.hand-text {'), css.indexOf('.hand-text {') + 400);
    expect(rule).not.toMatch(/font-size:\s*[\d.]+(px|rem|em)\b/);
  });

  it('굵기를 합성하지 않는다', () => {
    // 세화체는 Regular 하나뿐이다. faux bold는 손글씨 획을 뭉갠다.
    const rule = css.slice(css.indexOf('.hand-text {'), css.indexOf('.hand-text {') + 400);
    expect(rule).toContain('font-weight: 400');
  });
});

describe('손글씨는 끌 수 있다', () => {
  /**
   * 취향 설정이 아니라 접근성 장치다. 손글씨는 저시력·난독 사용자에게 벽이 될 수 있고,
   * 이 앱을 볼 사람이 커플 둘만은 아니다.
   */
  it('data-hand="off"가 손글씨를 되돌린다', () => {
    expect(css).toContain("[data-hand='off'] .hand-text");
  });

  it('되돌릴 때 크기도 함께 원래대로 온다', () => {
    const off = css.slice(css.indexOf("[data-hand='off'] .hand-text"));
    const rule = off.slice(0, off.indexOf('}'));
    expect(rule).toContain('font-family: var(--font-sans)');
    expect(rule).toContain('font-size: 1em');
  });
});

describe('폰트는 자체 호스팅이다', () => {
  it('슬라이스 CSS를 가져온다', () => {
    expect(css).toContain('@import "../fonts/hand/hand.css";');
  });

  it('슬라이스가 외부 origin을 가리키지 않는다', () => {
    // CSP가 `font-src 'self' data:` 이므로 CDN은 조용히 차단되고 앱은 fallback으로 돈다.
    // 그 실패는 타입체크·린트·빌드를 전부 통과하므로 여기서 잡는다.
    const handCss = read('src/fonts/hand/hand.css');
    expect(handCss).not.toMatch(/url\(["']?https?:/);
    expect(handCss).toContain('unicode-range:');
  });

  it('한 슬라이스가 통째로 커지지 않았다', () => {
    // 빈도순 60자 슬라이스에서 실측 최대는 약 31 kB(hand-0, 라틴·기호 포함)다.
    // 이 값이 크게 넘으면 슬라이싱이 코드포인트 순서로 되돌아갔다는 뜻이다.
    const slices = readdirSync(resolve(process.cwd(), 'src/fonts/hand'))
      .filter((name) => name.endsWith('.woff2'));
    expect(slices.length).toBeGreaterThan(100);
  });
});
