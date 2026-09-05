import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/useProfileAvatar', () => ({ useProfileAvatar: () => ({
  dataUrl: 'data:image/jpeg;base64,photo', version: 'version', allowed: true, busy: false, save: vi.fn(),
}) }));
vi.mock('@/lib/avatarImage', () => ({ readAvatar: () => null, clearAvatar: vi.fn(), prepareAvatarFile: vi.fn(), writeAvatar: vi.fn() }));
import { AvatarPicker } from './AvatarPicker';

it('keeps photo edit controls open when a pointer click focuses the avatar first', () => {
  render(<AvatarPicker userId="owner" slot="me" size={56} label="내 사진">기본 그림</AvatarPicker>);
  const picker = screen.getByRole('button', { name: '내 사진 바꾸기 또는 지우기' });
  fireEvent.focus(picker);
  fireEvent.click(picker);
  expect(screen.getByRole('button', { name: '내 사진 지우고 기본 그림으로' })).toBeVisible();
});
