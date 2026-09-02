import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaperHome } from '@/features/home/PaperHome';
import { localToday } from '@/lib/cycle';
import type { DailyRecord } from '@/types';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const partnerRecord = {
  id: 'partner-record',
  userId: 'partner',
  date: localToday(),
  time: '12:00:00',
  authorRole: 'gomsin',
  log: '오늘의 기록',
  isPrivate: false,
} as DailyRecord;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      records: [partnerRecord],
      talkAboutMarks: [],
      profile: {
        id: 'me',
        role: 'soldier',
        myName: '나',
        couple: {
          connected: true,
          status: 'active',
          coupleId: 'couple-1',
          partnerUserId: 'partner',
          partnerName: '예성',
        },
      },
    },
    coupleLifecycle: 'connected',
    markTalkAbout: vi.fn(),
    unmarkTalkAbout: vi.fn(),
  }),
}));

vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({ surface: [partnerRecord] }),
}));

vi.mock('@/lib/usePartnerCareNote', () => ({
  usePartnerCareNote: () => null,
}));

vi.mock('@/components/CoupleStatusBanner', () => ({
  CoupleStatusBanner: () => null,
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaperHome immediate press feedback', () => {
  it('gives every visible Home action the shared press response', () => {
    render(<MemoryRouter><PaperHome /></MemoryRouter>);

    const currentNeed = screen.getByRole('region', { name: '지금 가장 필요한 것' });
    const actions = [
      screen.getByRole('button', { name: '이야기할 것' }),
      screen.getByRole('button', { name: '내 스토리' }),
      screen.getByRole('button', { name: '기록 남기기' }),
      screen.getByRole('button', { name: '예성의 스토리' }),
      within(currentNeed).getByRole('button'),
      screen.getByRole('button', { name: '예성의 기록 열기' }),
      screen.getByRole('button', { name: '이따 이야기하기' }),
    ];

    for (const action of actions) {
      expect(action).toHaveClass('press-response');
    }
  });
});
