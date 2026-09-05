import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ dataUrl: 'data:image/jpeg;base64,photo' as string | null,
  version: 'version' as string | null, ready: true, legacy: null as string | null }));
vi.mock('@/lib/useProfileAvatar', () => ({ useProfileAvatar: () => ({
  ...state, allowed: true, busy: false, save: vi.fn(),
}) }));
vi.mock('@/lib/avatarImage', () => ({ readAvatar: () => state.legacy, clearAvatar: vi.fn(), prepareAvatarFile: vi.fn(), writeAvatar: vi.fn() }));
import { AvatarPicker } from './AvatarPicker';
beforeEach(() => { state.dataUrl = 'data:image/jpeg;base64,photo'; state.version = 'version'; state.ready = true; state.legacy = null; });

it('keeps photo edit controls open when a pointer click focuses the avatar first', () => {
  render(<AvatarPicker userId="owner" slot="me" size={56} label="내 사진">기본 그림</AvatarPicker>);
  const picker = screen.getByRole('button', { name: '내 사진 바꾸기 또는 지우기' });
  fireEvent.focus(picker);
  fireEvent.click(picker);
  expect(screen.getByRole('button', { name: '내 사진 지우고 기본 그림으로' })).toBeVisible();
});

it('never resurrects a legacy local photo when a confirmed removal is followed by a read failure', () => {
  state.legacy = 'data:image/jpeg;base64,old-local-photo'; state.dataUrl = null;
  const view = render(<AvatarPicker userId="owner" slot="me" size={56} label="내 사진">기본 그림</AvatarPicker>);
  expect(view.container.querySelector('img')).toBeNull();
  state.version = null; state.ready = false; view.rerender(<AvatarPicker userId="owner" slot="me" size={56} label="내 사진">기본 그림</AvatarPicker>);
  expect(view.container.querySelector('img')).toBeNull();
});
