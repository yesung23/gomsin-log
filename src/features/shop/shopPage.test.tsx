import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GARDEN_ACCESSORY_OPTIONS } from '@/lib/companionGardenLocalState';
import { loadCompanionShopState } from '@/lib/companionShopLocalState';
import { PAPER_TEXTURE_OPTIONS } from '@/lib/paperTexturePreference';

const navigate = vi.hoisted(() => vi.fn());
const mockedToday = vi.hoisted(() => ({ value: '2026-09-01' }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/lib/cycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cycle')>();
  return { ...actual, localToday: () => mockedToday.value };
});
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
let currentState = {
  authenticatedUser: { id: 'user-me' },
  profile: { id: 'profile-me' },
};
vi.mock('@/lib/useStore', () => ({ useStore: () => ({ state: currentState }) }));

const { ShopPage } = await import('./ShopPage');

function renderShop() {
  return render(<MemoryRouter initialEntries={['/shop']}><ShopPage /></MemoryRouter>);
}

describe('free local companion shop', () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockReset();
    currentState = {
      authenticatedUser: { id: 'user-me' },
      profile: { id: 'profile-me' },
    };
    mockedToday.value = '2026-09-01';
    document.documentElement.removeAttribute('data-paper');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the compact title, two sections, truthful previews, and no payment or Book Studio UI', () => {
    renderShop();
    expect(screen.getByRole('heading', { name: '상점', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '액세서리 뽑기', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '종이 바탕', level: 2 })).toBeInTheDocument();
    expect(PAPER_TEXTURE_OPTIONS.map(({ id }) => screen.getByTestId(`paper-texture-preview-${id}`)
      .getAttribute('data-paper'))).toEqual(['plain', 'ruled', 'grid', 'dot', 'cream']);
    expect(screen.queryByText(/스티커|기억책|Book Studio|결제|구매|구독|코인|포인트|원/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /결제|구매|구독|통화/ })).not.toBeInTheDocument();
  });

  it('starts with only plain and ruled owned and offers deterministic paper collection', async () => {
    const user = userEvent.setup();
    renderShop();
    expect(loadCompanionShopState('user-me').ownedPapers).toEqual(['plain', 'ruled']);
    expect(screen.getByRole('button', { name: '모눈 종이 무료로 받기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '도트 종이 무료로 받기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '크림 편지지 무료로 받기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '줄 노트 사용 중' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: '따뜻한 무지 적용하기' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '모눈 종이 무료로 받기' }));
    expect(loadCompanionShopState('user-me').ownedPapers).toEqual(['plain', 'ruled', 'grid']);
    expect(screen.getByRole('button', { name: '모눈 종이 적용하기' })).toBeInTheDocument();
  });

  it('applies an owned paper immediately to localStorage and the html data-paper attribute', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: '모눈 종이 무료로 받기' }));
    await user.click(screen.getByRole('button', { name: '모눈 종이 적용하기' }));

    expect(localStorage.getItem('gomsin.display.paper.user-me')).toBe('grid');
    expect(document.documentElement).toHaveAttribute('data-paper', 'grid');
    expect(screen.getByRole('button', { name: '모눈 종이 사용 중' })).not.toHaveAttribute('aria-pressed');
  });

  it('draws one unowned accessory per local calendar day and announces the label', async () => {
    const user = userEvent.setup();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    renderShop();
    await user.click(screen.getByRole('button', { name: '오늘의 액세서리 무료 뽑기' }));

    const drawnLabel = GARDEN_ACCESSORY_OPTIONS.find(({ id }) => id === 'cap')?.label;
    expect(loadCompanionShopState('user-me').ownedAccessories).toEqual(['cap']);
    expect(screen.getByRole('status')).toHaveTextContent(drawnLabel as string);
    expect(screen.getByText(drawnLabel as string)).toBeInTheDocument();
    expect(random).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: '오늘 뽑기 완료' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '오늘 뽑기 완료' }));
    expect(loadCompanionShopState('user-me').ownedAccessories).toEqual(['cap']);
  });

  it('labels a complete collection and does not consume a draw', async () => {
    const user = userEvent.setup();
    localStorage.setItem('gomsin.diary.shop.user-me', JSON.stringify({
      version: 1,
      ownedAccessories: ['cap', 'bow', 'scarf', 'flower'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    }));
    renderShop();

    expect(screen.getByRole('button', { name: '모든 액세서리를 모았어요' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '모든 액세서리를 모았어요' }));
    expect(loadCompanionShopState('user-me').lastFreeDrawDate).toBeNull();
    expect(screen.getByText('모자')).toBeInTheDocument();
    expect(screen.getByText('리본')).toBeInTheDocument();
    expect(screen.getByText('목도리')).toBeInTheDocument();
    expect(screen.getByText('꽃')).toBeInTheDocument();
  });

  it('handles an invalid draw result honestly without granting an accessory', async () => {
    const user = userEvent.setup();
    mockedToday.value = '2026-02-30';
    renderShop();
    await user.click(screen.getByRole('button', { name: '오늘의 액세서리 무료 뽑기' }));
    expect(loadCompanionShopState('user-me').ownedAccessories).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('오늘 날짜를 확인할 수 없어 뽑지 못했어요');
  });

  it('unlocks the next free draw when an open Shop crosses local midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 1, 23, 59, 59, 900));
    localStorage.setItem('gomsin.diary.shop.user-me', JSON.stringify({
      version: 1,
      ownedAccessories: ['cap'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: '2026-09-01',
    }));
    renderShop();
    expect(screen.getByRole('button', { name: '오늘 뽑기 완료' })).toBeDisabled();

    mockedToday.value = '2026-09-02';
    act(() => vi.advanceTimersByTime(200));

    expect(screen.getByRole('button', { name: '오늘의 액세서리 무료 뽑기' })).toBeEnabled();
  });

  it('refreshes collection and selected paper when the authenticated account changes', async () => {
    localStorage.setItem('gomsin.diary.shop.user-me', JSON.stringify({
      version: 1,
      ownedAccessories: ['cap'],
      ownedPapers: ['plain', 'ruled', 'grid'],
      lastFreeDrawDate: null,
    }));
    localStorage.setItem('gomsin.display.paper.user-me', 'grid');
    localStorage.setItem('gomsin.diary.shop.profile-me', JSON.stringify({
      version: 1,
      ownedAccessories: ['flower'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    }));
    localStorage.setItem('gomsin.display.paper.profile-me', 'plain');

    const view = renderShop();
    expect(screen.getByText('모자')).toBeInTheDocument();
    expect(screen.queryByText('꽃')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '모눈 종이 사용 중' })).toBeInTheDocument();

    currentState = {
      authenticatedUser: { id: '' },
      profile: { id: 'profile-me' },
    };
    view.rerender(<MemoryRouter initialEntries={['/shop']}><ShopPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('꽃')).toBeInTheDocument();
      expect(screen.queryByText('모자')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '따뜻한 무지 사용 중' })).toBeInTheDocument();
    });
  });

  it('returns to the diary and opens the garden from the Shop app bar', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: '일기장으로 돌아가기' }));
    expect(navigate).toHaveBeenCalledWith('/diary');
    navigate.mockClear();
    await user.click(screen.getByRole('button', { name: '우리 정원 열기' }));
    expect(navigate).toHaveBeenCalledWith('/diary/garden');
  });
});
