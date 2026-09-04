import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { CoupleStatus, DailyRecord } from '@/types';
import type { BriefingLocale } from './contract';
import { FakeBriefingProvider } from './provider';
import {
  usePartnerBriefing,
  type UsePartnerBriefingInput,
} from './usePartnerBriefing';

function makeValidRecord(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec_1',
    userId: 'partner_456',
    date: '2026-08-28',
    time: '09:00',
    authorRole: 'soldier',
    log: '아침 점호 무사히 완료했어.',
    isPrivate: false,
    createdAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function makeDefaultInput(
  overrides: Partial<UsePartnerBriefingInput> = {},
): UsePartnerBriefingInput {
  return {
    enabled: true,
    requestVersion: 1,
    surface: [makeValidRecord()],
    viewerUserId: 'viewer_123',
    partnerUserId: 'partner_456',
    coupleConnected: true,
    coupleStatus: 'active',
    ...overrides,
  };
}

describe('usePartnerBriefing (Phase B1)', () => {
  describe('Explicit on-device refinement', () => {
    it('does not invoke the provider before the user requests refinement', async () => {
      const provider = new FakeBriefingProvider();
      const { result } = renderHook(() => usePartnerBriefing(makeDefaultInput({
        provider,
        requestVersion: 0,
      })));

      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.refinementStatus).toBe('idle');
      expect(result.current.canRequestRefinement).toBe(true);
      await act(async () => { await Promise.resolve(); });
      expect(provider.getCallHistory()).toHaveLength(0);
    });

    it('runs once for a new explicit request and applies only the verified result', async () => {
      const provider = new FakeBriefingProvider();
      let requestVersion = 0;
      const { result, rerender } = renderHook(() => usePartnerBriefing(makeDefaultInput({
        provider,
        requestVersion,
      })));

      requestVersion = 1;
      rerender();

      await waitFor(() => expect(result.current.briefing?.generation).toBe('on_device'));
      expect(result.current.refinementStatus).toBe('applied');
      expect(result.current.canRequestRefinement).toBe(false);
      const callCount = provider.getCallHistory().length;

      rerender();
      await act(async () => { await Promise.resolve(); });
      expect(provider.getCallHistory()).toHaveLength(callCount);
    });

    it('does not send newly arriving records until the user makes another request', async () => {
      const provider = new FakeBriefingProvider();
      let requestVersion = 1;
      let surface = [makeValidRecord({ id: 'first', log: '첫 기록' })];
      const { result, rerender } = renderHook(() => usePartnerBriefing(makeDefaultInput({
        provider,
        requestVersion,
        surface,
      })));

      await waitFor(() => expect(result.current.briefing?.generation).toBe('on_device'));
      const firstCallCount = provider.getCallHistory().length;

      surface = [...surface, makeValidRecord({ id: 'late', time: '13:00', log: '늦게 온 기록' })];
      rerender();
      await act(async () => { await Promise.resolve(); });

      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.refinementStatus).toBe('idle');
      expect(provider.getCallHistory()).toHaveLength(firstCallCount);

      requestVersion = 2;
      rerender();
      await waitFor(() => expect(result.current.briefing?.generation).toBe('on_device'));
      expect(provider.getCallHistory().length).toBeGreaterThan(firstCallCount);
    });
  });

  describe('Disabled State', () => {
    it('returns disabled and null briefing without querying provider when enabled is false', () => {
      const provider = new FakeBriefingProvider();
      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            enabled: false,
            provider,
          }),
        ),
      );

      expect(result.current.status).toBe('disabled');
      expect(result.current.briefing).toBeNull();
      expect(provider.getCallHistory()).toHaveLength(0);
    });
  });

  describe('Empty Corpus State', () => {
    it('returns empty and null briefing when surface array is empty', () => {
      const provider = new FakeBriefingProvider();
      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [],
            provider,
          }),
        ),
      );

      expect(result.current.status).toBe('empty');
      expect(result.current.briefing).toBeNull();
      expect(provider.getCallHistory()).toHaveLength(0);
    });

    it('returns empty and null briefing when all surface records are filtered out', () => {
      const provider = new FakeBriefingProvider();
      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [
              makeValidRecord({ id: 'rec_priv', isPrivate: true }),
              makeValidRecord({ id: 'rec_wrong', userId: 'other_user' }),
              makeValidRecord({
                id: 'rec_unreadable',
                contentUnavailable: 'crypto_error',
              }),
              makeValidRecord({ id: '' }),
            ],
            provider,
          }),
        ),
      );

      expect(result.current.status).toBe('empty');
      expect(result.current.briefing).toBeNull();
      expect(provider.getCallHistory()).toHaveLength(0);
    });
  });

  describe('Unavailable Preconditions (Fail-Closed)', () => {
    it('returns unavailable when couple is not connected', () => {
      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            coupleConnected: false,
          }),
        ),
      );

      expect(result.current.status).toBe('unavailable');
      expect(result.current.briefing).toBeNull();
    });

    it.each<CoupleStatus | null | undefined>([
      'pending',
      'disconnected',
      null,
      undefined,
    ])('returns unavailable when coupleStatus is %s', (status) => {
      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            coupleStatus: status,
          }),
        ),
      );

      expect(result.current.status).toBe('unavailable');
      expect(result.current.briefing).toBeNull();
    });

    it.each([undefined, null, '', '   '])(
      'returns unavailable when viewerUserId is %j',
      (viewerId) => {
        const { result } = renderHook(() =>
          usePartnerBriefing(
            makeDefaultInput({
              viewerUserId: viewerId,
            }),
          ),
        );

        expect(result.current.status).toBe('unavailable');
        expect(result.current.briefing).toBeNull();
      },
    );

    it('returns unavailable when viewerUserId equals partnerUserId', () => {
      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            viewerUserId: 'user_same',
            partnerUserId: 'user_same',
          }),
        ),
      );

      expect(result.current.status).toBe('unavailable');
      expect(result.current.briefing).toBeNull();
    });

    it('returns unavailable when a record has an impossible date (malformed chronology metadata)', () => {
      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [makeValidRecord({ date: '2026-02-30' })],
          }),
        ),
      );

      expect(result.current.status).toBe('unavailable');
      expect(result.current.briefing).toBeNull();
    });
  });

  describe('Privacy Boundary and Exclusion Filtering', () => {
    it('excludes private/wrong-partner/unreadable records and never passes them to the model', async () => {
      const provider = new FakeBriefingProvider();
      const mixedSurface: DailyRecord[] = [
        makeValidRecord({
          id: 'rec_ok_1',
          time: '08:00',
          log: '아침 먹었어.',
        }),
        makeValidRecord({
          id: 'rec_private',
          isPrivate: true,
          log: '비밀 개인 일기',
        }),
        makeValidRecord({
          id: 'rec_viewer',
          userId: 'viewer_123',
          log: '내 기록',
        }),
        makeValidRecord({
          id: 'rec_unreadable',
          contentUnavailable: 'crypto_error',
          log: '복호화 실패',
        }),
        makeValidRecord({
          id: 'rec_ok_2',
          time: '12:30',
          log: '점심 든든하게 먹었어.',
        }),
      ];

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: mixedSurface,
            provider,
          }),
        ),
      );

      // Synchronous baseline includes only accepted records
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.sourceCount).toBe(2);
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual([
        'rec_ok_1',
        'rec_ok_2',
      ]);

      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('on_device');
      });

      // Model call verification
      const history = provider.getCallHistory();
      expect(history).toHaveLength(2);
      expect(history[0].items).toHaveLength(1);
      expect(history[0].items[0].candidates[0].text).toContain('아침 먹었어');
      expect(history[1].items).toHaveLength(1);
      expect(history[1].items[0].candidates[0].text).toContain('점심');

      const serializedRequests = JSON.stringify(history);
      expect(serializedRequests).not.toContain('비밀');
      expect(serializedRequests).not.toContain('내 기록');
      expect(serializedRequests).not.toContain('복호화 실패');
    });
  });

  describe('Deterministic Baseline (No Provider)', () => {
    it('synchronously builds deterministic baseline with exact sourceRecordIds for valid multi-day input', () => {
      const surface: DailyRecord[] = [
        makeValidRecord({
          id: 'rec_day1_1',
          date: '2026-08-27',
          time: '09:00',
          log: '첫째 날 아침입니다.',
        }),
        makeValidRecord({
          id: 'rec_day1_2',
          date: '2026-08-27',
          time: '19:00',
          log: '첫째 날 저녁입니다.',
        }),
        makeValidRecord({
          id: 'rec_day2_1',
          date: '2026-08-28',
          time: '14:00',
          log: '둘째 날 오후입니다.',
        }),
      ];

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface,
            provider: null,
          }),
        ),
      );

      expect(result.current.status).toBe('ready');
      expect(result.current.briefing).not.toBeNull();
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.sourceCount).toBe(3);
      expect(result.current.briefing?.rangeLabel).toBe('8월 27일 ~ 8월 28일');
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual([
        'rec_day1_1',
        'rec_day1_2',
        'rec_day2_1',
      ]);
      expect(result.current.briefing?.days).toHaveLength(2);
      expect(result.current.briefing?.days[0].date).toBe('2026-08-27');
      expect(result.current.briefing?.days[1].date).toBe('2026-08-28');
    });
  });

  describe('Provider Refinement & Verified Success', () => {
    it('returns synchronous baseline immediately and upgrades to on_device when provider finishes', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 30,
      });

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [
              makeValidRecord({
                id: 'rec_1',
                log: '오늘 하루도 수고했어. 내일 봐!',
              }),
            ],
            provider,
          }),
        ),
      );

      // Immediate synchronous baseline
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        '“오늘 하루도 수고했어.”라고 기록했어요.',
      );

      // Asynchronous upgrade
      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('on_device');
      });

      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe(
        'rec_1',
      );
    });
  });

  describe('Provider Failure, Unavailable, and Timeout', () => {
    it('retains safe deterministic baseline when provider is unsupported or unavailable', async () => {
      const provider = new FakeBriefingProvider({
        availability: 'model_unavailable',
      });

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [makeValidRecord({ id: 'rec_1', log: '훈련 끝!' })],
            provider,
          }),
        ),
      );

      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');

      // Ensure it stays deterministic
      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('deterministic');
      });
      expect(provider.getCallHistory()).toHaveLength(0);
    });

    it('proves provider failure code executes provider call and retains safe deterministic result with exact source IDs', async () => {
      const provider = new FakeBriefingProvider({
        scenarioSelector: () => ({
          type: 'failure',
          code: 'native_error',
        }),
      });

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [
              makeValidRecord({
                id: 'rec_fail_1',
                log: '오늘 훈련 무사히 마쳤어.',
              }),
            ],
            provider,
          }),
        ),
      );

      // Verify provider call actually started and executed
      await waitFor(() => {
        expect(provider.getCallHistory()).toHaveLength(1);
      });

      // Verify UI result remains safe and deterministic with exact sourceRecordIds
      await waitFor(() => {
        expect(result.current.status).toBe('ready');
        expect(result.current.briefing?.generation).toBe('deterministic');
        expect(result.current.briefing?.overview.sourceRecordIds).toEqual([
          'rec_fail_1',
        ]);
        expect(
          result.current.briefing?.days[0].sections[0].items[0].parts[0].sourceRecordId,
        ).toBe('rec_fail_1');
      });
    });

    it('proves provider call started, times out, keeps deterministic exact-source baseline, and late completion cannot replace it', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 120,
      });

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [
              makeValidRecord({
                id: 'rec_timeout_1',
                log: '훈련 끝나고 쉬는 중이야.',
              }),
            ],
            provider,
            timeoutMs: 30,
          }),
        ),
      );

      // 1. Prove provider call actually started
      await waitFor(() => {
        expect(provider.getCallHistory()).toHaveLength(1);
      });

      // 2. Wait past the configured timeout (30ms) and confirm deterministic exact-source baseline remains
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual([
        'rec_timeout_1',
      ]);
      expect(
        result.current.briefing?.days[0].sections[0].items[0].parts[0].sourceRecordId,
      ).toBe('rec_timeout_1');

      // 3. Wait past the provider late completion (120ms total)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 4. Confirm that late completion still cannot replace the timed-out deterministic result
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual([
        'rec_timeout_1',
      ]);
      expect(
        result.current.briefing?.days[0].sections[0].items[0].parts[0].text,
      ).toBe('“훈련 끝나고 쉬는 중이야.”라고 기록했어요.');
    });
  });

  describe('Concurrency, Stale Rejection, and Cancellation', () => {
    it('prevents stale run A from overwriting subsequent run B', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: (req) => {
          // First request (for A) delayed by 150ms, second request (for B) finishes in 20ms
          return req.items[0].candidates[0].text.includes('기록A') ? 150 : 20;
        },
      });

      const recordA = makeValidRecord({
        id: 'rec_A',
        log: '기록A 첫번째 내용입니다.',
      });
      const recordB = makeValidRecord({
        id: 'rec_B',
        log: '기록B 두번째 내용입니다.',
      });

      const { result, rerender } = renderHook(
        (props: UsePartnerBriefingInput) => usePartnerBriefing(props),
        {
          initialProps: makeDefaultInput({
            surface: [recordA],
            provider,
          }),
        },
      );

      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual(['rec_A']);

      // Rerender with input B
      act(() => {
        rerender(
          makeDefaultInput({
            surface: [recordB],
            provider,
            requestVersion: 2,
          }),
        );
      });

      // Immediately shows baseline B
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual(['rec_B']);

      // Wait for B to finish and verify B is active
      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('on_device');
        expect(result.current.briefing?.overview.sourceRecordIds).toEqual(['rec_B']);
      });

      // Give enough time for delayed A to have completed in background
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Ensure A did NOT overwrite B
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual(['rec_B']);
    });

    it('does not cause state updates after unmount', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 100,
      });

      const { unmount } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [makeValidRecord()],
            provider,
          }),
        ),
      );

      unmount();

      // Wait past provider delay to ensure no unhandled exceptions or console errors
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    it('cancels active provider execution when enabled transitions to false', () => {
      const provider = new FakeBriefingProvider({
        delayMs: 200,
      });

      const { result, rerender } = renderHook(
        (props: UsePartnerBriefingInput) => usePartnerBriefing(props),
        {
          initialProps: makeDefaultInput({
            enabled: true,
            surface: [makeValidRecord()],
            provider,
          }),
        },
      );

      expect(result.current.status).toBe('ready');

      act(() => {
        rerender(
          makeDefaultInput({
            enabled: false,
            surface: [makeValidRecord()],
            provider,
          }),
        );
      });

      expect(result.current.status).toBe('disabled');
      expect(result.current.briefing).toBeNull();
    });
  });

  describe('Stable Dependency & Duplicate Avoidance', () => {
    it('does not re-trigger provider inference on equivalent rerenders with new object/array references', async () => {
      const provider = new FakeBriefingProvider();
      const rec = makeValidRecord({ id: 'rec_stable', log: '동일 내용입니다.' });

      const { result, rerender } = renderHook(
        (props: UsePartnerBriefingInput) => usePartnerBriefing(props),
        {
          initialProps: makeDefaultInput({
            surface: [rec],
            provider,
          }),
        },
      );

      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('on_device');
      });

      expect(provider.getCallHistory()).toHaveLength(1);

      // Rerender with recreated array and cloned record object with identical data
      act(() => {
        rerender(
          makeDefaultInput({
            surface: [{ ...rec }],
            provider,
          }),
        );
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Provider call count should strictly remain 1
      expect(provider.getCallHistory()).toHaveLength(1);
    });
  });

  describe('Locale Support (Gate L3c)', () => {
    it('defaults to Korean baseline byte-for-byte when locale is unspecified', () => {
      const surface: DailyRecord[] = [
        makeValidRecord({
          id: 'rec_kor_1',
          date: '2026-08-27',
          time: '09:00',
          log: '첫째 날 아침입니다.',
        }),
        makeValidRecord({
          id: 'rec_kor_2',
          date: '2026-08-28',
          time: '19:00',
          log: '둘째 날 저녁입니다.',
        }),
      ];

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface,
            provider: null,
            locale: undefined,
          }),
        ),
      );

      expect(result.current.status).toBe('ready');
      expect(result.current.briefing).not.toBeNull();
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.rangeLabel).toBe('8월 27일 ~ 8월 28일');
      expect(result.current.briefing?.overview.text).toBe(
        '2일 동안 총 2개의 기록이 있습니다.',
      );
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual([
        'rec_kor_1',
        'rec_kor_2',
      ]);
      expect(result.current.briefing?.days[0].date).toBe('2026-08-27');
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        '“첫째 날 아침입니다.”라고 기록했어요.',
      );
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe(
        'rec_kor_1',
      );
    });

    it('builds synchronous deterministic baseline in English when locale is en', () => {
      const surface: DailyRecord[] = [
        makeValidRecord({
          id: 'rec_en_1',
          date: '2026-08-27',
          time: '09:00',
          log: 'Completed morning roll call smoothly.',
        }),
        makeValidRecord({
          id: 'rec_en_2',
          date: '2026-08-28',
          time: '19:00',
          log: 'Had dinner and relaxing now.',
        }),
      ];

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface,
            provider: null,
            locale: 'en',
          }),
        ),
      );

      expect(result.current.status).toBe('ready');
      expect(result.current.briefing).not.toBeNull();
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.rangeLabel).toBe('August 27 – August 28');
      expect(result.current.briefing?.overview.text).toBe(
        'Over 2 days: 2 records in total.',
      );
      expect(result.current.briefing?.overview.sourceRecordIds).toEqual([
        'rec_en_1',
        'rec_en_2',
      ]);
      expect(result.current.briefing?.days[0].date).toBe('2026-08-27');
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “Completed morning roll call smoothly.”',
      );
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe(
        'rec_en_1',
      );
      expect(result.current.briefing?.days[1].date).toBe('2026-08-28');
      expect(result.current.briefing?.days[1].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “Had dinner and relaxing now.”',
      );
      expect(result.current.briefing?.days[1].sections[0].items[0].parts[0].sourceRecordId).toBe(
        'rec_en_2',
      );
    });

    it('upgrades to on_device with English attributed text after provider success when locale is en', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 20,
      });

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [
              makeValidRecord({
                id: 'rec_en_prov',
                date: '2026-08-28',
                log: 'Great training day today. Heading to rest!',
              }),
            ],
            provider,
            locale: 'en',
          }),
        ),
      );

      // Immediate English deterministic baseline
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.rangeLabel).toBe('August 28');
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “Great training day today.”',
      );

      // Asynchronous upgrade to on_device
      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('on_device');
      });

      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “Great training day today.”',
      );
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe(
        'rec_en_prov',
      );
    });

    it('on same records, switching ko to en shows English baseline and only a new request restarts the provider', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 150,
      });

      const record = makeValidRecord({
        id: 'rec_switch',
        date: '2026-08-28',
        log: '오늘 하루도 수고했어.',
      });

      const { result, rerender } = renderHook(
        (props: UsePartnerBriefingInput) => usePartnerBriefing(props),
        {
          initialProps: makeDefaultInput({
            surface: [record],
            provider,
            locale: 'ko' as BriefingLocale,
          }),
        },
      );

      // Initial Korean baseline
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.rangeLabel).toBe('8월 28일');
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        '“오늘 하루도 수고했어.”라고 기록했어요.',
      );

      // Confirm first Korean run reached provider selectExtracts
      await waitFor(() => {
        expect(provider.getCallHistory()).toHaveLength(1);
      });

      // Switch locale to 'en' while Korean provider run is in-flight
      act(() => {
        rerender(
          makeDefaultInput({
            surface: [record],
            provider,
            locale: 'en' as BriefingLocale,
            requestVersion: 2,
          }),
        );
      });

      // Immediately shows English baseline synchronously
      expect(result.current.status).toBe('ready');
      expect(result.current.briefing?.generation).toBe('deterministic');
      expect(result.current.briefing?.rangeLabel).toBe('August 28');
      expect(result.current.briefing?.overview.text).toBe('1 record in total.');
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “오늘 하루도 수고했어.”',
      );

      // Confirm English provider run started
      await waitFor(() => {
        expect(provider.getCallHistory()).toHaveLength(2);
      });

      // Wait for the English run to complete
      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('on_device');
      });

      // Ensure English attributed format remains active
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “오늘 하루도 수고했어.”',
      );

      // Wait past delayed Korean background execution time
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Confirm late Korean result NEVER overwrote the English state
      expect(result.current.briefing?.rangeLabel).toBe('August 28');
      expect(result.current.briefing?.days[0].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “오늘 하루도 수고했어.”',
      );
    });

    it('serialized provider request contains zero locale, record IDs, dates, or timestamps', async () => {
      const provider = new FakeBriefingProvider();
      const record = makeValidRecord({
        id: 'rec_secret_id_999',
        date: '2026-08-28',
        log: '훈련 무사히 마쳤어.',
      });

      const { result } = renderHook(() =>
        usePartnerBriefing(
          makeDefaultInput({
            surface: [record],
            provider,
            locale: 'en',
          }),
        ),
      );

      await waitFor(() => {
        expect(result.current.briefing?.generation).toBe('on_device');
      });

      const history = provider.getCallHistory();
      expect(history).toHaveLength(1);

      const serializedRequest = JSON.stringify(history[0]);
      expect(serializedRequest).not.toContain('locale');
      expect(serializedRequest).not.toContain('en');
      expect(serializedRequest).not.toContain('ko');
      expect(serializedRequest).not.toContain('rec_secret_id_999');
      expect(serializedRequest).not.toContain('2026-08-28');
      expect(serializedRequest).not.toContain('partner_456');
      expect(serializedRequest).not.toContain('viewer_123');
    });
  });
});
