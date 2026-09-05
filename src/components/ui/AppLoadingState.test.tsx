import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppLoadingState } from '@/components/ui/AppLoadingState';

describe('AppLoadingState', () => {
  it('names the pending work and exposes a busy status without relying on motion', () => {
    render(
      <AppLoadingState
        label="곰신로그를 준비하고 있어요"
        description="계정과 기록을 확인하는 중이에요."
      />,
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('곰신로그를 준비하고 있어요')).toBeInTheDocument();
    expect(screen.getByText('계정과 기록을 확인하는 중이에요.')).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});
