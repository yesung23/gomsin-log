import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HighlightEditActions } from '@/components/HighlightEditActions';
import type { Highlight } from '@/lib/coupleHighlights';

const reached: Highlight = {
  label: '첫 면회',
  date: '2026-01-10',
  reached: true,
  sourceKind: 'event',
  sourceEventId: 'event-42',
};

describe('HighlightEditActions', () => {
  it('onEdit가 없으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<HighlightEditActions highlight={reached} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('원본 메타데이터를 그대로 콜백에 전달하고 일정 경로 intent를 보존한다', async () => {
    const onEdit = vi.fn();
    render(<HighlightEditActions highlight={reached} onEdit={onEdit} />);

    const action = screen.getByRole('button', { name: '첫 면회 일정 원본 편집' });
    expect(action).toHaveAttribute('data-edit-route', '/schedule');

    await userEvent.click(action);
    expect(onEdit).toHaveBeenCalledWith(reached);
    // Settings/Schedule/Service는 query로 편집을 자동으로 열지 않으므로,
    // 여기서는 fake edit success가 아니라 부모 콜백과 source metadata만 검증한다.
  });

  it.each([
    ['anniversary', '/settings'],
    ['event', '/schedule'],
    ['discharge', '/service'],
  ] as const)('sourceKind %s는 %s intent를 사용한다', (sourceKind, route) => {
    render(
      <HighlightEditActions
        highlight={{ ...reached, label: sourceKind, sourceKind, sourceEventId: undefined }}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('highlight-edit-action')).toHaveAttribute('data-edit-route', route);
  });

  it('미래 하이라이트는 편집 action도 disabled다', async () => {
    const onEdit = vi.fn();
    const future: Highlight = {
      label: '전역',
      date: '2026-12-01',
      reached: false,
      countdown: 'D-101',
      sourceKind: 'discharge',
    };

    render(<HighlightEditActions highlight={future} onEdit={onEdit} />);
    const action = screen.getByRole('button', { name: '전역 복무 정보 원본 편집' });
    expect(action).toBeDisabled();
    await userEvent.click(action);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
