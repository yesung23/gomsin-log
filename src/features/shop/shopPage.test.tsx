import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      authenticatedUser: { id: 'user-me' },
      profile: { id: 'user-me' },
    },
  }),
}));

const { ShopPage } = await import('./ShopPage');

function renderShop() {
  return render(<MemoryRouter initialEntries={['/shop']}><ShopPage /></MemoryRouter>);
}

describe('paper-only library', () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockReset();
  });

  it('shows exactly the five approved papers and no unvalidated catalog', () => {
    renderShop();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((item) => item.getAttribute('aria-label'))).toEqual([
      '따뜻한 무지', '줄 노트', '모눈 종이', '도트 종이', '크림 편지지',
    ]);
    expect(screen.queryByText(/스티커 팩|기억책|100일|1주년|유료 테마/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /결제|구매|구독/ })).not.toBeInTheDocument();
  });

  it('persists the selected default paper on this account/device', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('radio', { name: '모눈 종이' }));
    expect(localStorage.getItem('gomsin.diary.paper.user-me')).toBe('grid');
  });

  it('does not expose a category/filter surface for hidden products', () => {
    renderShop();
    expect(screen.queryByRole('tablist', { name: /상품/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '내 일기장 종이' })).toBeInTheDocument();
  });

  it('returns to the diary', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: '일기장으로 돌아가기' }));
    expect(navigate).toHaveBeenCalledWith('/diary');
  });
});
