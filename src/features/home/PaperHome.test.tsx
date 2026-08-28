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

let records: DailyRecord[] = [];
const markTalkAbout = vi.fn();
const unmarkTalkAbout = vi.fn();

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      records,
      talkAboutMarks: [],
      profile: {
        id: 'me',
        role: 'soldier',
        myName: '나',
        couple: {
          connected: true,
          status: 'active',
          coupleId: 'couple-1',
          partnerName: '예성',
        },
      },
    },
    markTalkAbout,
    unmarkTalkAbout,
  }),
}));

vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({ surface: [] }),
}));

vi.mock('@/lib/usePartnerCareNote', () => ({
  usePartnerCareNote: () => null,
}));

vi.mock('@/components/CoupleStatusBanner', () => ({
  CoupleStatusBanner: () => null,
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId }: { recordId: string }) => (
    <div data-testid={`media-${recordId}`} />
  ),
}));

function view() {
  return render(<MemoryRouter><PaperHome /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  records = [{
    id: 'record-1',
    userId: 'partner',
    date: localToday(),
    time: '01:23:00',
    authorRole: 'gomsin',
    log: '오늘 하루도 함께해줘서 고마워',
    isPrivate: false,
    attachments: [{ type: 'photo', name: '오늘.jpg' }],
  } as DailyRecord];
});

describe('홈 포스트 읽기 순서', () => {
  it('사진 다음에 이름 없는 글, 그 아래 분 단위 시간과 책갈피를 표시한다', () => {
    view();

    const body = screen.getByText('오늘 하루도 함께해줘서 고마워');
    const article = body.closest('article');
    expect(article).not.toBeNull();

    const post = within(article!);
    const media = post.getByTestId('media-record-1');
    const bookmark = post.getByRole('button', { name: '이따 이야기하기' });
    const time = post.getByText('오늘 01:23');

    expect(article).not.toHaveTextContent('예성');
    expect(article).not.toHaveTextContent('01:23:00');
    expect(body).toHaveClass('record-copy');
    expect(time).not.toHaveClass('record-copy');
    expect(media.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(bookmark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
