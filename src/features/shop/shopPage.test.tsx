import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GARDEN_ACCESSORY_OPTIONS } from '@/lib/companionGardenLocalState';
import { loadCompanionShopState } from '@/lib/companionShopLocalState';
import { PAPER_TEXTURE_OPTIONS } from '@/lib/paperTexturePreference';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
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

afterEach(() => vi.restoreAllMocks());

describe('free local companion shop', () => {
  beforeEach(() => {
    localStorage.clear();
    navigate.mockReset();
    currentState = {
      authenticatedUser: { id: 'user-me' },
      profile: { id: 'profile-me' },
    };
    document.documentElement.removeAttribute('data-paper');
  });

  it('shows the compact title, two sections, truthful previews, and no payment or Book Studio UI', () => {
    renderShop();
    expect(screen.getByRole('heading', { name: '상점', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '액세서리 컬렉션', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '종이 바탕', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('지금 상점은 모두 무료이며 결제 기능이 없어요.')).toBeInTheDocument();
    expect(PAPER_TEXTURE_OPTIONS.map(({ id }) => screen.getByTestId(`paper-texture-preview-${id}`)
      .getAttribute('data-paper'))).toEqual(['plain', 'ruled', 'grid', 'dot', 'cream']);
    expect(screen.queryByText(/스티커|기억책|Book Studio|구매|구독|코인|포인트|\d[\d, ]*원/)).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: '따뜻한 무지 적용하기' }));
    expect(screen.getByRole('region', { name: '종이 바탕' }))
      .toContainElement(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveTextContent('따뜻한 무지를 적용했어요.');
    await user.click(screen.getByRole('button', { name: '줄 노트 적용하기' }));
    expect(screen.getByRole('status')).toHaveTextContent('줄 노트를 적용했어요.');

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

  it('shows every finite starter accessory as a direct choice without draw UI or date language', () => {
    renderShop();

    expect(screen.getByTestId('accessory-draw-roulette')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' })).toBeEnabled();
    expect(screen.queryByText(/오늘|마감|자정|기회/)).not.toBeInTheDocument();
  });

  it('persists the draw first, hides the result during a complete wheel spin, then reveals it', async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    renderShop();

    const drawButton = screen.getByRole('button', { name: '회전 뽑기로 장식 받기' });
    await user.click(drawButton);

    const stateAfterClick = loadCompanionShopState('user-me');
    expect(stateAfterClick.ownedAccessories).toEqual(['boots']);
    expect(screen.queryByTestId('starter-reveal-result')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const wheel = screen.getByTestId('accessory-roulette-wheel');
    expect(wheel).toHaveClass('accessory-roulette-spinning');
    expect(wheel.style.getPropertyValue('--accessory-roulette-duration')).toBe('1200ms');
    fireEvent.animationEnd(wheel);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent('검정 부츠를 무료로 받았어요.');
    expect(screen.getByTestId('starter-reveal-result')).toBeInTheDocument();
  });

  it('keeps the item unowned and announces an error when collection persistence fails', async () => {
    const user = userEvent.setup();
    renderShop();
    vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await user.click(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' }));

    expect(loadCompanionShopState('user-me').ownedAccessories).toEqual([]);
    expect(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('액세서리를 저장하지 못했어요.');
  });

  it('keeps a paper unowned and announces the storage error inside the paper section', async () => {
    const user = userEvent.setup();
    renderShop();
    vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    await user.click(screen.getByRole('button', { name: '모눈 종이 무료로 받기' }));

    expect(loadCompanionShopState('user-me').ownedPapers).toEqual(['plain', 'ruled']);
    expect(screen.getByRole('button', { name: '모눈 종이 무료로 받기' })).toBeEnabled();
    const paperSection = screen.getByRole('region', { name: '종이 바탕' });
    expect(paperSection).toContainElement(screen.getByRole('alert'));
    expect(screen.getByRole('alert')).toHaveTextContent('종이를 저장하지 못했어요.');
  });

  it('keeps an owned accessory disabled while a legacy draw date does not block new collection', async () => {
    const user = userEvent.setup();
    localStorage.setItem('gomsin.diary.shop.user-me', JSON.stringify({
      version: 1,
      ownedAccessories: ['boots'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: '2026-09-01',
    }));
    renderShop();

    expect(screen.getByText('검정 부츠')).toBeInTheDocument();
    const drawButton = screen.getByRole('button', { name: '회전 뽑기로 장식 받기' });
    expect(drawButton).toBeEnabled();
    await user.click(drawButton);
    expect(loadCompanionShopState('user-me').ownedAccessories.length).toBe(2);
  });

  it('disables every signed-out accessory and paper action with no mutation or success announcement', () => {
    currentState = {
      authenticatedUser: { id: '' },
      profile: { id: 'profile-me' },
    };
    renderShop();

    const loginReason = screen.getByText('로그인하면 무료 수집과 종이 적용을 이용할 수 있어요.');
    const drawButton = screen.getByRole('button', { name: '회전 뽑기로 장식 받기' });
    const paperButtons = [
      '따뜻한 무지 적용하기',
      '줄 노트 사용 중',
      '모눈 종이 무료로 받기',
      '도트 종이 무료로 받기',
      '크림 편지지 무료로 받기',
    ].map((label) => screen.getByRole('button', { name: label }));

    [drawButton, ...paperButtons].forEach((button) => {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-describedby', loginReason.id);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(loadCompanionShopState('profile-me').ownedAccessories).toEqual([]);
  });

  it('refreshes collection and selected paper when the authenticated account changes', async () => {
    localStorage.setItem('gomsin.diary.shop.user-me', JSON.stringify({
      version: 1,
      ownedAccessories: ['boots', 'sneakers', 'letter', 'dogtag', 'plane'],
      ownedPapers: ['plain', 'ruled', 'grid'],
      lastFreeDrawDate: null,
    }));
    localStorage.setItem('gomsin.display.paper.user-me', 'grid');
    localStorage.setItem('gomsin.diary.shop.user-other', JSON.stringify({
      version: 1,
      ownedAccessories: ['boots'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    }));
    localStorage.setItem('gomsin.display.paper.user-other', 'plain');

    const view = renderShop();
    expect(screen.getByRole('button', { name: '모든 기본 장식을 모았어요' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '모눈 종이 사용 중' })).toBeInTheDocument();

    currentState = {
      authenticatedUser: { id: 'user-other' },
      profile: { id: 'profile-other' },
    };
    view.rerender(<MemoryRouter initialEntries={['/shop']}><ShopPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' })).toBeEnabled();
      expect(screen.getByRole('button', { name: '따뜻한 무지 사용 중' })).toBeInTheDocument();
    });
  });

  it('reconciles a retained unowned paper after malformed collection data', async () => {
    localStorage.setItem('gomsin.diary.shop.user-me', '{malformed-json');
    localStorage.setItem('gomsin.display.paper.user-me', 'grid');

    renderShop();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '줄 노트 사용 중' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '모눈 종이 사용 중' })).not.toBeInTheDocument();
    expect(localStorage.getItem('gomsin.display.paper.user-me')).toBe('ruled');
    expect(document.documentElement).toHaveAttribute('data-paper', 'ruled');
  });

  it('disables the draw button when isSpinning and prevents duplicate draw clicks', async () => {
    const user = userEvent.setup();
    renderShop();

    const drawButton = screen.getByRole('button', { name: '회전 뽑기로 장식 받기' });
    await user.click(drawButton);

    expect(drawButton).toBeDisabled();
    expect(drawButton.textContent).toBe('장식 찾는 중...');

    await user.click(drawButton);
    expect(loadCompanionShopState('user-me').ownedAccessories.length).toBe(1);

    fireEvent.animationEnd(screen.getByTestId('accessory-roulette-wheel'));
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('locks paper actions during the spin and reloads the latest persisted state at completion', async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    renderShop();

    await user.click(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' }));
    const paperButton = screen.getByRole('button', { name: '모눈 종이 무료로 받기' });
    expect(paperButton).toBeDisabled();

    const stored = JSON.parse(localStorage.getItem('gomsin.diary.shop.user-me') || '{}');
    localStorage.setItem('gomsin.diary.shop.user-me', JSON.stringify({
      ...stored,
      ownedPapers: ['plain', 'ruled', 'grid'],
    }));

    fireEvent.animationEnd(screen.getByTestId('accessory-roulette-wheel'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '모눈 종이 적용하기' })).toBeInTheDocument();
    });
    expect(loadCompanionShopState('user-me').ownedAccessories).toEqual(['boots']);
  });

  it('cancels pending reveal UI when the authenticated account changes', async () => {
    const user = userEvent.setup();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const view = renderShop();

    await user.click(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' }));
    expect(loadCompanionShopState('user-me').ownedAccessories).toEqual(['boots']);

    currentState = {
      authenticatedUser: { id: 'user-other' },
      profile: { id: 'profile-other' },
    };
    view.rerender(<MemoryRouter initialEntries={['/shop']}><ShopPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' })).toBeEnabled();
    });
    expect(screen.getByTestId('accessory-draw-roulette')).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByTestId('starter-reveal-result')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(loadCompanionShopState('user-other').ownedAccessories).toEqual([]);
  });

  it('reveals immediately without spinning when reduced motion is requested', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const user = userEvent.setup();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      renderShop();
      await user.click(screen.getByRole('button', { name: '회전 뽑기로 장식 받기' }));

      expect(screen.getByTestId('accessory-roulette-wheel')).not.toHaveClass('accessory-roulette-spinning');
      expect(screen.getByTestId('starter-reveal-result')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('검정 부츠를 무료로 받았어요.');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('disables the draw button and shows completion copy when all 5 starter items are owned', () => {
    localStorage.setItem('gomsin.diary.shop.user-me', JSON.stringify({
      version: 1,
      ownedAccessories: ['boots', 'sneakers', 'letter', 'dogtag', 'plane'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    }));
    renderShop();

    const completeButton = screen.getByRole('button', { name: '모든 기본 장식을 모았어요' });
    expect(completeButton).toBeDisabled();
    expect(screen.getByText('준비된 무료 장식 5종을 모두 보유하고 있어요.')).toBeInTheDocument();
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
