import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NotebookFeed } from '@/features/home/NotebookFeed';
import type { HomeReadingMode } from '@/features/home/useHomeReadingMode';
import type { DailyRecord } from '@/types';

function record(id: string): DailyRecord {
  return {
    id,
    userId: 'partner',
    date: '2026-09-06',
    time: '10:00',
    authorRole: 'gomsin',
    log: `기록 ${id}`,
    isPrivate: false,
  } as DailyRecord;
}

const renderRecord = (item: DailyRecord) => (
  <article>
    <div data-record-media-region>사진 {item.id}</div>
    <p>{item.log}</p>
    <button type="button">행동 {item.id}</button>
  </article>
);

function firePointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointerup',
  init: { pointerId: number; clientX: number; clientY: number; isPrimary?: boolean; button?: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    isPrimary: { value: init.isPrimary ?? true },
  });
  fireEvent(target, event);
}

function ControlledFeed({
  records,
  identityKey = 'me:couple:partner',
  initialMode = 'horizontal',
}: {
  records: DailyRecord[];
  identityKey?: string;
  initialMode?: HomeReadingMode;
}) {
  const [mode, setMode] = useState<HomeReadingMode>(initialMode);
  return (
    <NotebookFeed
      records={records}
      identityKey={identityKey}
      mode={mode}
      onModeChange={setMode}
      renderRecord={renderRecord}
    />
  );
}

describe('NotebookFeed', () => {
  it('uses only the dynamic action name for the reading-mode control', () => {
    render(<ControlledFeed records={[record('a')]} />);

    const verticalAction = screen.getByRole('button', { name: '세로로 읽기' });
    expect(verticalAction).not.toHaveAttribute('aria-pressed');
    expect(verticalAction).toHaveAttribute('data-reading-mode', 'horizontal');
    fireEvent.click(verticalAction);
    const horizontalAction = screen.getByRole('button', { name: '가로로 읽기' });
    expect(horizontalAction).not.toHaveAttribute('aria-pressed');
    expect(horizontalAction).toHaveAttribute('data-reading-mode', 'vertical');
  });

  it('shows one horizontal page, with visible 44px controls and keyboard navigation', () => {
    render(<ControlledFeed records={[record('a'), record('b')]} />);

    expect(screen.getByText('기록 a')).toBeInTheDocument();
    expect(screen.queryByText('기록 b')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전 기록' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음 기록' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '다음 기록' })).toHaveClass('notebook-feed__page-button');

    fireEvent.keyDown(screen.getByTestId('record-swipe-region'), { key: 'ArrowRight' });
    expect(screen.getByText('기록 b')).toBeInTheDocument();
    expect(screen.queryByText('기록 a')).not.toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('keeps the stable active id across reorder and mode changes', () => {
    const first = [record('a'), record('b'), record('c')];
    const view = render(<ControlledFeed records={first} />);
    fireEvent.click(screen.getByRole('button', { name: '다음 기록' }));
    expect(screen.getByText('기록 b')).toBeInTheDocument();

    view.rerender(<ControlledFeed records={[record('c'), record('b'), record('a')]} />);
    expect(screen.getByText('기록 b')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '세로로 읽기' }));
    expect(screen.getAllByRole('article').map((article) => article.textContent)).toEqual([
      '사진 c기록 c행동 c',
      '사진 b기록 b행동 b',
      '사진 a기록 a행동 a',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '가로로 읽기' }));
    expect(screen.getByText('기록 b')).toBeInTheDocument();
  });

  it('uses current visible pixels when a tall and short record compete, then returns to horizontal', () => {
    render(
      <main data-testid="scroll-root">
        <ControlledFeed
          records={[record('short-b'), record('tall-a')]}
          initialMode="vertical"
        />
      </main>,
    );
    const root = screen.getByTestId('scroll-root');
    const shortRecord = screen.getByTestId('notebook-record-short-b');
    const tallRecord = screen.getByTestId('notebook-record-tall-a');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 500,
      width: 300, height: 500, toJSON: () => ({}),
    });
    let shortTop = 0;
    let tallTop = 100;
    vi.spyOn(shortRecord, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: shortTop, left: 0, top: shortTop, right: 300, bottom: shortTop + 100,
      width: 300, height: 100, toJSON: () => ({}),
    }));
    vi.spyOn(tallRecord, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: tallTop, left: 0, top: tallTop, right: 300, bottom: tallTop + 600,
      width: 300, height: 600, toJSON: () => ({}),
    }));

    fireEvent.scroll(root);
    expect(tallRecord).toHaveAttribute('data-active-record', 'true');

    shortTop = 0;
    tallTop = 480;
    fireEvent.scroll(root);
    expect(shortRecord).toHaveAttribute('data-active-record', 'true');

    fireEvent.click(screen.getByRole('button', { name: '가로로 읽기' }));
    expect(screen.getByText('기록 short-b')).toBeInTheDocument();
    expect(screen.queryByText('기록 tall-a')).not.toBeInTheDocument();
  });

  it('resets the active record immediately when viewer/partner identity changes', () => {
    const view = render(
      <ControlledFeed records={[record('old-first'), record('shared-id')]} identityKey="old" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '다음 기록' }));
    expect(screen.getByText('기록 shared-id')).toBeInTheDocument();

    view.rerender(
      <ControlledFeed records={[record('new-first'), record('shared-id')]} identityKey="new" />,
    );
    expect(screen.getByText('기록 new-first')).toBeInTheDocument();
    expect(screen.queryByText('기록 shared-id')).not.toBeInTheDocument();
  });

  it('pages only from deliberate non-media, non-edge horizontal swipes', () => {
    render(<ControlledFeed records={[record('a'), record('b')]} />);
    const swipeRegion = screen.getByTestId('record-swipe-region');
    vi.spyOn(swipeRegion, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 500,
      width: 300, height: 500, toJSON: () => ({}),
    });

    firePointer(screen.getByText('사진 a'), 'pointerdown', {
      pointerId: 1, isPrimary: true, clientX: 180, clientY: 100,
    });
    firePointer(screen.getByText('사진 a'), 'pointerup', {
      pointerId: 1, isPrimary: true, clientX: 80, clientY: 100,
    });
    expect(screen.getByText('기록 a')).toBeInTheDocument();

    firePointer(swipeRegion, 'pointerdown', {
      pointerId: 2, isPrimary: true, clientX: 10, clientY: 100,
    });
    firePointer(swipeRegion, 'pointerup', {
      pointerId: 2, isPrimary: true, clientX: 100, clientY: 100,
    });
    expect(screen.getByText('기록 a')).toBeInTheDocument();

    firePointer(swipeRegion, 'pointerdown', {
      pointerId: 3, isPrimary: true, clientX: 180, clientY: 100,
    });
    firePointer(swipeRegion, 'pointerup', {
      pointerId: 3, isPrimary: true, clientX: 105, clientY: 190,
    });
    expect(screen.getByText('기록 a')).toBeInTheDocument();

    firePointer(swipeRegion, 'pointerdown', {
      pointerId: 4, isPrimary: true, clientX: 180, clientY: 100,
    });
    firePointer(swipeRegion, 'pointerup', {
      pointerId: 4, isPrimary: true, clientX: 100, clientY: 105,
    });
    expect(screen.getByText('기록 b')).toBeInTheDocument();
  });

  it('does not page from interactive content or while text is selected', () => {
    render(<ControlledFeed records={[record('a'), record('b')]} />);
    const swipeRegion = screen.getByTestId('record-swipe-region');
    vi.spyOn(swipeRegion, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 500,
      width: 300, height: 500, toJSON: () => ({}),
    });

    const action = screen.getByRole('button', { name: '행동 a' });
    firePointer(action, 'pointerdown', {
      pointerId: 10, isPrimary: true, clientX: 180, clientY: 100,
    });
    firePointer(action, 'pointerup', {
      pointerId: 10, isPrimary: true, clientX: 80, clientY: 100,
    });
    expect(screen.getByText('기록 a')).toBeInTheDocument();

    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
    } as Selection);
    firePointer(swipeRegion, 'pointerdown', {
      pointerId: 11, isPrimary: true, clientX: 180, clientY: 100,
    });
    firePointer(swipeRegion, 'pointerup', {
      pointerId: 11, isPrimary: true, clientX: 80, clientY: 100,
    });
    expect(screen.getByText('기록 a')).toBeInTheDocument();
    selection.mockRestore();
  });

  it('clears a pointer released outside the record region before the next swipe', () => {
    render(<ControlledFeed records={[record('a'), record('b')]} />);
    const swipeRegion = screen.getByTestId('record-swipe-region');
    vi.spyOn(swipeRegion, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 500,
      width: 300, height: 500, toJSON: () => ({}),
    });

    firePointer(swipeRegion, 'pointerdown', {
      pointerId: 20, isPrimary: true, clientX: 180, clientY: 100,
    });
    firePointer(window, 'pointerup', {
      pointerId: 20, isPrimary: true, clientX: 40, clientY: 100,
    });

    firePointer(swipeRegion, 'pointerdown', {
      pointerId: 21, isPrimary: true, clientX: 180, clientY: 100,
    });
    firePointer(swipeRegion, 'pointerup', {
      pointerId: 21, isPrimary: true, clientX: 100, clientY: 100,
    });
    expect(screen.getByText('기록 b')).toBeInTheDocument();
  });

  it('does not page from a right-click drag', () => {
    render(<ControlledFeed records={[record('a'), record('b')]} />);
    const swipeRegion = screen.getByTestId('record-swipe-region');
    vi.spyOn(swipeRegion, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 500,
      width: 300, height: 500, toJSON: () => ({}),
    });

    firePointer(swipeRegion, 'pointerdown', {
      pointerId: 30, button: 2, clientX: 180, clientY: 100,
    });
    firePointer(swipeRegion, 'pointerup', {
      pointerId: 30, button: 2, clientX: 80, clientY: 100,
    });
    expect(screen.getByText('기록 a')).toBeInTheDocument();
  });

  it('remounts record-local state instead of carrying gallery state to the next record', () => {
    function StatefulRecord({ item }: { item: DailyRecord }) {
      const [mountedFor] = useState(item.id);
      return <span data-testid="mounted-for">{mountedFor}</span>;
    }
    render(
      <NotebookFeed
        records={[record('a'), record('b')]}
        identityKey="identity"
        mode="horizontal"
        onModeChange={vi.fn()}
        renderRecord={(item) => <StatefulRecord item={item} />}
      />,
    );
    expect(screen.getByTestId('mounted-for')).toHaveTextContent('a');

    fireEvent.click(screen.getByRole('button', { name: '다음 기록' }));
    expect(screen.getByTestId('mounted-for')).toHaveTextContent('b');
  });
});
