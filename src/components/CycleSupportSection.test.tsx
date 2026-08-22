import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CycleSupportSignalsFetchResult } from '@/lib/cycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const loads: Array<ReturnType<typeof deferred<CycleSupportSignalsFetchResult>>> = [];

vi.mock('@/lib/supabase', () => ({ supabase: null }));
vi.mock('@/lib/cycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cycle')>();
  return {
    ...actual,
    fetchCycleSupportSignalsResultFromDB: () => {
      const request = deferred<CycleSupportSignalsFetchResult>();
      loads.push(request);
      return request.promise;
    },
    createCycleSupportSignalInDB: (...args: unknown[]) => createSignal(...args),
    revokeCycleSupportSignalFromDB: (...args: unknown[]) => revokeSignal(...args),
  };
});

const createSignal = vi.fn();
const revokeSignal = vi.fn();

const { CycleSupportSection } = await import('@/components/CycleSupportSection');

function signal(overrides: Partial<{
  id: string;
  coupleId: string;
  ownerId: string;
  message: string;
  expiresAt: string;
}> = {}) {
  return {
    id: overrides.id || 'signal-1',
    coupleId: overrides.coupleId || 'couple-a',
    ownerId: overrides.ownerId || 'partner-a',
    kind: 'would_like_support' as const,
    message: overrides.message || 'A private message',
    sharedForDate: '2026-08-01',
    expiresAt: overrides.expiresAt || '2026-08-01T01:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('CycleSupportSection identity and expiry isolation', () => {
  beforeEach(() => {
    loads.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores a previous account response after the active identity changes', async () => {
    const view = render(
      <CycleSupportSection mine={false} authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));

    view.rerender(
      <CycleSupportSection mine={false} authenticated userId="user-b" coupleId="couple-b" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(2));

    await act(async () => {
      loads[1].resolve({
        ok: true,
        signals: [signal({ id: 'signal-b', coupleId: 'couple-b', ownerId: 'partner-b', message: 'B message' })],
      });
    });
    expect(await screen.findByText('B message')).toBeInTheDocument();

    await act(async () => {
      loads[0].resolve({ ok: true, signals: [signal()] });
    });
    expect(screen.queryByText('A private message')).not.toBeInTheDocument();
    expect(screen.getByText('B message')).toBeInTheDocument();
  });

  it('removes a displayed signal when its local expiry boundary passes', async () => {
    render(
      <CycleSupportSection mine={false} authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));

    await act(async () => {
      loads[0].resolve({
        ok: true,
        signals: [signal({ message: 'Short-lived', expiresAt: '2026-08-01T00:00:01.000Z' })],
      });
    });
    expect(await screen.findByText('Short-lived')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(screen.queryByText('Short-lived')).not.toBeInTheDocument();
    expect(screen.getByText('오늘 공유된 응원 신호가 없어요.')).toBeInTheDocument();
  });
});

describe('CycleSupportSection write integrity', () => {
  beforeEach(() => {
    loads.length = 0;
    createSignal.mockReset();
    revokeSignal.mockReset();
    // `sharedForDate` is compared against the real Korea date, so the clock must
    // be pinned to the date the fixtures use.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Render as the owner (gomsin) with an empty, loaded signal list. */
  async function renderOwnerWithShareForm() {
    const view = render(
      <CycleSupportSection mine authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));
    await act(async () => {
      loads[0].resolve({ ok: true, signals: [] });
    });
    expect(await screen.findByText('오늘만 공유하기')).toBeInTheDocument();
    return view;
  }

  it('reports a rejected share as a permission problem, never a connection problem', async () => {
    // A `forbidden` result means the couple link is not usable for this write.
    // The old copy said "연결을 확인해 주세요", which sent the user to retry a
    // request that could never succeed.
    createSignal.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderOwnerWithShareForm();

    fireEvent.click(screen.getByTestId('support-kind-would_like_support'));
    fireEvent.click(screen.getByText('오늘만 공유하기'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // The failed write must not appear locally successful.
    expect(screen.queryByText('오늘 공유된 신호')).not.toBeInTheDocument();
    expect(screen.getByText('오늘만 공유하기')).toBeInTheDocument();
  });

  it('reports an expired session as a session problem', async () => {
    createSignal.mockResolvedValue({ ok: false, reason: 'auth_expired' });
    await renderOwnerWithShareForm();

    fireEvent.click(screen.getByTestId('support-kind-resting'));
    fireEvent.click(screen.getByText('오늘만 공유하기'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('세션이 만료되었어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    expect(screen.queryByText('오늘 공유된 신호')).not.toBeInTheDocument();
  });

  it('keeps the shared signal visible when revoking it fails', async () => {
    revokeSignal.mockResolvedValue({ ok: false, reason: 'forbidden' });
    render(
      <CycleSupportSection mine authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));
    await act(async () => {
      loads[0].resolve({
        ok: true,
        signals: [signal({ ownerId: 'user-a', expiresAt: '2999-01-01T00:00:00.000Z' })],
      });
    });
    expect(await screen.findByText('공유 취소')).toBeInTheDocument();

    fireEvent.click(screen.getByText('공유 취소'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // Local state unchanged: the signal is still shared as far as the server knows.
    expect(screen.getByText('오늘 공유된 신호')).toBeInTheDocument();
  });

  it('adds the signal locally only after the server confirms it', async () => {
    createSignal.mockResolvedValue({
      ok: true,
      signal: signal({ ownerId: 'user-a', expiresAt: '2999-01-01T00:00:00.000Z' }),
    });
    await renderOwnerWithShareForm();

    fireEvent.click(screen.getByTestId('support-kind-would_like_support'));
    fireEvent.click(screen.getByText('오늘만 공유하기'));

    expect(await screen.findByText('오늘 공유된 신호')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('the care signal is chosen, never assumed', () => {
    it('starts with nothing selected, so the app never guesses how today feels', async () => {
      await renderOwnerWithShareForm();
      for (const kind of ['resting', 'need_space', 'would_like_support', 'check_in_later', 'feeling_unwell']) {
        expect(screen.getByTestId(`support-kind-${kind}`).getAttribute('aria-pressed')).toBe('false');
      }
    });

    it('shows all five options at once rather than behind a picker', async () => {
      await renderOwnerWithShareForm();
      expect(screen.getByTestId('support-kind-options').querySelectorAll('button')).toHaveLength(5);
    });

    it('marks exactly one as chosen, and lets the choice be taken back', async () => {
      await renderOwnerWithShareForm();

      fireEvent.click(screen.getByTestId('support-kind-resting'));
      expect(screen.getByTestId('support-kind-resting').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('support-kind-need_space').getAttribute('aria-pressed')).toBe('false');

      // Choosing another moves the selection rather than adding to it.
      fireEvent.click(screen.getByTestId('support-kind-need_space'));
      expect(screen.getByTestId('support-kind-resting').getAttribute('aria-pressed')).toBe('false');
      expect(screen.getByTestId('support-kind-need_space').getAttribute('aria-pressed')).toBe('true');

      // Pressing the chosen one again clears it -- deciding not to send is a decision.
      fireEvent.click(screen.getByTestId('support-kind-need_space'));
      expect(screen.getByTestId('support-kind-need_space').getAttribute('aria-pressed')).toBe('false');
    });

    it('refuses to send until something has actually been chosen', async () => {
      await renderOwnerWithShareForm();
      fireEvent.click(screen.getByText('오늘만 공유하기'));
      expect(createSignal).not.toHaveBeenCalled();
    });
  });


  /**
   * 컨디션은 역할의 일이 아니라 몸의 일이다.
   *
   * 이 컴포넌트는 `role === 'gomsin'` 으로 보내는 쪽과 읽는 쪽을 갈랐다. 그 결과 군화는
   * 자기 몸이 힘든 날에도 그 사실을 보낼 방법이 없었고, 군 복무가 아닌 커플에서는 더
   * 분명하게 틀렸다 -- 그 커플에도 `soldier` 역할을 가진 사람이 있고 그 사람은 영원히
   * 읽기만 하게 된다.
   *
   * 서버는 이것을 역할로 막고 있지 않았다. `cycle_support_signals` 의 RLS 는
   * `owner_id = auth.uid()` 와 커플 소속만 본다(migration 014). 제약은 클라이언트 한
   * 줄이었고, 마이그레이션 없이 풀렸다.
   *
   * 이 블록이 지키는 것은 그 사실 하나다: **보내는 자리인지 읽는 자리인지는 부르는 쪽이
   * 정하고, 역할은 그 판단에 들어오지 않는다.**
   */
  describe('보내는 쪽은 역할이 정하지 않는다', () => {
    it('역할이라는 개념 자체가 이 컴포넌트에 없다', () => {
      /*
        값이 아니라 소스를 본다. `mine` 을 받으면서 안에서 다시 역할을 읽어 덮어쓰면 위의
        렌더 단언들은 전부 통과하면서 결함만 되살아난다 -- 실제로 되돌리기 가장 쉬운 방법이
        그것이다.
      */
      const source = readFileSync(
        resolve(process.cwd(), 'src/components/CycleSupportSection.tsx'),
        'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source).not.toMatch(/'gomsin'/);
      expect(source).not.toMatch(/'soldier'/);
    });

    it('mine 이면 보내는 자리다', async () => {
      render(
        <CycleSupportSection mine authenticated userId="user-a" coupleId="couple-a" connected />,
      );
      await waitFor(() => expect(loads).toHaveLength(1));
      await act(async () => { loads[0].resolve({ ok: true, signals: [] }); });
      expect(await screen.findByText('오늘만 공유하기')).toBeInTheDocument();
    });

    it('mine 이 아니면 읽는 자리다 -- 같은 사용자, 같은 커플, 같은 역할이어도', async () => {
      render(
        <CycleSupportSection mine={false} authenticated userId="user-a" coupleId="couple-a" connected />,
      );
      await waitFor(() => expect(loads).toHaveLength(1));
      await act(async () => { loads[0].resolve({ ok: true, signals: [] }); });
      expect(screen.queryByText('오늘만 공유하기')).not.toBeInTheDocument();
    });
  });
});

