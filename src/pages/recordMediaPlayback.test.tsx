import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, Attachment, DailyRecord } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(page) = RecordPage renders a voice or video attachment with no
 *                          element that can play it.
 *
 * `AttachmentMedia.test.tsx` pins the component. This pins the WIRING: both
 * surfaces that show attachments -- the day timeline and the record detail sheet
 * -- have to use it. They were two separate copies of the same filename-chip
 * markup, so fixing one and forgetting the other was the likely failure mode.
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-07-31';

const setHighlightedRecordId = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/records', () => ({
  MEDIA_ACCEPT: 'image/jpeg',
  classifyMediaFile: () => ({ error: 'unsupported' }),
  resolveAttachmentUrls: vi.fn(async (attachments: Attachment[]) => attachments),
}));

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: 'live' as const,
    updateRecord: vi.fn(async () => ({ ok: true as const })),
    deleteRecord: vi.fn(async () => ({ ok: true as const })),
    updateRecordMedia: vi.fn(async () => ({ ok: true as const, failedFiles: [] as string[] })),
    setHighlightedRecordId,
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');

function makeState(records: DailyRecord[]): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    isDemoMode: false,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

/** A shared voice note authored by the partner, exactly what 군화 came to hear. */
function partnerVoiceRecord(): DailyRecord {
  return {
    id: 'rec-voice',
    userId: PARTNER,
    date: TODAY,
    time: '21:30',
    authorRole: 'gomsin',
    log: '오늘 목소리 남겨둘게',
    isPrivate: false,
    createdAt: `${TODAY}T21:30:00.000Z`,
    attachments: [{
      type: 'voice',
      name: '음성기록-1.webm',
      url: 'https://example.supabase.co/signed/voice?token=t',
      path: 'couple-1/rec-voice/voice.webm',
    }],
  };
}

function renderPage(records: DailyRecord[]) {
  currentState = makeState(records);
  // Noon UTC is 21:00 KST on the SAME day, so `localToday()` in this environment
  // still resolves to `TODAY`. A later UTC hour rolls the local date forward and
  // the page opens on an empty tomorrow.
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  return render(
    <MemoryRouter initialEntries={['/record']}>
      <RecordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setHighlightedRecordId.mockClear();
});

describe('RecordPage plays the media it stores', () => {
  it('the day timeline renders a player for a partner voice note', () => {
    const { container } = renderPage([partnerVoiceRecord()]);

    const audio = container.querySelector('audio');
    expect(audio, 'the timeline must render a playable voice note').not.toBeNull();
    expect(audio).toHaveAttribute('controls');
  });

  it('the detail sheet renders a player too', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderPage([partnerVoiceRecord()]);

    await user.click(await screen.findByText('21:30'));

    // Both surfaces are mounted at this point, so assert the sheet's own copy.
    const players = container.querySelectorAll('audio');
    expect(players.length).toBeGreaterThanOrEqual(2);
    players.forEach((player) => expect(player).toHaveAttribute('controls'));
  });

  it('a video attachment gets a video player in the timeline', () => {
    const { container } = renderPage([{
      ...partnerVoiceRecord(),
      id: 'rec-video',
      attachments: [{
        type: 'video',
        name: 'clip.mp4',
        url: 'https://example.supabase.co/signed/video?token=t',
        path: 'couple-1/rec-video/clip.mp4',
      }],
    }]);

    expect(container.querySelector('video')).not.toBeNull();
  });

  it('PRESERVATION: a photo is still an <img>, not a player', () => {
    const { container } = renderPage([{
      ...partnerVoiceRecord(),
      id: 'rec-photo',
      attachments: [{
        type: 'photo',
        name: 'photo.jpg',
        url: 'https://example.supabase.co/signed/photo?token=t',
        path: 'couple-1/rec-photo/photo.jpg',
      }],
    }]);

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('audio')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  it('PRESERVATION: an unsignable attachment still explains itself instead of pretending', () => {
    renderPage([{
      ...partnerVoiceRecord(),
      attachments: [{
        type: 'voice',
        name: '음성기록-1.webm',
        path: 'couple-1/rec-voice/voice.webm',
        urlUnavailable: 'forbidden',
      }],
    }]);

    expect(screen.getAllByText(/이 파일을 열 수 없어요/).length).toBeGreaterThanOrEqual(1);
  });
});
