import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HandwritingSection } from '@/components/HandwritingSection';

describe('보기 설정', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-paper');
    document.documentElement.removeAttribute('data-record-text-size');
  });

  it('does not expose a contradictory two-choice paper owner after Shop/Profile adds more papers', () => {
    localStorage.setItem('gomsin.display.paper.user-1', 'grid');
    render(<HandwritingSection userId="user-1" />);

    expect(screen.queryByRole('button', { name: '무지 종이' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '줄 종이' })).not.toBeInTheDocument();
  });

  it('게시물·스토리 글자 크기를 즉시 적용하고 계정별로 저장한다', async () => {
    const { rerender } = render(<HandwritingSection userId="user-1" />);

    await userEvent.click(screen.getByRole('button', { name: '크게' }));

    expect(document.documentElement).toHaveAttribute('data-record-text-size', 'large');
    expect(localStorage.getItem('gomsin.display.recordTextSize.user-1')).toBe('large');
    expect(screen.getByRole('button', { name: '크게' })).toHaveAttribute('aria-pressed', 'true');

    rerender(<HandwritingSection userId="user-2" />);
    expect(screen.getByRole('button', { name: '기본' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '크게' })).toHaveAttribute('aria-pressed', 'false');
  });
});
