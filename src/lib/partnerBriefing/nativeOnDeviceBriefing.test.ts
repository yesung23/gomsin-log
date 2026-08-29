import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ON_DEVICE_BRIEFING_PLUGIN_NAME,
  __setOnDeviceBriefingPluginForTests,
  nativeOnDeviceBriefingProvider,
} from './nativeOnDeviceBriefing';
import type { BriefingExtractRequest } from './provider';

const platform = vi.hoisted(() => ({
  native: false,
  name: 'web',
  pluginAvailable: false,
  register: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => platform.name,
    isPluginAvailable: () => platform.pluginAvailable,
  },
  registerPlugin: (...args: unknown[]) => platform.register(...args),
}));

const request: BriefingExtractRequest = {
  requestId: 'request-1',
  items: [{
    itemOrdinal: 0,
    candidates: [
      { candidateOrdinal: 0, text: '오전 훈련을 시작했어.' },
      { candidateOrdinal: 1, text: '훈련을 시작했어.' },
    ],
  }],
};

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    availability: vi.fn(async () => ({ availability: 'ready' })),
    capability: vi.fn(async () => ({
      envelope: {
        maxContextUtf8Bytes: 4096,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 512,
        maxInputTextGraphemes: 1000,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      },
    })),
    selectExtracts: vi.fn(async (options: { requestId: string }) => ({
      requestId: options.requestId,
      output: {
        version: 2,
        groups: [
          {
            groupOrdinal: 0,
            choices: [{ itemOrdinal: 0, candidateOrdinal: 1 }],
          },
        ],
      },
    })),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  platform.native = false;
  platform.name = 'web';
  platform.pluginAvailable = false;
  platform.register.mockReset();
  __setOnDeviceBriefingPluginForTests(null);
});

afterEach(() => {
  __setOnDeviceBriefingPluginForTests(null);
});

describe('native platform gate', () => {
  it.each([
    [false, 'web'],
    [false, 'ios'],
    [false, 'android'],
    [true, 'electron'],
    [true, 'unknown'],
  ])('returns unsupported without registering on native=%s platform=%s', async (native, name) => {
    platform.native = native;
    platform.name = name;
    platform.pluginAvailable = true;
    expect(await nativeOnDeviceBriefingProvider.getAvailability()).toBe('unsupported');
    expect(platform.register).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])('returns unsupported when the plugin is missing on %s', async (name) => {
    platform.native = true;
    platform.name = name;
    platform.pluginAvailable = false;
    expect(await nativeOnDeviceBriefingProvider.getAvailability()).toBe('unsupported');
    expect(platform.register).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])(
    'registers the exact bridge name only after the %s native and plugin gates pass',
    async (name) => {
      const port = plugin();
      platform.native = true;
      platform.name = name;
      platform.pluginAvailable = true;
      platform.register.mockReturnValue(port);
      expect(await nativeOnDeviceBriefingProvider.getAvailability()).toBe('ready');
      expect(platform.register).toHaveBeenCalledTimes(1);
      expect(platform.register).toHaveBeenCalledWith(ON_DEVICE_BRIEFING_PLUGIN_NAME);
    },
  );
});

describe('fixed native contract', () => {
  it('forwards Korean and English locale without putting it inside the domain request', async () => {
    const port = plugin();
    __setOnDeviceBriefingPluginForTests(port);
    await nativeOnDeviceBriefingProvider.getAvailability({ locale: 'ko' });
    await nativeOnDeviceBriefingProvider.selectExtracts(request, { locale: 'en' });
    expect(port.availability).toHaveBeenCalledWith({ locale: 'ko' });
    expect(port.selectExtracts).toHaveBeenCalledWith({ ...request, locale: 'en' });
    expect(request).not.toHaveProperty('locale');
  });

  it('sends only request-local ordinals and exact-source candidates', async () => {
    const port = plugin();
    __setOnDeviceBriefingPluginForTests(port);
    await nativeOnDeviceBriefingProvider.selectExtracts(request, { locale: 'ko' });
    const payload = vi.mocked(port.selectExtracts).mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['items', 'locale', 'requestId']);
    expect(Object.keys(payload.items[0]).sort()).toEqual(['candidates', 'itemOrdinal']);
    expect(Object.keys(payload.items[0].candidates[0]).sort()).toEqual([
      'candidateOrdinal',
      'text',
    ]);
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      Object.entries(value).forEach(([key, child]) => {
        keys.add(key);
        visit(child);
      });
    };
    visit(payload);
    for (const forbidden of [
      'recordId', 'userId', 'coupleId', 'sourceRecordId', 'date', 'time',
      'url', 'path', 'keyMaterial',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('passes untrusted ordinals through without repairing them', async () => {
    const output = {
      version: 2 as const,
      groups: [
        {
          groupOrdinal: 0,
          choices: [{ itemOrdinal: 71, candidateOrdinal: -3 }],
        },
      ],
    };
    const port = plugin({
      selectExtracts: vi.fn(async () => ({ requestId: request.requestId, output })),
    });
    __setOnDeviceBriefingPluginForTests(port);
    expect(await nativeOnDeviceBriefingProvider.selectExtracts(request)).toEqual({
      ok: true,
      requestId: request.requestId,
      output,
    });
  });

  it('rejects malformed correlation/capability and bounds unknown native errors', async () => {
    const port = plugin({
      capability: vi.fn(async () => ({ envelope: { maxContextUtf8Bytes: 1 } })),
      selectExtracts: vi.fn(async () => { throw { code: 'SENSITIVE_DETAIL', message: 'content' }; }),
    });
    __setOnDeviceBriefingPluginForTests(port);
    await expect(nativeOnDeviceBriefingProvider.getCapability()).rejects.toThrow(
      'on-device briefing capability unavailable',
    );
    expect(await nativeOnDeviceBriefingProvider.selectExtracts(request)).toEqual({
      ok: false,
      requestId: request.requestId,
      code: 'native_error',
    });
  });

  it('maps malformed availability to model_unavailable', async () => {
    const port = plugin({ availability: vi.fn(async () => ({ availability: 'future_state' })) });
    __setOnDeviceBriefingPluginForTests(port);
    expect(await nativeOnDeviceBriefingProvider.getAvailability()).toBe('model_unavailable');
  });
});

describe('cancellation', () => {
  it('returns cancelled before a native call when already aborted', async () => {
    const port = plugin();
    __setOnDeviceBriefingPluginForTests(port);
    const controller = new AbortController();
    controller.abort();
    expect(await nativeOnDeviceBriefingProvider.selectExtracts(request, controller.signal)).toEqual({
      ok: false,
      requestId: request.requestId,
      code: 'cancelled',
    });
    expect(port.selectExtracts).not.toHaveBeenCalled();
  });

  it('cancels once and ignores a late native completion', async () => {
    let resolveNative: ((value: unknown) => void) | undefined;
    const port = plugin({
      selectExtracts: vi.fn(() => new Promise((resolve) => { resolveNative = resolve; })),
    });
    __setOnDeviceBriefingPluginForTests(port);
    const controller = new AbortController();
    const pending = nativeOnDeviceBriefingProvider.selectExtracts(request, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toEqual({
      ok: false,
      requestId: request.requestId,
      code: 'cancelled',
    });
    await Promise.resolve();
    expect(port.cancel).toHaveBeenCalledTimes(1);
    expect(port.cancel).toHaveBeenCalledWith({ requestId: request.requestId });
    resolveNative?.({
      requestId: request.requestId,
      output: {
        version: 2,
        groups: [
          {
            groupOrdinal: 0,
            choices: [{ itemOrdinal: 0, candidateOrdinal: 0 }],
          },
        ],
      },
    });
    await Promise.resolve();
    expect(port.cancel).toHaveBeenCalledTimes(1);
  });

  it('isolates a native cancel rejection', async () => {
    const port = plugin({ cancel: vi.fn(async () => { throw new Error('no detail crosses'); }) });
    __setOnDeviceBriefingPluginForTests(port);
    await expect(nativeOnDeviceBriefingProvider.cancel(request.requestId)).resolves.toBeUndefined();
  });
});

it('uses the native registration name required by the future Swift bridge', () => {
  expect(ON_DEVICE_BRIEFING_PLUGIN_NAME).toBe('GomsinlogOnDeviceBriefing');
});
