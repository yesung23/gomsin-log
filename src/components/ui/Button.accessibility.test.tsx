import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/Button';

describe('Button touch target contract', () => {
  it('keeps the compact size as a physical 44px control without a hidden pseudo target', () => {
    render(<Button size="sm">추가</Button>);

    const button = screen.getByRole('button', { name: '추가' });
    expect(button).toHaveClass('min-h-11');
    expect(button.className).not.toContain('before:');
  });
});
