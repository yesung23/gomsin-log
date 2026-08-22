import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';

/**
 * 기록을 시작하는 것은 어느 화면에서든 한 번이다.
 *
 * `PRODUCT_V3` §7.1 은 30초 안의 기록을 목표로 삼고 진입점을 **제거할 수 없는 계약**으로
 * 만든다. 그것이 요구하지 않은 것은 나머지 네 탭이 막다른 길이어도 된다는 것인데, 한때
 * 그랬다 -- 컴포저는 `/record` 의 떠 있는 CTA 와 홈의 지울 수 있는 위젯에만 있어서,
 * `일정`·`우리`·`나` 에서 생각 하나를 붙잡으려면 이동부터 해야 했다.
 *
 * 그래서 셸이 버튼 하나를 띄운다. **여섯 번째 탭이 아니다** -- §5 가 다섯을 고정하고,
 * 이것은 장소가 아니라 동작이므로 바의 동료가 아니라 바 위에 뜬다.
 *
 * ## 계약은 이 버튼 하나에 기대지 않는다
 *
 * 이 버튼은 자기 주요 동작을 이미 고정한 화면(`/record`, 여행 상세)에서 스스로를 거둔다.
 * 즉 §7.1 이 "제거할 수 없다"고 한 것을 이 버튼만으로는 지킬 수 없다. 지키는 것은
 * `찾기` 탭의 펜이며, 그쪽은 어떤 조건에서도 사라지지 않는다. 이 파일이 양쪽을 다 본다.
 */

vi.mock('@/components/InstallPromptBanner', () => ({ InstallPromptBanner: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/SharedSyncBanner', () => ({ SharedSyncBanner: () => null }));

const { MobileShell } = await import('@/components/MobileShell');

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileShell>
        <p>본문</p>
      </MobileShell>
    </MemoryRouter>,
  );
}

const compose = () => screen.queryByRole('link', { name: '기록 남기기' });

describe('어느 탭에서도 기록을 시작할 수 있다', () => {
  for (const path of ['/home', '/me', '/diary', '/schedule', '/us', '/search', '/my']) {
    it(`${path} 에서 있다`, () => {
      renderShell(path);
      expect(compose()).toBeInTheDocument();
    });
  }

  it('기록 탭이 아니라 이미 열린 컴포저로 간다', () => {
    renderShell('/home');
    // 라우터 상태가 아니라 주소다. §7.5 가 기록에 요구하는 것과 같은 이유 --
    // 새로고침이나 딥링크가 여기 도착할 수 있어야 한다.
    expect(compose()).toHaveAttribute('href', '/record?compose=1');
  });
});

describe('이미 자기 주요 동작을 고정한 화면과 다투지 않는다', () => {
  it('/record 에서는 거둔다 -- 그 화면의 CTA 가 같은 컴포저를 연다', () => {
    renderShell('/record');
    expect(compose()).not.toBeInTheDocument();
  });

  it('여행 상세에서는 거둔다 -- 자기 짝을 고정한다', () => {
    renderShell('/trips/abc');
    expect(compose()).not.toBeInTheDocument();
  });

  it('여행 목록에서는 있다 -- 아무것도 고정하지 않는다', () => {
    // 접두사 매칭이 이걸 한 번 삼켰고, 그래서 판정이 술어다. 목록은 평범한 화면이고,
    // 여행을 되읽다 보면 남길 만한 생각이 쉽게 떠오른다 -- **기억을 가장 잘 불러오는
    // 화면**이 그것을 붙잡을 방법이 없는 유일한 화면이 되는 것이 그 실수였다.
    renderShell('/trips');
    expect(compose()).toBeInTheDocument();
  });
});

describe('버튼이 거둬지는 화면에서도 진입점은 남는다', () => {
  it('탭바에서 우리가 그 화면들을 켜고 있다', () => {
    /*
      `/record` 와 `/search` 는 `우리` 탭에 걸린다. 그래서 버튼이 거둬진 화면에서도
      사용자는 진입점이 어디 있는지 볼 수 있다 -- 켜져 있는 탭을 누르면 기록을 보고 찾고
      남기는 화면들이 나온다.
    */
    const shell = readFileSync(resolve(process.cwd(), 'src/components/MobileShell.tsx'), 'utf8');
    expect(shell).toContain("matchPrefixes: ['/us', '/search', '/record', '/my', '/settings']");
  });

  it('찾기 화면의 펜은 어떤 조건에도 걸려 있지 않다', () => {
    /*
      §7.1 의 제거 불가 진입점은 실제로 여기다. 소스에서 보는 이유는 이 화면을 렌더하려면
      스토어 전체가 필요하고, 여기서 보고 싶은 것은 **조건이 없다**는 구조적 사실이기
      때문이다. 감싸는 조건이 생기면 `{` 앞에 붙은 삼항이나 `&&` 가 함께 들어온다.
    */
    const page = readFileSync(resolve(process.cwd(), 'src/features/search/SearchPage.tsx'), 'utf8');
    const at = page.indexOf('aria-label="기록 남기기"');
    expect(at).toBeGreaterThan(-1);
    // 버튼을 여는 태그부터 그 앞 120자 안에 조건 분기가 없어야 한다.
    const before = page.slice(Math.max(0, at - 240), at);
    expect(before).not.toMatch(/\?\s*\(\s*$|&&\s*\(\s*$/);
    expect(before).toContain('<button');
  });
});

/**
 * 한 동작에 한 이름.
 *
 * 셸의 버튼과 `찾기` 의 펜과 `/record` 의 CTA 는 같은 컴포저를 연다. 한때 그것들이 서로
 * 다른 이름을 가졌고(`기록 남기기` / `지금의 마음 남기기`), 한 화면에서 컨트롤을 배운
 * 사람에게 다음 화면의 같은 컨트롤이 다른 기능처럼 보였다.
 */
describe('기록 남기기는 어디서나 같은 이름이다', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

  it('셸 · 찾기 · CTA · 열리는 시트가 같은 이름을 쓴다', () => {
    expect(read('src/components/MobileShell.tsx')).toContain('aria-label="기록 남기기"');
    expect(read('src/features/search/SearchPage.tsx')).toContain('aria-label="기록 남기기"');
    expect(read('src/pages/RecordPage.tsx')).toContain('<span>기록 남기기</span>');
    expect(read('src/pages/RecordPage.tsx')).toContain('aria-label="기록 남기기"');
  });

  it('두 번째 이름이 남아 있지 않다', () => {
    for (const path of [
      'src/components/MobileShell.tsx',
      'src/pages/RecordPage.tsx',
      'src/features/search/SearchPage.tsx',
    ]) {
      expect(read(path)).not.toContain('지금의 마음 남기기');
    }
  });
});
