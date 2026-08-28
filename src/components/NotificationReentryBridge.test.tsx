import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotificationReentryBridge } from '@/components/NotificationReentryBridge';
import {
  clearNotificationDedupeForTests,
  emitNotification,
} from '@/lib/notifications';

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      authenticatedUser: { id: 'viewer-1' },
      profile: { id: 'viewer-1' },
    },
  }),
}));

describe('앱 안 알림 위치', () => {
  beforeEach(() => {
    clearNotificationDedupeForTests();
    localStorage.clear();
  });

  afterEach(() => {
    clearNotificationDedupeForTests();
  });

  it('상태바와 고정 헤더 아래에서 표시한다', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <NotificationReentryBridge />
      </MemoryRouter>,
    );

    await act(async () => {
      await emitNotification({
        userId: 'viewer-1',
        eventType: 'new_shared_record',
        eventId: '11111111-1111-4111-8111-111111111111',
        recordId: '22222222-2222-4222-8222-222222222222',
      });
    });

    expect(screen.getByLabelText('새 알림')).toHaveClass(
      'top-[calc(env(safe-area-inset-top,0px)+4rem)]',
      'z-[60]',
    );
  });
});
