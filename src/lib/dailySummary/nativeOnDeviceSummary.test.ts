import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildOnDeviceItems } from '@/lib/dailySummary/contract';
import {
  ON_DEVICE_SUMMARY_LOCALE,
  ON_DEVICE_SUMMARY_PLUGIN_NAME,
  __setOnDeviceSummaryPluginForTests,
  cancelOnDeviceSummary,
  isOnDeviceDailySummaryEnabled,
  onDeviceSummaryGate,
  refineOnDeviceSummary,
  type OnDeviceSummaryPlugin,
} from '@/lib/dailySummary/nativeOnDeviceSummary';

/**
 * 규칙 결과로 되돌아가는 모든 경로.
 *
 * 이 기능의 안전성은 "모델이 잘 동작한다"가 아니라 **"모델이 동작하지 않아도 화면이 옳다"**에
 * 있다. 그래서 세는 것은 실패 경로다: 기본값 꺼짐, 웹, Android, 미지원, timeout, 취소.
 */

const ITEMS = buildOnDeviceItems([
  { recordId: 'a', text: '오늘 시험 끝났어', time: '09:00', date: '2026-08-22' },
  { recordId: 'b', text: '점심 먹었어', time: '13:00', date: '2026-08-22' },
]);

const platform = vi.hoisted(() => ({ native: false, name: 'web', pluginAvailable: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => platform.name,
    isPluginAvailable: () => platform.pluginAvailable,
  },
  registerPlugin: () => {
    throw new Error('no native bridge in this environment');
  },
}));

function stubPlugin(over: Partial<OnDeviceSummaryPlugin> = {}): OnDeviceSummaryPlugin {
  return {
    availability: vi.fn(async () => ({ available: true, reason: 'ready' })),
    refineLines: vi.fn(async (options) => ({
      requestId: options.requestId,
      items: options.items.map((item) => ({ index: item.index, text: `다듬음 ${item.index}` })),
    })),
    cancel: vi.fn(async () => undefined),
    ...over,
  };
}

beforeEach(() => {
  platform.native = false;
  platform.name = 'web';
  platform.pluginAvailable = false;
  __setOnDeviceSummaryPluginForTests(null);
  vi.unstubAllEnvs();
});

afterEach(() => {
  __setOnDeviceSummaryPluginForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('기본값은 꺼짐', () => {
  it('환경 변수가 없으면 꺼져 있다', () => {
    expect(isOnDeviceDailySummaryEnabled()).toBe(false);
    expect(onDeviceSummaryGate()).toBe('disabled');
  });

  it("문자열 'true' 만 켠다", () => {
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', value);
      expect(isOnDeviceDailySummaryEnabled()).toBe(false);
    }
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
    expect(isOnDeviceDailySummaryEnabled()).toBe(true);
  });

  it('꺼져 있으면 플러그인을 부르지 않는다', async () => {
    const plugin = stubPlugin();
    // flag 게이트가 주입보다 먼저다.
    __setOnDeviceSummaryPluginForTests(plugin);
    const outcome = await refineOnDeviceSummary(ITEMS);
    expect(outcome).toEqual({ ok: false, reason: 'disabled' });
    expect(plugin.availability).not.toHaveBeenCalled();
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });
});

describe('iOS 네이티브가 아니면 시도하지 않는다', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  it('웹', async () => {
    expect(onDeviceSummaryGate()).toBe('not_ios');
    expect(await refineOnDeviceSummary(ITEMS)).toEqual({ ok: false, reason: 'not_ios' });
  });

  it('Android -- 이 기능에는 Android 구현이 없다', async () => {
    platform.native = true;
    platform.name = 'android';
    platform.pluginAvailable = true;
    expect(onDeviceSummaryGate()).toBe('not_ios');
    expect(await refineOnDeviceSummary(ITEMS)).toEqual({ ok: false, reason: 'not_ios' });
  });

  it('iOS인데 플러그인이 등록되지 않았다', async () => {
    platform.native = true;
    platform.name = 'ios';
    platform.pluginAvailable = false;
    expect(onDeviceSummaryGate()).toBe('plugin_missing');
    expect(await refineOnDeviceSummary(ITEMS)).toEqual({ ok: false, reason: 'plugin_missing' });
  });
});

describe('플러그인이 있어도 답을 믿기 전에 게이트가 있다', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  it('모델이 미지원이면 규칙 결과로 되돌아간다', async () => {
    const plugin = stubPlugin({
      availability: vi.fn(async () => ({ available: false, reason: 'model_unavailable' })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    expect(await refineOnDeviceSummary(ITEMS)).toEqual({ ok: false, reason: 'unsupported' });
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('로케일이 미지원이어도 같다', async () => {
    const plugin = stubPlugin({
      availability: vi.fn(async () => ({ available: false, reason: 'locale_unsupported' })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    expect(await refineOnDeviceSummary(ITEMS)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('한국어 로케일로 물어본다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    await refineOnDeviceSummary(ITEMS);
    expect(plugin.availability).toHaveBeenCalledWith({ locale: ON_DEVICE_SUMMARY_LOCALE });
    expect(ON_DEVICE_SUMMARY_LOCALE).toBe('ko_KR');
  });

  it('네이티브가 던지면 콘텐츠 없는 코드 하나로 접는다', async () => {
    const plugin = stubPlugin({
      refineLines: vi.fn(async () => { throw new Error('E_ON_DEVICE_SUMMARY'); }),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    expect(await refineOnDeviceSummary(ITEMS)).toEqual({ ok: false, reason: 'native_error' });
  });

  it('빈 요청을 보내지 않는다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    expect(await refineOnDeviceSummary([])).toEqual({ ok: false, reason: 'rejected' });
    expect(plugin.availability).not.toHaveBeenCalled();
  });

  it('요청과 짝이 맞지 않는 응답을 쓰지 않는다', async () => {
    const plugin = stubPlugin({
      refineLines: vi.fn(async () => ({ requestId: 'somebody-elses-request', items: [] })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    expect(await refineOnDeviceSummary(ITEMS)).toEqual({ ok: false, reason: 'rejected' });
  });
});

describe('timeout', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  it('시간이 지나면 포기하고 취소를 보낸다', async () => {
    const plugin = stubPlugin({
      // 절대 끝나지 않는 요청.
      refineLines: vi.fn(() => new Promise(() => undefined)),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    const outcome = await refineOnDeviceSummary(ITEMS, { timeoutMs: 5 });
    expect(outcome).toEqual({ ok: false, reason: 'timeout' });
    await Promise.resolve();
    expect(plugin.cancel).toHaveBeenCalledTimes(1);
  });

  it('지원 여부 확인이 멈춰도 같은 제한 안에서 포기한다', async () => {
    const plugin = stubPlugin({
      availability: vi.fn(() => new Promise(() => undefined)),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    const outcome = await refineOnDeviceSummary(ITEMS, { timeoutMs: 5 });
    expect(outcome).toEqual({ ok: false, reason: 'timeout' });
    await Promise.resolve();
    expect(plugin.cancel).toHaveBeenCalledTimes(1);
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });
});

describe('취소와 single-flight', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  it('새 요청이 이전 요청을 취소한다', async () => {
    let releaseFirst: ((value: { requestId: string; items: unknown }) => void) | undefined;
    const seen: string[] = [];
    const plugin = stubPlugin({
      refineLines: vi.fn((options) => {
        seen.push(options.requestId);
        if (seen.length === 1) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ requestId: options.requestId, items: [] });
          });
        }
        return Promise.resolve({
          requestId: options.requestId,
          items: options.items.map((item) => ({ index: item.index, text: `두번째 ${item.index}` })),
        });
      }),
    });
    __setOnDeviceSummaryPluginForTests(plugin);

    const first = refineOnDeviceSummary(ITEMS);
    // 첫 요청이 `refineLines`에 도달할 때까지 microtask를 흘려보낸다.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const second = await refineOnDeviceSummary(ITEMS);
    expect(second.ok).toBe(true);
    expect(plugin.cancel).toHaveBeenCalledWith({ requestId: seen[0] });

    releaseFirst?.({ requestId: seen[0], items: [] });
    // 늦게 도착한 첫 응답은 화면에 쓰이지 않는다.
    expect(await first).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('화면을 떠나면 진행 중인 요청을 놓아 준다', async () => {
    const plugin = stubPlugin({ refineLines: vi.fn(() => new Promise(() => undefined)) });
    __setOnDeviceSummaryPluginForTests(plugin);
    const pending = refineOnDeviceSummary(ITEMS, { timeoutMs: 20 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    cancelOnDeviceSummary();
    await Promise.resolve();
    expect(plugin.cancel).toHaveBeenCalledTimes(1);
    // timeout이 먼저 끝나도 결과는 화면에 쓰이지 않는 실패다.
    expect((await pending).ok).toBe(false);
  });

  it('진행 중인 요청이 없으면 취소가 아무 일도 하지 않는다', () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    cancelOnDeviceSummary();
    expect(plugin.cancel).not.toHaveBeenCalled();
  });
});

describe('브리지 이름은 한 곳에서만 정해진다', () => {
  it('네이티브가 등록하는 이름과 같은 리터럴이다', () => {
    expect(ON_DEVICE_SUMMARY_PLUGIN_NAME).toBe('GomsinlogOnDeviceSummary');
  });
});
