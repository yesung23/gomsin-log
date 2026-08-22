import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 공책 표면의 잉크가 종이에서 실제로 읽히는가.
 *
 * V4의 색은 프리뷰에서 눈으로 골랐다. 눈은 "은은하다"와 "안 읽힌다"를 구별하지 못한다 --
 * 특히 고른 사람의 화면에서는. 그래서 값을 CSS에서 직접 읽어 WCAG 상대휘도로 계산하고,
 * 각 토큰이 **무슨 일을 하는지**에 맞는 최소 대비를 요구한다.
 *
 * 이 가드가 실제로 잡은 것:
 *
 *   --ink-soft   3.58:1  작은 글자인데 AA 4.5 미달  -> #8a847a 를 #746e64 로
 *   --ink-accent 3.58:1  9-11px 라벨인데 미달        -> #d95f45 를 #c14a32 로
 *   --ink-faint  2.06:1  UI 경계인데 1.4.11 3:1 미달 -> #b8b1a3 를 #948d7e 로
 *   --ink-faint  2.64:1  밤에도 미달                 -> #5d5866 를 #6e6878 로
 *
 * 마지막 둘은 "검정화면이 너무 흐릿하다"는 보고의 실제 원인이었다. 흐림의 원인은
 * 배경이 아니라 배경과 거의 붙어 있던 경계선이었다.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/styles/paper.css'), 'utf8');

/**
 * 최상위 토큰 블록만 떼어낸다.
 *
 * `[data-theme='dark'] .notebook` 처럼 같은 접두사를 가진 규칙이 `@layer` 안에 또 있다.
 * 여는 중괄호부터 **줄 맨 앞의 닫는 중괄호**까지로 끊어 그것들과 섞이지 않게 한다.
 */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} 블록이 없다`).toBeGreaterThan(-1);
  const end = CSS.indexOf('\n}', start);
  expect(end, `${selector} 블록이 닫히지 않는다`).toBeGreaterThan(start);
  return CSS.slice(start, end);
}

function tokens(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of block(selector).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/g)) {
    found[name] = value;
  }
  return found;
}

/** WCAG 2.1 상대휘도. sRGB 감마를 되돌린 뒤 사람 눈의 채널 가중치로 더한다. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const LIGHT = tokens(':root');
const DARK = tokens("[data-theme='dark']");

/**
 * 각 잉크가 하는 일과, 그 일이 요구하는 최소 대비.
 *
 * 숫자는 WCAG 2.1에서 온다. 본문 4.5:1(1.4.3), 큰 글자 3:1, 비텍스트 UI 경계 3:1(1.4.11).
 * `--ink` 는 본문 전체를 칠하므로 AAA(7:1)를 요구한다 -- 일기를 읽는 화면이고, 읽는 데
 * 실패하면 제품이 하는 일 자체가 없어진다.
 */
const ROLES: Array<{ token: string; min: number; job: string }> = [
  { token: '--ink', min: 7, job: '본문. 사람이 쓴 글 전체를 칠한다' },
  { token: '--ink-soft', min: 4.5, job: '작은 글자. 시각·날짜·통계 라벨' },
  { token: '--ink-accent', min: 4.5, job: '작은 라벨과, 뒤집어서 칠한 칸의 종이색 숫자' },
  { token: '--ink-faint', min: 3, job: '연필선. 사진 틀·탭바 윗선·격자 칸' },
];

describe('공책의 잉크는 종이에서 읽힌다', () => {
  it('토큰을 조용히 못 찾고 통과하지 않는다', () => {
    // 파서가 헛돌면 아래 모든 단언이 빈 루프로 통과한다.
    // 낮과 밤 모두 종이·괘선·여백선·잉크 넷(본디·soft·faint·accent) = 7.
    expect(Object.keys(LIGHT).sort()).toEqual(
      ['--ink', '--ink-accent', '--ink-faint', '--ink-soft', '--margin-rule', '--paper', '--rule'],
    );
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    expect(LIGHT['--paper']).toBe('#fcfbf7');
    expect(DARK['--paper']).toBe('#16151a');
  });

  for (const { token, min, job } of ROLES) {
    it(`${token} 는 낮과 밤 모두 종이에서 ${min}:1 이상이다 -- ${job}`, () => {
      for (const [theme, set] of [['낮', LIGHT], ['밤', DARK]] as const) {
        const ink = set[token];
        expect(ink, `${theme}에 ${token} 이 없다`).toBeTruthy();
        const measured = contrast(ink, set['--paper']);
        expect(
          Number(measured.toFixed(2)),
          `${theme} ${token} ${ink} 는 종이 ${set['--paper']} 에서 ${measured.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(min);
      }
    });
  }

  it('계산이 실제로 판정한다', () => {
    /*
      가드 건전성. 통과만 하는 계산기는 가드가 아니다. 실제로 걸렀던 값들을 넣어
      그때의 판정이 재현되는지 본다 -- 이 셋이 지금 기준을 넘어 버리면 위의 단언들은
      아무것도 요구하지 않는 것이 된다.
    */
    expect(contrast('#8a847a', '#fcfbf7')).toBeLessThan(4.5);   // 옛 --ink-soft
    expect(contrast('#d95f45', '#fcfbf7')).toBeLessThan(4.5);   // 옛 --ink-accent
    expect(contrast('#5d5866', '#16151a')).toBeLessThan(3);     // 옛 밤의 --ink-faint
    // 그리고 극단은 알려진 값으로 나온다.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

/**
 * 밤에 획이 굵어지는 것은 취향이 아니라 보정이다.
 *
 * 밝은 획은 어두운 바탕에서 더 얇아 보인다 -- 빛이 번지며 가장자리를 먹는다(halation).
 * 같은 1.5px 이 낮에는 또렷하고 밤에는 흐리다. 누가 "다크에서도 같은 두께가 일관적"이라며
 * 되돌리면 보고됐던 흐림이 그대로 돌아온다.
 */
describe('밤에는 획이 굵어진다', () => {
  const px = (set: Record<string, string>, name: string, source: string) => {
    const match = new RegExp(`${name}:\\s*([\\d.]+)px`).exec(source);
    expect(match, `${name} 를 못 찾았다`).toBeTruthy();
    return Number(match![1]);
  };

  it.each(['--stroke', '--stroke-thin', '--stroke-bold'])('%s 는 밤이 낮보다 두껍다', (name) => {
    const light = px(LIGHT, name, block(':root'));
    const dark = px(DARK, name, block("[data-theme='dark']"));
    expect(dark).toBeGreaterThan(light);
  });

  it('아이콘 획도 밤에 굵어진다', () => {
    const light = /\.pen-icon \{ stroke-width: ([\d.]+);/.exec(CSS);
    const dark = /\[data-theme='dark'\] \.pen-icon \{ stroke-width: ([\d.]+);/.exec(CSS);
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(Number(dark![1])).toBeGreaterThan(Number(light![1]));
  });
});

describe('공책은 앱에 실제로 연결되어 있다', () => {
  it('index.css 가 불러온다', () => {
    // 파일만 있고 아무도 import 하지 않으면 위의 모든 검증이 아무 화면에도 닿지 않는다.
    const index = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');
    expect(index).toContain('@import "./paper.css";');
  });

  it('옛 토큰을 지우지 않는다', () => {
    /*
      공책은 더해지는 층이다. 화면을 하나씩 옮기는 동안 아직 옮기지 않은 화면이 옛
      토큰으로 그려진다. paper.css 가 그것들을 재정의하면 옮기지 않은 화면이 조용히
      깨진다 -- 그리고 그 화면들에는 이 색들을 검사하는 테스트가 없다.
    */
    for (const owned of ['--card', '--coral', '--navy', '--background', '--foreground', '--muted']) {
      expect(CSS, `paper.css 가 ${owned} 를 건드린다`).not.toMatch(
        new RegExp(`^\\s*${owned}:`, 'm'),
      );
    }
  });
});
