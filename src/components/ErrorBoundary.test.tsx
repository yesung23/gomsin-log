import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';

vi.mock('@/lib/sentry', () => ({ reportBoundaryError: vi.fn() }));

function BrokenSurface(): never {
  throw new Error('render failed');
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('오류 전에는 자식 화면을 그대로 렌더한다', () => {
    render(<ErrorBoundary><p>정상 화면</p></ErrorBoundary>);
    expect(screen.getByText('정상 화면')).toBeInTheDocument();
  });

  it('종이 위에서 오류와 복구를 알리고 44px 새로고침 행동을 남긴다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ErrorBoundary><BrokenSurface /></ErrorBoundary>);

    const alert = screen.getByRole('alert');
    const heading = screen.getByRole('heading', { name: '문제가 발생했어요' });
    const reload = screen.getByRole('button', { name: '새로고침' });

    expect(alert).toHaveClass(
      'paper-texture-layer',
      'pt-[env(safe-area-inset-top,0px)]',
      'pb-[env(safe-area-inset-bottom,0px)]',
    );
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(heading.closest('.ink-box')).toBeInTheDocument();
    expect(alert).toHaveTextContent('앱을 다시 시작합니다');
    expect(reload).toHaveClass('press-response', 'ink-fill', 'min-h-11');
    expect(reload.querySelector('svg')).toHaveClass('pen-icon');
    expect(reload.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
