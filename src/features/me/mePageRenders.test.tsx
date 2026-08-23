import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * `/me` 가 **실제 부품으로** 그려지는가.
 *
 * 옆의 `mePage.test.tsx` 는 `MobileShell` · `AppBar` · 배려 신호 · 주기 셋을 전부 목으로
 * 갈아끼운다. 그 파일이 지키는 것은 배치(무엇이 어떤 순서로 오는가)이고 그건 그 방식이
 * 맞다 -- 다만 그렇게 갈아끼우면 **부품이 마운트되다 죽는 경우를 볼 수 없다.**
 *
 * 실제로 그런 일이 있었다. 이 화면은 `CycleSupportSection` 을 둘 띄우는데(내가 보낸 것 ·
 * 상대가 보낸 것) 둘이 같은 realtime 토픽을 쓰는 바람에, 둘째가 이미 `subscribe()` 된
 * 채널에 `.on()` 을 걸다 던졌다. effect 에서 던진 오류는 ErrorBoundary 까지 올라가므로
 * 연결된 커플에게 `/me` 는 **빈 화면**이었다. 목을 낀 테스트 전부가 초록이었다.
 *
 * 그래서 이 파일은 목을 최소한만 쓴다. 스토어와 jsdom 이 갖지 않은 브라우저 API 둘뿐이다.
 */
const state = {
  profile: {
    id: 'user-creator',
    myName: '춘향',
    role: 'gomsin' as const,
    couple: {
      coupleId: 'couple-1',
      connected: true,
      partnerName: '몽룡',
      status: 'active' as const,
      anniversaryDate: null,
    },
    military: {},
    contact: {},
  },
  authenticatedUser: { id: 'user-creator' },
  records: [],
  events: [],
};

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state, isReady: true, coupleLifecycle: 'connected' }),
}));

beforeAll(() => {
  // jsdom 에 없는 것 둘. 브라우저에는 있으므로 이 목이 결함을 가리지 않는다.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

const { MePage } = await import('@/features/me/MePage');

describe('/me 는 연결된 커플에게도 그려진다', () => {
  it('셸이 살아 있다 — main 이 있다', () => {
    render(<MemoryRouter><MePage /></MemoryRouter>);
    expect(document.querySelector('main')).not.toBeNull();
  });

  /*
    배려 신호가 **둘 다** 마운트된 뒤에도 살아 있어야 한다. 하나만 띄우면 토픽 충돌이
    일어나지 않으므로, 이 테스트의 값어치는 전적으로 둘이 같이 뜨는 데 있다.
  */
  it('내가 보낸 것과 상대가 보낸 것이 같이 떠도 죽지 않는다', async () => {
    render(<MemoryRouter><MePage /></MemoryRouter>);
    expect(await screen.findByText('나', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(document.querySelector('main')).not.toBeNull();
  });
});
