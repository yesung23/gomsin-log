import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppBar } from '@/components/ui/AppBar';

describe('AppBar 종이 표면', () => {
  it('sticky 표면에서 선택한 종이 레이어를 이어 쓰고 호출자의 스타일을 보존한다', () => {
    render(<AppBar title="기록" data-testid="app-bar" style={{ paddingTop: '20px' }} />);

    const appBar = screen.getByTestId('app-bar');
    expect(appBar).toHaveClass('paper-texture-layer');
    expect(appBar).not.toHaveStyle({ background: 'var(--paper)' });
    expect(appBar).toHaveStyle({ paddingTop: '20px' });
  });
});
