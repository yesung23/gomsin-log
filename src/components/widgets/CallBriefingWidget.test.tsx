import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toLocalDateString, localToday } from '@/lib/utils';
import { callBriefingCheckpointKey } from '@/lib/callBriefing';

const setHighlightedRecordId = vi.fn();
let sharedSyncStatus: 'live' | 'delayed' | 'unavailable' = 'live';
const today = toLocalDateString(localToday());
const partnerRecord = {
  id: 'partner-hard',
  userId: 'gomsin-a',
  date: today,
  time: '18:40',
  authorRole: 'gomsin' as const,
  log: '오늘 일이 정말 힘들었어',
  reaction: 'hard' as const,
  isPrivate: false,
  createdAt: `${today}T09:40:00Z`,
};

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      authenticatedUser: { id: 'soldier-a' },
      profile: {
        id: 'soldier-a',
        role: 'soldier',
        couple: { coupleId: 'couple-a', partnerName: '서연', connected: true },
      },
      records: [partnerRecord, { ...partnerRecord, id: 'private', log: '비공개 비밀', isPrivate: true }],
    },
    setHighlightedRecordId,
    sharedSyncStatus,
  }),
}));

const { CallBriefingWidget } = await import('@/components/widgets/CallBriefingWidget');

describe('CallBriefingWidget', () => {
  beforeEach(() => {
    localStorage.clear();
    setHighlightedRecordId.mockClear();
    sharedSyncStatus = 'live';
  });

  it('shows grounded shared context and hides private text', () => {
    render(<MemoryRouter><CallBriefingWidget /></MemoryRouter>);

    expect(screen.getByText('통화 전 60초')).toBeInTheDocument();
    expect(screen.getByText('오늘 일이 정말 힘들었어')).toBeInTheDocument();
    expect(screen.queryByText('비공개 비밀')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('오늘 일이 정말 힘들었어'));
    expect(setHighlightedRecordId).toHaveBeenCalledWith('partner-hard');
  });

  it('marks the newest included context and offers recent history afterwards', () => {
    render(<MemoryRouter><CallBriefingWidget /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '통화했어요 · 여기까지 확인' }));

    expect(JSON.parse(localStorage.getItem(callBriefingCheckpointKey('soldier-a', 'couple-a')) || '{}'))
      .toEqual({ confirmedRecordIds: ['partner-hard'], confirmedAt: partnerRecord.createdAt });
    expect(screen.getByText('지난 통화 이후 새로 공유된 맥락이 없어요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /최근 7일 다시 보기/ })).toBeInTheDocument();
  });

  it('does not claim there are no updates while shared records are unavailable', () => {
    sharedSyncStatus = 'unavailable';
    render(<MemoryRouter><CallBriefingWidget /></MemoryRouter>);

    expect(screen.getByText('공유 기록을 확인하고 있어요.')).toBeInTheDocument();
    expect(screen.queryByText('지난 통화 이후 새로 공유된 맥락이 없어요.')).not.toBeInTheDocument();
  });
});
