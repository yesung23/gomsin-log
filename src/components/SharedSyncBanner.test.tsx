import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

/**
 * DEF-13 and DEF-15, both about the same banner.
 *
 * DEF-13: the retry is the ONLY affordance for a frozen shared workspace, and it
 * produced no route change, no dialog and no content change when the re-check
 * changed nothing -- indistinguishable from a dead button.
 *
 * DEF-15: on a cold load with no realtime socket, the first paint told a
 * perfectly connected user their shared information "could not be confirmed" and
 * had been hidden, then recovered ~2.1s later. Fail-closed-then-recover is the
 * right design; a permanent-sounding verdict for a transient state is not.
 */

const toastCalls: { level: string; message: string }[] = [];
vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => { toastCalls.push({ level: 'success', message }); },
    error: (message: string) => { toastCalls.push({ level: 'error', message }); },
    info: (message: string) => { toastCalls.push({ level: 'info', message }); },
  },
}));

const retrySharedAccess = vi.fn();
let sharedSyncStatus = 'unavailable';

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      isDemoMode: false,
      profile: { couple: { connected: true, status: 'active' } },
    },
    sharedSyncStatus,
    retrySharedAccess,
  }),
}));

const { SharedSyncBanner } = await import('@/components/SharedSyncBanner');

describe('SharedSyncBanner', () => {
  beforeEach(() => {
    toastCalls.length = 0;
    retrySharedAccess.mockReset().mockResolvedValue(true);
    sharedSyncStatus = 'unavailable';
  });

  // DEF-15
  it('describes the hidden shared workspace as not-yet-confirmed, not as unconfirmable', () => {
    render(<SharedSyncBanner />);
    const text = screen.getByRole('status').textContent ?? '';

    expect(text).toContain('아직 확인하지 못해');
    expect(text).toContain('확인되면 다시 보여드려요');
    // The old wording read as a settled verdict about a 2-second window.
    expect(text).not.toContain('확인할 수 없어');
    // And it must not blame the network, which is not what this state means.
    expect(text).not.toContain('인터넷 연결');
  });

  it('keeps the delayed state distinct from the hidden state', () => {
    sharedSyncStatus = 'delayed';
    render(<SharedSyncBanner />);
    expect(screen.getByRole('status').textContent)
      .toContain('실시간 연결이 끊겨 최신 정보가 아닐 수 있어요.');
  });

  it('renders nothing at all once the workspace is live', () => {
    sharedSyncStatus = 'live';
    render(<SharedSyncBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // DEF-13
  it('says so when the re-check confirmed the workspace', async () => {
    render(<SharedSyncBanner />);

    await act(async () => {
      screen.getByLabelText('공유 정보 다시 확인').click();
    });

    expect(retrySharedAccess).toHaveBeenCalledTimes(1);
    expect(toastCalls).toEqual([
      { level: 'success', message: '공유 정보를 다시 확인했어요.' },
    ]);
  });

  it('says so when the re-check changed nothing, instead of staying silent', async () => {
    // `retrySharedAccess` returns false both when membership could not be
    // confirmed and when there was nothing mounted to re-check. Either way the
    // shared information is still unconfirmed, which is what the user is told.
    retrySharedAccess.mockResolvedValue(false);
    render(<SharedSyncBanner />);

    await act(async () => {
      screen.getByLabelText('공유 정보 다시 확인').click();
    });

    expect(toastCalls).toEqual([
      { level: 'error', message: '아직 공유 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' },
    ]);
  });

  it('does not fire a second re-check while one is in flight', async () => {
    let release!: (value: boolean) => void;
    retrySharedAccess.mockImplementation(() => new Promise<boolean>((resolve) => {
      release = resolve;
    }));
    render(<SharedSyncBanner />);
    const button = screen.getByLabelText('공유 정보 다시 확인');

    await act(async () => { button.click(); });
    await act(async () => { button.click(); });
    await act(async () => { release(true); });

    expect(retrySharedAccess).toHaveBeenCalledTimes(1);
  });
});
