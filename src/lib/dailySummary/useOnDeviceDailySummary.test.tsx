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
      log: `record-${ordinal} ${'detail '.repeat(6)}내용을 정리했어. 오후에는 운동장을 세 바퀴 걸었어.`,
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
      text: item.text.slice(item.text.lastIndexOf('. ') + 2),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.gate.mockReturnValue('ready');
  native.preflight.mockResolvedValue({ ok: true });
  native.refine.mockImplementation(async (items: readonly OnDeviceSummaryItem[]) => successful(items));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
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
      ['record-00', '…오후에는 운동장을 세 바퀴 걸었어.'],
      ['record-01', '…오후에는 운동장을 세 바퀴 걸었어.'],
      ['record-02', '…오후에는 운동장을 세 바퀴 걸었어.'],
      ['record-03', '…오후에는 운동장을 세 바퀴 걸었어.'],
      ['record-04', '…오후에는 운동장을 세 바퀴 걸었어.'],
      ['record-05', '…오후에는 운동장을 세 바퀴 걸었어.'],
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

  it('총 20개 중 긴 본문 6개만 [5, 1]로 처리하고 전체 레코드는 유지한다', async () => {
    const sourceRecords = records(20).map((record, index) => ({
      ...record,
      log: index < 6 ? record.log : `짧은 기록 ${index}`,
    }));
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(sourceRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(sourceRecords, { requestVersion: 1 }) });
    await waitFor(() => expect(view.result.current.status).toBe('applied'));

    expect(native.refine.mock.calls.map((call) => call[0].length)).toEqual([5, 1]);
    expect([...view.result.current.refined.keys()]).toEqual([
      'record-00', 'record-01', 'record-02', 'record-03', 'record-04', 'record-05',
    ]);
    expect(sourceRecords).toHaveLength(20);
    expect(sourceRecords.at(-1)?.id).toBe('record-19');
  });

  it('21개는 preflight와 모델을 모두 0회 유지하고 deterministic 결과만 쓴다', async () => {
    const view = renderHook(() => useOnDeviceDailySummary(input(records(21), { requestVersion: 1 })));

    await waitFor(() => expect(view.result.current.reason).toBe('too_many_candidates'));
    expect(view.result.current.status).toBe('unavailable');
    expect(view.result.current.refined.size).toBe(0);
    expect(native.preflight).not.toHaveBeenCalled();
    expect(native.refine).not.toHaveBeenCalled();
  });

  it('총 21개 중 긴 본문이 1개뿐이어도 preflight와 모델을 모두 생략한다', async () => {
    const sourceRecords = records(21).map((record, index) => ({
      ...record,
      log: index === 0 ? record.log : `짧은 기록 ${index}`,
    }));
    const view = renderHook(() => useOnDeviceDailySummary(input(sourceRecords, { requestVersion: 1 })));

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

  it('내용이 같은 새 records 배열은 pending 요청을 무효화하지 않는다', async () => {
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
    const cancelCount = native.cancel.mock.calls.length;

    const sameContent = sourceRecords.map((record) => ({ ...record }));
    view.rerender({ value: input(sameContent, { requestVersion: 1 }) });
    expect(native.cancel).toHaveBeenCalledTimes(cancelCount);
    expect(native.refine).toHaveBeenCalledTimes(1);

    const items = native.refine.mock.calls[0][0] as OnDeviceSummaryItem[];
    await act(async () => { pending.resolve(successful(items)); });
    await waitFor(() => expect(view.result.current.status).toBe('applied'));
  });

  it('원문이 바뀌면 예전 클릭으로 다시 추론하지 않고 새 명시적 요청을 기다린다', async () => {
    const original = records(2);
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(original) } },
    );
    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(original, { requestVersion: 1 }) });
    await waitFor(() => expect(view.result.current.status).toBe('applied'));

    const edited = [{ ...original[0], log: original[0].log!.replace('세 바퀴', '두 바퀴') }, original[1]];
    view.rerender({ value: input(edited, { requestVersion: 1 }) });
    expect(view.result.current.refined.size).toBe(0);
    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    expect(native.refine).toHaveBeenCalledTimes(1);

    view.rerender({ value: input(original, { requestVersion: 1 }) });
    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    expect(view.result.current.refined.size).toBe(0);
    expect(native.refine).toHaveBeenCalledTimes(1);

    view.rerender({ value: input(edited, { requestVersion: 2 }) });
    await waitFor(() => expect(view.result.current.status).toBe('applied'));
    expect(native.refine).toHaveBeenCalledTimes(2);
    expect(view.result.current.refined.get('record-00')).toBe('…오후에는 운동장을 두 바퀴 걸었어.');
  });

  it('같은 첫 120단위 뒤의 full-source tail이 바뀌면 이전 pending 결과를 즉시 취소·폐기한다', async () => {
    const suffix = '오후에는 운동장을 세 바퀴 걸었어.';
    const prefix120 = `${'가'.repeat(120 - suffix.length - 2)}. ${suffix}`;
    const initialRecords = [
      { ...records(1)[0], log: prefix120 },
      { ...records(1)[0], id: 'short-record', time: '18:00', log: '짧은 둘째 기록' },
    ];
    const pending = deferred<RefineOutcome>();
    native.refine.mockImplementationOnce(() => pending.promise);
    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(initialRecords) } },
    );

    await waitFor(() => expect(view.result.current.canRequest).toBe(true));
    view.rerender({ value: input(initialRecords, { requestVersion: 1 }) });
    await waitFor(() => expect(native.refine).toHaveBeenCalledTimes(1));

    const editedRecords = [
      { ...initialRecords[0], log: `${prefix120}뒤에 붙은 정정` },
      initialRecords[1],
    ];
    view.rerender({ value: input(editedRecords, { requestVersion: 1 }) });
    await waitFor(() => expect(native.cancel).toHaveBeenCalled());

    await act(async () => {
      pending.resolve({ ok: true, items: [{ index: 0, text: '가'.repeat(20) }] });
    });
    expect(view.result.current.refined.size).toBe(0);
    expect(native.refine).toHaveBeenCalledTimes(1);
  });

  it('실행 중 background로 이동하면 pending 결과를 취소하고 다음 batch를 시작하지 않는다', async () => {
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

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(native.cancel).toHaveBeenCalled());

    const oldItems = native.refine.mock.calls[0][0] as OnDeviceSummaryItem[];
    await act(async () => { pending.resolve(successful(oldItems)); });
    expect(view.result.current.refined.size).toBe(0);
    expect(native.refine).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
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

  it('실행 중 Story screen이 archive로 바뀌면 이전 결과를 취소하고 적용하지 않는다', async () => {
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

    view.rerender({ value: input(sourceRecords, { requestVersion: 1, mode: 'archive' }) });
    await waitFor(() => expect(view.result.current.reason).toBe('not_partner_today'));
    await act(async () => { pending.resolve(successful(oldItems)); });

    expect(view.result.current.refined.size).toBe(0);
    expect(native.cancel).toHaveBeenCalled();
    expect(native.refine).toHaveBeenCalledTimes(1);
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

  it('combining cluster로 40자 이하로 잘린 truncated 원문이 포함되면 safe 긴 본문이 있어도 preflight와 모델을 모두 0회 유지한다', async () => {
    const clusterRecord: DailyRecord = {
      id: 'record-cluster',
      userId: 'partner',
      date: '2026-09-04',
      time: '08:00',
      authorRole: 'gomsin',
      log: `안녕하세요 e${'\u0301'.repeat(200)}`,
      isPrivate: false,
      createdAt: '2026-09-04T08:00:00.000Z',
    } as DailyRecord;
    const safeLongRecord = records(1)[0];
    const sourceRecords = [clusterRecord, safeLongRecord];

    const view = renderHook(
      ({ value }) => useOnDeviceDailySummary(value),
      { initialProps: { value: input(sourceRecords, { requestVersion: 1 }) } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(native.preflight).not.toHaveBeenCalled();
    expect(native.refine).not.toHaveBeenCalled();
    expect(view.result.current.canRequest).toBe(false);
    expect(view.result.current.refined.size).toBe(0);
  });
});
