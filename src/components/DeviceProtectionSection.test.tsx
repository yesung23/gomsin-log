import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceProtectionSection } from './DeviceProtectionSection';

describe('DeviceProtectionSection couple pairing entry', () => {
  it('offers the two-account ceremony only when couple pairing is required', async () => {
    const onPair = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DeviceProtectionSection status="PAIRING_REQUIRED" onPair={onPair} />,
    );

    const button = screen.getByRole('button', { name: /둘의 기록 보호 연결/ });
    expect(button.className).toContain('min-h-11');
    await user.click(button);
    expect(onPair).toHaveBeenCalledTimes(1);

    rerender(<DeviceProtectionSection status="PROTECTED" onPair={onPair} />);
    expect(screen.queryByRole('button', { name: /둘의 기록 보호 연결/ })).toBeNull();
  });

  it('disables the pairing action while protection work is in flight', () => {
    render(<DeviceProtectionSection status="PAIRING_REQUIRED" onPair={vi.fn()} busy />);
    expect(screen.getByRole('button', { name: /확인 중/ })).toBeDisabled();
  });
});
