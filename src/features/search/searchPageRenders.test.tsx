import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
    military: {
      branch: 'army' as const,
      militaryStatus: 'serving' as const,
      enlistmentDate: '2025-09-01',
      expectedDischargeDate: '2027-05-31',
    },
    contact: {
      enabled: true,
      weekdayStart: '18:00',
      weekdayEnd: '21:00',
      weekendStart: '10:00',
      weekendEnd: '21:00',
    },
  },
  authenticatedUser: { id: 'user-creator' },
  records: [],
  events: [],
};

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state, isReady: true, coupleLifecycle: 'connected' }),
}));

beforeAll(() => {
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

const { SearchPage } = await import('@/features/search/SearchPage');

describe('SearchPage 실제 컴포넌트 마운트', () => {
  it('셸과 검색 입력란이 마운트된다', () => {
    render(
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>,
    );
    expect(document.querySelector('main')).not.toBeNull();
    expect(screen.getByPlaceholderText('쓴 말이나 날짜로 찾기')).toBeInTheDocument();
  });
});
