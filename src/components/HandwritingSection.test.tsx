import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HandwritingSection } from '@/components/HandwritingSection';

describe('보기 설정', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-paper');
  });

  it('무지 종이를 고르면 즉시 적용하고 계정별로 저장한다', async () => {
    render(<HandwritingSection userId="user-1" />);
    const plain = screen.getByRole('button', { name: '무지 종이' });
    expect(plain).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(plain);

    expect(plain).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement).toHaveAttribute('data-paper', 'plain');
    expect(localStorage.getItem('gomsin.display.paper.user-1')).toBe('plain');
  });

  it('줄 종이로 되돌릴 수 있다', async () => {
    localStorage.setItem('gomsin.display.paper.user-1', 'plain');
    document.documentElement.setAttribute('data-paper', 'plain');
    render(<HandwritingSection userId="user-1" />);

    await userEvent.click(screen.getByRole('button', { name: '줄 종이' }));

    expect(document.documentElement).not.toHaveAttribute('data-paper');
    expect(localStorage.getItem('gomsin.display.paper.user-1')).toBe('ruled');
  });

  it('계정이 바뀌면 새 계정의 보기 설정을 다시 읽는다', () => {
    localStorage.setItem('gomsin.display.paper.user-1', 'plain');
    const view = render(<HandwritingSection userId="user-1" />);
    expect(screen.getByRole('button', { name: '무지 종이' })).toHaveAttribute('aria-pressed', 'true');

    view.rerender(<HandwritingSection userId="user-2" />);

    expect(screen.getByRole('button', { name: '줄 종이' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '무지 종이' })).toHaveAttribute('aria-pressed', 'false');
  });
});
