import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const reloadCalls = vi.fn();
const state = {
  authenticatedUser: { id: 'user-a', provider: 'google' as const },
  profile: {
    myName: '춘향',
    role: 'gomsin' as const,
    couple: {
      coupleId: 'couple-a',
      partnerName: '몽룡',
      anniversaryDate: '2025-01-01',
      coupleCode: '',
      connected: true,
      status: 'active' as const,
    },
    military: {},
    contact: {},
  },
  events: [],
  records: [],
  trips: [],
  setupComplete: true,
  onboardingStep: 0,
  isDemoMode: false,
  widgetLayout: [],
  hasSeenInstallPrompt: false,
  theme: 'light' as const,
};

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state,
    addEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    // Deliberately return a new function on every render, matching the current
    // inline StoreProvider action identity.
    reloadEvents: () => {
      reloadCalls();
      return Promise.resolve({ ok: true as const });
    },
  }),
}));

const { SchedulePage } = await import('@/pages/SchedulePage');

describe('SchedulePage loading lifecycle', () => {
  it('loads once per identity/workspace instead of looping on action identity changes', async () => {
    reloadCalls.mockClear();
    render(<SchedulePage />);

    expect(await screen.findByText('공유·개인 일정')).toBeInTheDocument();
    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(reloadCalls).toHaveBeenCalledTimes(1);
  });
});
