import { describe, expect, it } from 'vitest';
import { authSyncFailureCopy } from '@/lib/authSyncFailureCopy';
import type { AuthSyncStage } from '@/lib/sync';

describe('authSyncFailureCopy', () => {
  it('names a record hydration failure without mislabelling it as an account failure', () => {
    expect(authSyncFailureCopy('server', 'records')).toEqual({
      title: '기록을 불러오지 못했어요',
      description: '서비스가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요. 확인이 끝날 때까지 둘의 기록은 표시하지 않아요.',
      actionLabel: '다시 시도',
    });
  });

  it('keeps the connection diagnosis exclusive to a confirmed offline reason', () => {
    const copy = authSyncFailureCopy('offline', 'events');

    expect(copy.title).toBe('일정을 불러오지 못했어요');
    expect(copy.description).toContain('인터넷 연결을 확인한 뒤');
    expect(authSyncFailureCopy('unreachable', 'events').description).not.toContain('인터넷 연결');
  });

  it('lets session expiry override the failed data stage', () => {
    expect(authSyncFailureCopy('auth_expired', 'records')).toMatchObject({
      title: '세션이 만료되었어요',
      actionLabel: '다시 로그인',
    });
  });

  it('provides specific, non-empty copy for every hydration stage', () => {
    const stages: AuthSyncStage[] = [
      'profile', 'membership', 'couple', 'partner', 'contact', 'records',
      'events', 'trips', 'talk-about', 'unexpected', 'timeout',
    ];

    for (const stage of stages) {
      const copy = authSyncFailureCopy('unknown', stage);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });
});
