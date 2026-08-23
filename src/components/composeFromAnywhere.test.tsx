import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 기록을 시작하는 길이 언제나 열려 있다.
 *
 * `PRODUCT_V3` §7.1 은 30초 안의 기록을 목표로 삼고 진입점을 **제거할 수 없는 계약**으로
 * 만든다. 그 계약을 지키는 방식은 세 번 바뀌었고, 매번 이 파일이 따라갔다.
 *
 *     1. `/record` 의 떠 있는 CTA 하나            -- 다른 탭에서는 이동부터 해야 했다
 *     2. 셸이 띄우는 둥근 버튼                     -- 자기 CTA 가 있는 화면에서 거둬졌다
 *     3. 탭바 가운데 칸                           -- 엄지가 가장 쉬운 칸을 동작에 썼다
 *     4. **스토리 레일의 `+` · `우리` 의 펜 · `찾기` 의 펜** (2026-08-23)
 *
 * 넷째가 지금이다. 인스타에는 떠 있는 버튼이 없다 -- 만들기는 자기 스토리 링에 붙은 `+`
 * 이거나 프로필의 `+` 이고, 이 앱은 둘 다 쓴다. 산호빛 원이 종이 위에 떠 있으면 그것
 * 하나가 화면에서 유일하게 앱처럼 보이는 물건이 된다.
 *
 * ## 이 파일이 지키는 것
 *
 * 진입점이 **어디에 있는지가 아니라, 조건 없이 있는지**다. 세 자리 모두 삼항이나 `&&`
 * 뒤에 숨지 않아야 한다 -- 앞선 판이 정확히 그렇게 무너졌다: `ownsPrimaryAction` 이
 * 참인 화면에서 버튼이 스스로를 거뒀고, "제거할 수 없다"고 한 것에 제거되는 경우가
 * 둘 있었다.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/**
 * 진입점 셋. 각각 그 화면에서 조건 없이 그려져야 한다.
 *
 * `anchor` 는 진입점을 여는 태그 바로 앞의 문자열이고, 그 앞 240자에 조건 분기가 없으면
 * 조건 없이 그려지는 것이다. 소스에서 보는 이유는 세 화면 모두 렌더하려면 스토어 전체가
 * 필요하고, 여기서 보고 싶은 것은 **구조적 사실**이기 때문이다.
 */
const ENTRY_POINTS: Array<{ file: string; label: string; where: string }> = [
  {
    file: 'src/features/home/PaperHome.tsx',
    label: '기록 남기기',
    where: '홈 스토리 레일의 + 배지',
  },
  {
    file: 'src/features/us/SharedProfile.tsx',
    label: '기록 남기기',
    where: '우리 헤더의 펜',
  },
  {
    file: 'src/features/search/SearchPage.tsx',
    label: '기록 남기기',
    where: '찾기 헤더의 펜',
  },
];

describe('기록을 시작하는 길은 조건 없이 열려 있다', () => {
  it.each(ENTRY_POINTS)('$where 는 조건 뒤에 숨지 않는다', ({ file, label }) => {
    const source = read(file);
    const at = source.indexOf(`aria-label="${label}"`);
    expect(at, `${file} 에 진입점이 없다`).toBeGreaterThan(-1);

    const before = source.slice(Math.max(0, at - 240), at);
    // 여는 `<button` 이 그 앞에 있고, 그 사이에 삼항이나 `&&` 가 없어야 한다.
    expect(before).toContain('<button');
    const opening = before.slice(before.lastIndexOf('<button'));
    expect(opening, `${file}: 진입점이 조건부로 그려진다`).not.toMatch(/\?|&&/);
  });

  it('셋 다 같은 곳으로 간다', () => {
    for (const { file } of ENTRY_POINTS) {
      expect(read(file), `${file}`).toContain("navigate('/compose')");
    }
  });

  it('거둬지는 진입점이 하나도 없다', () => {
    /*
      가드 건전성. 앞선 판이 무너진 방식이 이것이었다 -- 화면이 자기 주요 동작을 이미
      가졌다는 이유로 진입점이 스스로를 거뒀다. 그 술어가 다시 들어오면 여기서 걸린다.
    */
    expect(read('src/components/MobileShell.tsx')).not.toContain('ownsPrimaryAction');
  });

  it('하단 탭바 다섯 칸이 유지되고 가운데는 일기장으로 연결된다', () => {
    /*
      하단 탭바 다섯 칸 — 홈 · 찾기 · 일기장 · 일정 · 우리.
      가운데는 일기장(/diary)이며, 작성 진입점은 홈 레일 +, 우리 헤더 펜, 찾기 헤더 펜과
      기록 화면이 항상 보장한다(§7.1).
    */
    const shell = read('src/components/MobileShell.tsx');
    const tabs = [...shell.matchAll(/to: '(\/[a-z]+)'/g)].map((match) => match[1]);
    expect(tabs).toEqual(['/home', '/search', '/diary', '/schedule', '/us']);
    expect(shell).toContain("matchPrefixes: ['/diary', '/shop']");
  });
});

/**
 * 한 동작에 한 이름.
 *
 * 세 진입점과 열리는 화면이 같은 컴포저를 연다. 한때 그것들이 서로 다른 이름을 가졌고
 * (`기록 남기기` / `지금의 마음 남기기`), 한 화면에서 컨트롤을 배운 사람에게 다음 화면의
 * 같은 컨트롤이 다른 기능처럼 보였다.
 */
describe('기록 남기기는 어디서나 같은 이름이다', () => {
  it('두 번째 이름이 남아 있지 않다', () => {
    for (const { file } of ENTRY_POINTS) {
      expect(read(file)).not.toContain('지금의 마음 남기기');
    }
    expect(read('src/features/compose/ComposePage.tsx')).not.toContain('지금의 마음 남기기');
  });

  it('열리는 화면이 자기가 무엇인지 말한다', () => {
    // 진입점의 이름과 도착지의 제목이 어긋나면 누른 사람은 잘못 눌렀다고 읽는다.
    expect(read('src/features/compose/ComposePage.tsx')).toContain('오늘 남기기');
  });
});
