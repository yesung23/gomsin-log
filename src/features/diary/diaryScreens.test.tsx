import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord } from '@/types';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/AppBar', () => ({
  AppBar: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  AppBarAction: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: () => <div data-testid="media-gallery" />,
}));

let currentState: AppState;
vi.mock('@/lib/useStore', () => ({ useStore: () => ({ state: currentState, isReady: true }) }));

const { DiaryPage } = await import('./DiaryPage');

const ME = 'user-me';
function record(partial: Partial<DailyRecord> & { date: string }): DailyRecord {
  return {
    id: partial.id ?? `${partial.date}-${partial.time ?? '09:00'}`,
    userId: partial.userId ?? ME,
    date: partial.date,
    time: partial.time ?? '09:00',
    authorRole: partial.authorRole ?? 'gomsin',
    log: partial.log ?? '오늘은 기뻤어',
    isPrivate: partial.isPrivate ?? false,
    createdAt: `${partial.date}T00:00:00.000Z`,
    ...partial,
  };
}
function stateWith(records: DailyRecord[]): AppState {
  return {
    records,
    events: [],
    trips: [],
    authenticatedUser: { id: ME },
    profile: {
      id: ME,
      myName: '나',
      role: 'gomsin',
      couple: { partnerName: '너', coupleId: 'couple-1', coupleCode: '', connected: true, status: 'active' },
      military: { branch: 'army', militaryStatus: 'serving', dischargeDateSource: 'manual' },
      contact: { weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '10:00', weekendEnd: '21:00', enabled: false },
    },
  } as unknown as AppState;
}
function renderDiary() {
  return render(<MemoryRouter initialEntries={['/diary']}><DiaryPage /></MemoryRouter>);
}

beforeEach(() => {
  navigate.mockReset();
  localStorage.clear();
  currentState = stateWith([
    record({ id: 'a', date: '2026-08-02', time: '08:00', log: '8월 첫 기록' }),
    record({ id: 'b', date: '2026-08-14', time: '21:00', log: '8월 둘째 기록' }),
    record({ id: 'c', date: '2026-06-30', log: '6월 기록' }),
  ]);
});

describe('day-page diary', () => {
  it('keeps month cards but opens a single date page instead of duplicating the whole month', async () => {
    const user = userEvent.setup();
    renderDiary();
    expect(screen.getAllByRole('button', { name: /지면 열기$/ }).map((button) => button.getAttribute('aria-label')))
      .toEqual(['2026년 8월 지면 열기', '2026년 6월 지면 열기']);

    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.getByText('8월 첫 기록')).toBeInTheDocument();
    expect(screen.queryByText('8월 둘째 기록')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '8월 14일 페이지' }));
    expect(screen.getByText('8월 둘째 기록')).toBeInTheDocument();
    expect(screen.queryByText('8월 첫 기록')).not.toBeInTheDocument();
  });

  it('switches date-specific paper synchronously and keeps edit mode open', async () => {
    localStorage.setItem('gomsin.diary.page.user-me.2026-08-14', JSON.stringify({
      version: 1, paperId: 'grid', layout: 'compact', order: [], excluded: [],
    }));
    const user = userEvent.setup();
    renderDiary();
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    await user.click(screen.getByRole('button', { name: '페이지 편집' }));
    await user.click(screen.getByRole('button', { name: '8월 14일 페이지' }));

    expect(screen.getByRole('button', { name: '편집 완료' })).toBeInTheDocument();
    const paper = screen.getByTestId('diary-paper');
    expect(paper).toHaveAttribute('data-paper', 'grid');
    expect(paper).toHaveAttribute('data-layout', 'compact');
  });

  it('can exclude a record without modifying the source record', async () => {
    currentState = stateWith([
      record({ id: 'a', date: '2026-08-02', time: '08:00', log: '첫 기록' }),
      record({ id: 'b', date: '2026-08-02', time: '09:00', log: '둘째 기록' }),
    ]);
    const user = userEvent.setup();
    renderDiary();
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    await user.click(screen.getByRole('button', { name: '페이지 편집' }));
    await user.click(screen.getByRole('checkbox', { name: '첫 기록 포함' }));
    expect(screen.queryByText('첫 기록', { selector: 'p' })).not.toBeInTheDocument();
    expect(currentState.records.find((item) => item.id === 'a')?.log).toBe('첫 기록');
  });

  it('persists paper and layout for the selected day', async () => {
    const user = userEvent.setup();
    renderDiary();
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    await user.click(screen.getByRole('button', { name: '페이지 편집' }));
    await user.click(screen.getByRole('radio', { name: '크림 편지지' }));
    await user.click(screen.getByRole('radio', { name: '사진 먼저' }));
    const saved = JSON.parse(localStorage.getItem('gomsin.diary.page.user-me.2026-08-02') || '{}');
    expect(saved).toMatchObject({ paperId: 'cream', layout: 'photo-first' });
  });

  it('does not render the legacy whole-month sticker sheet under the day page', async () => {
    localStorage.setItem('gomsin.diary.stickers.user-me.2026-08', JSON.stringify([
      { id: 'legacy', stickerId: 'heart', x: 0.5, y: 0.5, rotation: 0 },
    ]));
    const user = userEvent.setup();
    renderDiary();
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.getByText('8월 첫 기록')).toBeInTheDocument();
    expect(screen.queryByText('8월 둘째 기록')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: '붙일 스티커' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '기존 월 꾸미기' }));
    expect(screen.getByText('8월 첫 기록')).toBeInTheDocument();
    expect(screen.getByText('8월 둘째 기록')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: '붙일 스티커' })).toBeInTheDocument();
  });

  it('keeps unreadable records explicit instead of pretending they are empty', async () => {
    currentState = stateWith([record({ date: '2026-08-02', log: '', contentUnavailable: 'key_unavailable' })]);
    const user = userEvent.setup();
    renderDiary();
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.getByText('이 기기에서 아직 열 수 없어요')).toBeInTheDocument();
  });
});

describe('paper library entry', () => {
  it('uses paper wording rather than an unvalidated store/catalog promise', async () => {
    const user = userEvent.setup();
    renderDiary();
    expect(screen.queryByText(/다꾸 & 기억 상점|기억책/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '종이 보관함' }));
    expect(navigate).toHaveBeenCalledWith('/shop');
    navigate.mockClear();
    await user.click(screen.getByRole('button', { name: '종이 고르기' }));
    expect(navigate).toHaveBeenCalledWith('/shop');
  });

  it('keeps the free sticker set available only in the explicit legacy decorating mode', async () => {
    const user = userEvent.setup();
    renderDiary();
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    await user.click(screen.getByRole('button', { name: '기존 월 꾸미기' }));
    const row = screen.getByRole('radiogroup', { name: '붙일 스티커' });
    expect(within(row).getAllByRole('radio')).toHaveLength(12);
  });
});
