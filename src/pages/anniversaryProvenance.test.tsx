import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import type { AppState } from '@/types';

/**
 * M-1 (continued): an absent anniversary must not be back-filled either.
 *
 * The same class of invention M-1 removed from the service period survived for
 * the anniversary, in the one place that renders it most prominently.
 *
 * `sync.ts` maps a null `couples.anniversary_date` to `''`, and `UsPage` did
 * `anniversaryDate || '2024-12-24'` and then rendered `함께한 지 +N일째 💕`
 * unconditionally for a connected couple. So a couple who never entered a date
 * -- or who skipped it with 지금은 설정하지 않을래요 during onboarding -- was told
 * a specific number of days they had been together, counted from a literal
 * nobody chose.
 *
 * `DDayWidget` on this same branch already gets this right: it renders
 * `기념일 미설정` and routes to settings. These tests hold `UsPage` to the
 * behaviour its sibling surface already has.
 */

const FABRICATED_ANNIVERSARY = '2024-12-24';

let storeState: AppState;
let lifecycle: string;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: storeState, coupleLifecycle: lifecycle }),
}));

vi.mock('@/components/CoupleAvatar', () => ({
  CoupleAvatar: () => <div data-testid="couple-avatar" />,
}));

const { UsPage } = await import('@/pages/UsPage');
const { DDayWidget } = await import('@/components/widgets/DDayWidget');

function baseState(anniversaryDate: string | undefined): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'user-a', email: 'a@example.com', provider: 'google' },
    profile: {
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate,
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {
        branch: 'army',
        militaryStatus: 'unknown',
        dischargeDateSource: 'unknown',
      },
      contact: {
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '12:00',
        weekendEnd: '21:00',
        enabled: true,
      },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as unknown as AppState;
}

function renderUsPage() {
  return render(
    <MemoryRouter>
      <UsPage />
    </MemoryRouter>,
  );
}

/**
 * The shared setup only installs `matchMedia` when jsdom has not declared it,
 * and the global `restoreAllMocks` can leave it non-callable for a file that
 * renders a subtree touching it. Reinstall per test rather than weakening setup.
 */
function ensureMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('M-1: UsPage invents no anniversary', () => {
  beforeEach(() => {
    lifecycle = 'connected';
    ensureMatchMedia();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not claim a day count when no anniversary was ever entered', () => {
    storeState = baseState(undefined);
    renderUsPage();
    expect(screen.queryByText(/함께한 지 \+\d+일째/)).toBeNull();
  });

  it('does not claim a day count for the empty string sync.ts produces from a null column', () => {
    // `sync.ts`: `anniversaryDate: coupleData?.anniversary_date || ''`
    storeState = baseState('');
    renderUsPage();
    expect(screen.queryByText(/함께한 지 \+\d+일째/)).toBeNull();
  });

  it('says the anniversary is unset instead, matching DDayWidget', () => {
    storeState = baseState(undefined);
    renderUsPage();
    expect(screen.getByText(/기념일 미설정/)).toBeInTheDocument();
  });

  it('never renders a count derived from the fabricated literal', () => {
    storeState = baseState(undefined);
    renderUsPage();
    const daysSinceFabricated = Math.floor(
      (Date.now() - new Date(FABRICATED_ANNIVERSARY).getTime()) / 86_400_000,
    ) + 1;
    expect(screen.queryByText(new RegExp(String(daysSinceFabricated)))).toBeNull();
  });

  it('UsPage.tsx no longer contains the fabricated literal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/UsPage.tsx'), 'utf8');
    const startDateDecl = source
      .slice(source.indexOf('couple.anniversaryDate'))
      .split('\n')[0];
    expect(startDateDecl).not.toContain(FABRICATED_ANNIVERSARY);
  });

  it('PRESERVATION: a real anniversary is still counted, inclusive of day one', () => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    storeState = baseState(todayStr);
    renderUsPage();
    expect(screen.getByText(/1일째 같은 하늘 아래/)).toBeInTheDocument();
  });

  it('PRESERVATION: a non-connected lifecycle keeps its own copy', () => {
    /*
      이 단언이 지키는 것은 특정 문장이 아니라 **연결되지 않은 커플이 그 사실을 이 화면에서
      본다**는 것이다. 앞선 판에서는 그 문장을 `UsPage` 가 직접 들고 있었고, V4가 화면을
      인스타 프로필로 바꾸면서 사라졌다.

      같은 보장을 `CoupleStatusBanner` 가 진다 -- 상태별 문구를 그 컴포넌트가 소유하고,
      연결된 커플에게는 아무것도 그리지 않는다. 그래서 단언을 그 배너의 상태 표식으로
      옮긴다. 문장이 바뀌어도 보장은 남고, 배너가 빠지면 여기서 걸린다.
    */
    lifecycle = 'pending';
    storeState = baseState(undefined);
    storeState.profile.couple.connected = false;
    renderUsPage();
    const banner = screen.getByTestId('couple-status-banner');
    expect(banner).toHaveAttribute('data-lifecycle', 'pending');
    expect(banner.textContent).toContain('상대방을 기다리고 있어요');
  });
});

describe('M-1: DEFAULT_STATE seeds no anniversary either', () => {
  it('store.tsx does not seed the default couple with a literal date', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/store.tsx'), 'utf8');
    const at = source.indexOf('const DEFAULT_STATE');
    expect(at).toBeGreaterThan(-1);
    // The couple block of DEFAULT_STATE, up to the military block that M-1
    // already cleaned.
    const defaultBlock = source.slice(at, source.indexOf('military:', at));
    expect(defaultBlock).not.toMatch(/anniversaryDate: '\d{4}-\d{2}-\d{2}'/);
  });
});

describe('PRESERVATION: DDayWidget already handles an unset anniversary', () => {
  beforeEach(() => {
    lifecycle = 'connected';
    ensureMatchMedia();
  });

  it('shows 기념일 미설정 rather than a count', () => {
    storeState = baseState(undefined);
    render(
      <MemoryRouter>
        <DDayWidget />
      </MemoryRouter>,
    );
    expect(screen.getByText('기념일 미설정')).toBeInTheDocument();
  });
});
