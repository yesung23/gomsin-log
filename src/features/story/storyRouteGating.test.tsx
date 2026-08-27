import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useParams, useSearchParams } from 'react-router-dom';
import { App } from '@/App';
import type { AppState } from '@/types';

const { mockState } = vi.hoisted(() => ({
  mockState: {
    setupComplete: false,
    authenticatedUser: null as { id: string; email?: string } | null,
    profile: { id: 'u1', role: 'gomsin', couple: { connected: false } },
    onboardingStep: 0,
    records: [],
    events: [],
    trips: [],
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as unknown as AppState,
}));

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: mockState,
    isReady: true,
    authSyncUnavailable: false,
    authSyncReason: null,
    authSyncStage: null,
    accountDeletionRecovery: false,
    signOut: vi.fn(),
    retryAccountDeletion: vi.fn(),
  }),
}));

vi.mock('@/lib/pushNotifications', () => ({
  listenForPushTaps: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@/lib/handwritingPreference', () => ({
  applyHandwritingAttribute: vi.fn(),
  loadHandwritingEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/components/NotificationReentryBridge', () => ({
  NotificationReentryBridge: () => null,
}));

vi.mock('@/pages/HomePage', () => ({
  HomePage: () => <div data-testid="home-page">HOME_PAGE</div>,
}));

vi.mock('@/pages/OnboardingPage', () => ({
  OnboardingPage: () => <div data-testid="onboarding-landing">ONBOARDING_LANDING</div>,
}));

vi.mock('@/features/story/StoryRoute', () => ({
  StoryRoute: ({ mode }: { mode: string }) => {
    const params = useParams();
    const [searchParams] = useSearchParams();
    return (
      <div
        data-testid={`story-route-${mode}`}
        data-mode={mode}
        data-date={params.date}
        data-highlight-id={params.highlightId}
        data-at={searchParams.get('at') ?? ''}
      >
        STORY_ROUTE_{mode}
      </div>
    );
  },
}));

const REPRESENTATIVE_STORY_PATHS = [
  { path: '/story/partner', expectedMode: 'today' },
  { path: '/story/mine', expectedMode: 'mine' },
  {
    path: '/story/day/2026-08-27',
    expectedMode: 'archive',
    expectedParamKey: 'date',
    expectedParamValue: '2026-08-27',
  },
  {
    path: '/story/highlight/summer-trip',
    expectedMode: 'highlight',
    expectedParamKey: 'highlightId',
    expectedParamValue: 'summer-trip',
  },
] as const;

describe('StoryRoute setupComplete gating in App router', () => {
  describe('unauthenticated cold-start and deep-links', () => {
    beforeEach(() => {
      mockState.setupComplete = false;
      mockState.authenticatedUser = null;
    });

    for (const { path } of REPRESENTATIVE_STORY_PATHS) {
      it(`routes ${path} to connection-first onboarding landing instead of stranding on story`, async () => {
        render(
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>,
        );

        expect(await screen.findByTestId('onboarding-landing')).toBeInTheDocument();
        expect(screen.queryByTestId(/^story-route-/)).not.toBeInTheDocument();
      });
    }
  });

  describe('authenticated navigation and deep-links', () => {
    beforeEach(() => {
      mockState.setupComplete = true;
      mockState.authenticatedUser = { id: 'u1', email: 'test@example.com' };
    });

    for (const { path, expectedMode, expectedParamKey, expectedParamValue } of REPRESENTATIVE_STORY_PATHS) {
      it(`preserves exact authenticated route and parameter semantics for ${path}`, async () => {
        render(
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>,
        );

        const storyElement = await screen.findByTestId(`story-route-${expectedMode}`);
        expect(storyElement).toBeInTheDocument();
        expect(storyElement).toHaveAttribute('data-mode', expectedMode);

        if (expectedParamKey && expectedParamValue) {
          expect(storyElement).toHaveAttribute(
            expectedParamKey === 'date' ? 'data-date' : 'data-highlight-id',
            expectedParamValue,
          );
        }
        expect(screen.queryByTestId('onboarding-landing')).not.toBeInTheDocument();
      });
    }

    it('preserves query parameters (?at=record-id) on authenticated story deep-links', async () => {
      render(
        <MemoryRouter initialEntries={['/story/partner?at=rec-exact-456']}>
          <App />
        </MemoryRouter>,
      );

      const storyElement = await screen.findByTestId('story-route-today');
      expect(storyElement).toBeInTheDocument();
      expect(storyElement).toHaveAttribute('data-at', 'rec-exact-456');
      expect(screen.queryByTestId('onboarding-landing')).not.toBeInTheDocument();
    });
  });
});
