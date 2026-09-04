import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types';
import type {
  OnDeviceSummaryFailure,
  OnDeviceSummaryItem,
} from '@/lib/dailySummary/contract';
import {
  useOnDeviceDailySummary,
  type UseOnDeviceDailySummaryInput,
} from '@/lib/dailySummary/useOnDeviceDailySummary';

const native = vi.hoisted(() => ({
  cancel: vi.fn(),
  gate: vi.fn(() => 'ready' as const),
  preflight: vi.fn(async () => ({ ok: true as const })),
  refine: vi.fn(),
}));

vi.mock('@/lib/dailySummary/nativeOnDeviceSummary', () => ({
  cancelOnDeviceSummary: native.cancel,
  onDeviceSummaryGate: native.gate,
  ON_DEVICE_SUMMARY_TIMEOUT_MS: 4000,
  preflightOnDeviceSummary: native.preflight,
  refineOnDeviceSummary: native.refine,
}));

type RefineOutcome =
  | { ok: true; items: unknown }
  | { ok: false; reason: OnDeviceSummaryFailure };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function records(count: number): DailyRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = String(index).padStart(2, '0');
    const hour = String(8 + Math.floor(index / 2)).padStart(2, '0');
    const minute = index % 2 === 0 ? '00' : '30';
    return {
      id: `record-${ordinal}`,
      userId: 'partner',
      date: '2026-09-04',
      time: `${hour}:${minute}`,
      authorRole: 'gomsin',
      log: `record-${ordinal} summary-${ordinal} ${'detail '.repeat(8)}`,
      isPrivate: false,
      createdAt: `2026-09-04T${hour}:${minute}:00.000Z`,
    } as DailyRecord;
  });
}

function input(
  sourceRecords: readonly DailyRecord[],
  overrides: Partial<UseOnDeviceDailySummaryInput> = {},
): UseOnDeviceDailySummaryInput {
  return {
    enabled: true,
    mode: 'today',
    records: sourceRecords,
    viewerUserId: 'viewer',
    partnerUserId: 'partner',
    todayStr: '2026-09-04',
    coupleConnected: true,
    coupleStatus: 'active',
    requestVersion: 0,
    ...overrides,
  };
}

function successful(items: readonly OnDeviceSummaryItem[]): RefineOutcome {
  return {
    ok: true,
    items: items.map((item) => ({
      index: item.index,
      text: item.text.slice(0, item.text.indexOf(' detail')),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.gate.mockReturnValue('ready');
  native.preflight.mockResolvedValue({ ok: true });
  native.refine.mockImplementation(async (items: readonly OnDeviceSummaryItem[]) => successful(items));
});

describe('useOnDeviceDailySummary sequential atomic batching', () => {
  it('6개를 [5, 1]로 순차 처리하고 각 local ordinal을 정확한 원본 id에 결합한다', async () => {
    const sourceRecords = records(6);
    const first = deferred<RefineOutcome>();
    native.refine
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async (items: readonly OnDeviceSummaryItem[]) => successful(items));
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(sourceRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    expect(native.refine).not.toHaveBeenCalled();
    view.rerender({ value: input(sourceRecords, { requestVersion: 1 }) });

    await waitFor(() => expect(native.refine).toHaveBeenCalledTimes(1));
    expect(native.refine.mock.calls[0][0]).toHaveLength(5);
    expect(native.refine.mock.calls[0][0].map((item: OnDeviceSummaryItem) => item.index))
      .toEqual([0, 1, 2, 3, 4]);
    expect(view.result.current.refined.size).toBe(0);

    const firstItems = native.refine.mock.calls[0][0] as OnDeviceSummaryItem[];
    await act(async () => { first.resolve(successful(firstItems)); });

    await waitFor(() => expect(native.refine).toHaveBeenCalledTimes(2));
    expect(native.refine.mock.calls[1][0]).toHaveLength(1);
    expect(native.refine.mock.calls[1][0].map((item: OnDeviceSummaryItem) => item.index))
      .toEqual([0]);
    await waitFor(() => expect(view.result.current.status).toBe('applied'));
    expect([...view.result.current.refined.entries()]).toEqual([
      ['record-00', 'record-00 summary-00…'],
      ['record-01', 'record-01 summary-01…'],
      ['record-02', 'record-02 summary-02…'],
      ['record-03', 'record-03 summary-03…'],
      ['record-04', 'record-04 summary-04…'],
      ['record-05', 'record-05 summary-05…'],
    ]);
    expect(native.refine.mock.calls.map((call) => call[1])).toEqual([
      { timeoutMs: 4000 },
      { timeoutMs: 4000 },
    ]);
  });

  it('20개를 5개씩 정확히 4회 처리한다', async () => {
    const sourceRecords = records(20);
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(sourceRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(sourceRecords, { requestVersion: 1 }) });

    await waitFor(() => expect(view.result.current.status).toBe('applied'));
    expect(native.refine.mock.calls.map((call) => call[0].length)).toEqual([5, 5, 5, 5]);
    expect(view.result.current.refined.size).toBe(20);
  });

  it('21개는 preflight와 모델을 모두 0회 유지하고 deterministic 결과만 쓴다', async () => {
    const view = renderHook(() => useOnDeviceDailySummary(input(records(21), { requestVersion: 1 })));

    await waitFor(() => expect(view.result.current.reason).toBe('too_many_candidates'));
    expect(view.result.current.status).toBe('unavailable');
    expect(view.result.current.refined.size).toBe(0);
    expect(native.preflight).not.toHaveBeenCalled();
    expect(native.refine).not.toHaveBeenCalled();
  });

  it('두 번째 batch가 timeout이면 첫 batch 결과도 한 번도 공개하지 않는다', async () => {
    const sourceRecords = records(6);
    const second = deferred<RefineOutcome>();
    native.refine
      .mockImplementationOnce(async (items: readonly OnDeviceSummaryItem[]) => successful(items))
      .mockImplementationOnce(() => second.promise);
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(sourceRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(sourceRecords, { requestVersion: 1 }) });
    await waitFor(() => expect(native.refine).toHaveBeenCalledTimes(2));
    expect(view.result.current.status).toBe('running');
    expect(view.result.current.refined.size).toBe(0);

    await act(async () => { second.resolve({ ok: false, reason: 'timeout' }); });

    await waitFor(() => expect(view.result.current.status).toBe('fallback'));
    expect(view.result.current.reason).toBe('timeout');
    expect(view.result.current.refined.size).toBe(0);
  });

  it('명시적 사용자 요청 전에는 모델을 호출하지 않는다', async () => {
    const view = renderHook(() => useOnDeviceDailySummary(input(records(5))));

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.status).toBe('idle');
    expect(native.refine).not.toHaveBeenCalled();
  });

  it('실행 중 input이 바뀌면 이전 input의 늦은 결과를 폐기한다', async () => {
    const initialRecords = records(6);
    const pending = deferred<RefineOutcome>();
    native.refine
      .mockImplementationOnce(async (items: readonly OnDeviceSummaryItem[]) => successful(items))
      .mockImplementationOnce(() => pending.promise);
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(initialRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(initialRecords, { requestVersion: 1 }) });
    await waitFor(() => expect(native.refine).toHaveBeenCalledTimes(2));
    const oldItems = native.refine.mock.calls[1][0] as OnDeviceSummaryItem[];
    expect(view.result.current.refined.size).toBe(0);

    view.rerender({ value: input(records(21), { requestVersion: 1 }) });
    await waitFor(() => expect(view.result.current.reason).toBe('too_many_candidates'));
    await act(async () => { pending.resolve(successful(oldItems)); });

    expect(view.result.current.status).toBe('unavailable');
    expect(view.result.current.refined.size).toBe(0);
    expect(native.cancel).toHaveBeenCalled();
    expect(native.refine).toHaveBeenCalledTimes(2);
  });

  it('실행 중 identity가 사라지면 이전 identity의 늦은 결과를 폐기한다', async () => {
    const sourceRecords = records(2);
    const pending = deferred<RefineOutcome>();
    native.refine.mockImplementationOnce(() => pending.promise);
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(sourceRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(sourceRecords, { requestVersion: 1 }) });
    await waitFor(() => expect(native.refine).toHaveBeenCalledTimes(1));
    const oldItems = native.refine.mock.calls[0][0] as OnDeviceSummaryItem[];

    view.rerender({
      value: input(sourceRecords, { requestVersion: 1, viewerUserId: undefined }),
    });
    await waitFor(() => expect(view.result.current.reason).toBe('identity_unresolved'));
    await act(async () => { pending.resolve(successful(oldItems)); });

    expect(view.result.current.status).toBe('unavailable');
    expect(view.result.current.refined.size).toBe(0);
    expect(native.cancel).toHaveBeenCalled();
  });

  it('unmount 뒤 도착한 batch 결과를 버리고 다음 batch를 시작하지 않는다', async () => {
    const sourceRecords = records(6);
    const pending = deferred<RefineOutcome>();
    native.refine.mockImplementationOnce(() => pending.promise);
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(sourceRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(sourceRecords, { requestVersion: 1 }) });
    await waitFor(() => expect(native.refine).toHaveBeenCalledTimes(1));
    const oldItems = native.refine.mock.calls[0][0] as OnDeviceSummaryItem[];
    view.unmount();
    expect(native.cancel).toHaveBeenCalled();

    await act(async () => { pending.resolve(successful(oldItems)); });
    expect(native.refine).toHaveBeenCalledTimes(1);
  });
});
