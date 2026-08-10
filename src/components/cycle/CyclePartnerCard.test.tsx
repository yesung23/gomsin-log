import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CyclePartnerCard } from '@/components/cycle/CyclePartnerCard';
import type { CyclePartnerProjection } from '@/types';

const fetchProjection = vi.fn();

vi.mock('@/lib/cycle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cycle')>('@/lib/cycle');
  return {
    ...actual,
    fetchPartnerCycleProjectionFromDB: (...args: unknown[]) => fetchProjection(...args),
  };
});

const NOTHING_SHARED: CyclePartnerProjection = {
  isCurrentPeriodShared: false,
  isPeriodActive: false,
  isPredictionShared: false,
  isFertilityShared: false,
};

function renderCard(props: Partial<Parameters<typeof CyclePartnerCard>[0]> = {}) {
  return render(
    <CyclePartnerCard
      authenticated
      userId="partner-1"
      connected
      {...props}
    />,
  );
}

beforeEach(() => {
  fetchProjection.mockReset();
});

describe('the partner sees only what the owner turned on', () => {
  it('renders nothing when every toggle is off', async () => {
    fetchProjection.mockResolvedValue({ ok: true, projection: NOTHING_SHARED });
    const { container } = renderCard();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows only the in-progress line when only that toggle is on', async () => {
    fetchProjection.mockResolvedValue({
      ok: true,
      projection: { ...NOTHING_SHARED, isCurrentPeriodShared: true, isPeriodActive: true },
    });
    renderCard();
    expect(await screen.findByText('지금 생리 기간이에요')).toBeInTheDocument();
    expect(screen.queryByText(/다음 생리 예상/)).not.toBeInTheDocument();
    expect(screen.queryByText(/가임 예상/)).not.toBeInTheDocument();
  });

  it('distinguishes in-progress from not in-progress', async () => {
    fetchProjection.mockResolvedValue({
      ok: true,
      projection: { ...NOTHING_SHARED, isCurrentPeriodShared: true, isPeriodActive: false },
    });
    renderCard();
    expect(await screen.findByText('지금은 생리 기간이 아니에요')).toBeInTheDocument();
  });

  it('shows the predicted range as a range, never a single certain date', async () => {
    fetchProjection.mockResolvedValue({
      ok: true,
      projection: {
        ...NOTHING_SHARED,
        isPredictionShared: true,
        predictedWindowStart: '2026-09-20',
        predictedWindowEnd: '2026-09-24',
      },
    });
    renderCard();
    expect(await screen.findByText('다음 생리 예상 9월 20일 ~ 9월 24일')).toBeInTheDocument();
    expect(screen.getByText(/정확한 날짜가 아닐 수 있어요/)).toBeInTheDocument();
  });

  it('never presents fertility as contraception or a pregnancy answer', async () => {
    fetchProjection.mockResolvedValue({
      ok: true,
      projection: {
        ...NOTHING_SHARED,
        isFertilityShared: true,
        fertilityWindowStart: '2026-09-01',
        fertilityWindowEnd: '2026-09-07',
      },
    });
    renderCard();
    expect(await screen.findByText('가임 예상 9월 1일 ~ 9월 7일')).toBeInTheDocument();
    expect(screen.getByText(/피임 수단으로 쓸 수 없고/)).toBeInTheDocument();
  });

  it('hides a shared prediction whose dates did not arrive', async () => {
    // A true flag with no dates would otherwise render a headline with a blank
    // range, which reads as a bug to the partner.
    fetchProjection.mockResolvedValue({
      ok: true,
      projection: { ...NOTHING_SHARED, isPredictionShared: true },
    });
    const { container } = renderCard();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(container.textContent).not.toContain('다음 생리 예상');
  });
});

describe('the card carries no raw health vocabulary', () => {
  it('renders none of the owner-only fields even when everything is shared', async () => {
    fetchProjection.mockResolvedValue({
      ok: true,
      projection: {
        isCurrentPeriodShared: true,
        isPeriodActive: true,
        isPredictionShared: true,
        predictedWindowStart: '2026-09-20',
        predictedWindowEnd: '2026-09-24',
        isFertilityShared: true,
        fertilityWindowStart: '2026-09-01',
        fertilityWindowEnd: '2026-09-07',
      },
    });
    const { container } = renderCard();
    await screen.findByText('지금 생리 기간이에요');
    const text = container.textContent || '';
    // Each of these is an owner-only field. The reassurance line names some of
    // them, so assert on the shape a real leak would take: a value, not a label.
    for (const leaked of ['두통', '복부 불편감', '피로', '더부룩함', '많음', '심함', '피곤', '예민']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('tells the partner the owner controls this, without medical framing', async () => {
    fetchProjection.mockResolvedValue({
      ok: true,
      projection: { ...NOTHING_SHARED, isCurrentPeriodShared: true, isPeriodActive: true },
    });
    const { container } = renderCard();
    await screen.findByText('지금 생리 기간이에요');
    expect(screen.getByText(/언제든 상대가 공유를 끌 수 있어요/)).toBeInTheDocument();
    for (const clinical of ['PMS', '증후군', '진단', '질환', '치료']) {
      expect(container.textContent || '').not.toContain(clinical);
    }
  });
});

describe('failures stay quiet rather than misinform', () => {
  it.each(['not_deployed', 'forbidden', 'error', 'unauthenticated'] as const)(
    'renders nothing on %s',
    async (reason) => {
      fetchProjection.mockResolvedValue({ ok: false, reason });
      const { container } = renderCard();
      await waitFor(() => expect(container).toBeEmptyDOMElement());
    },
  );

  it('never blames the partner\'s internet for a refused read', async () => {
    fetchProjection.mockResolvedValue({ ok: false, reason: 'forbidden' });
    const { container } = renderCard();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(container.textContent || '').not.toContain('연결');
  });

  it('renders nothing while disconnected, and never calls the server', async () => {
    const { container } = renderCard({ connected: false });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(fetchProjection).not.toHaveBeenCalled();
  });

  it('renders nothing while signed out, and never calls the server', async () => {
    const { container } = renderCard({ authenticated: false, userId: undefined });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(fetchProjection).not.toHaveBeenCalled();
  });

  it('drops a response that arrives after the account changed', async () => {
    let release: ((value: unknown) => void) | undefined;
    fetchProjection.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { container, rerender } = renderCard();

    // Sign out mid-flight, then let the previous partner's answer land.
    rerender(<CyclePartnerCard authenticated={false} userId={undefined} connected={false} />);
    release?.({
      ok: true,
      projection: { ...NOTHING_SHARED, isCurrentPeriodShared: true, isPeriodActive: true },
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(container.textContent || '').not.toContain('생리');
  });
});
