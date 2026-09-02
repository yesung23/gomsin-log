import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  OnDeviceSummaryFailure,
  OnDeviceSummaryItem,
} from '@/lib/dailySummary/contract';

/**
 * iOS 온디바이스 요약 플러그인으로 가는 유일한 통로.
 *
 * ## 기본값은 켜짐
 *
 * 지원되는 iOS 네이티브 기기에서는 기본적으로 사용할 수 있다. 운영 중 긴급히 끌 필요가
 * 있을 때만 `VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED=false|0|off`를 명시한다. 이 값은
 * 브라우저 번들에 인라인되는 공개 kill switch일 뿐 자격증명이 아니다. 실제 생성은 스토리의
 * 사용자 버튼을 눌렀을 때만 시작하고, 웹·Android·미지원 모델은 기존 규칙 요약으로 남는다.
 *
 * ## Android 구현이 없다
 *
 * 없는 것이 아니라 **만들지 않는다.** Foundation Models는 Apple 플랫폼 API이고, Android에서
 * 같은 보장(온디바이스, 서버 전송 없음)을 주는 대체 구현은 별개의 결정이다. 그래서
 * `getPlatform() === 'ios'`가 아니면 `not_ios`로 끝내고 규칙 결과를 쓴다. 조용한 downgrade는
 * "어느 경로가 실제로 돌았는가"를 답할 수 없게 만든다.
 *
 * ## 로그
 *
 * 이 파일은 요약 텍스트를 어디에도 기록하지 않는다. 밖으로 나가는 것은 `OnDeviceSummaryFailure`
 * 코드뿐이고, `requestId`는 이 프로세스 안에서만 쓰는 불투명 값이다.
 */

export const ON_DEVICE_SUMMARY_PLUGIN_NAME = 'GomsinlogOnDeviceSummary';

/** 모델이 이 로케일을 지원하는지 네이티브가 확인한다. 제품 언어는 한국어다. */
export const ON_DEVICE_SUMMARY_LOCALE = 'ko_KR';

/**
 * 이 시간을 넘기면 규칙 결과를 그대로 둔다.
 *
 * 표지는 상대의 하루를 1분 안에 훑는 화면이므로, 문장을 다듬으려고 화면을 기다리게 하는 것은
 * 그 자체로 제품 계약 위반이다. 시간이 지나면 요청을 취소하고 조용히 포기한다.
 */
export const ON_DEVICE_SUMMARY_TIMEOUT_MS = 4000;

export interface OnDeviceSummaryPlugin {
  availability(options: { locale: string }): Promise<{ available: boolean; reason: unknown }>;
  refineLines(options: {
    requestId: string;
    locale: string;
    items: OnDeviceSummaryItem[];
  }): Promise<{ requestId?: unknown; items?: unknown }>;
  cancel(options: { requestId: string }): Promise<void>;
}

export type OnDeviceRefineOutcome =
  /** `items`는 아직 검증되지 않았다. `verify.ts`를 통과해야 화면에 닿는다. */
  | { ok: true; items: unknown }
  | { ok: false; reason: OnDeviceSummaryFailure };

const AVAILABILITY_FAILURES = new Set<OnDeviceSummaryFailure>([
  'os_too_old',
  'framework_missing',
  'model_unavailable',
  'locale_unsupported',
]);

function availabilityFailure(reason: unknown): OnDeviceSummaryFailure {
  return typeof reason === 'string' && AVAILABILITY_FAILURES.has(reason as OnDeviceSummaryFailure)
    ? reason as OnDeviceSummaryFailure
    : 'unsupported';
}

export function isOnDeviceDailySummaryEnabled(): boolean {
  const value = import.meta.env.VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED;
  if (value === undefined) return true;
  return !['false', '0', 'off'].includes(value.trim().toLowerCase());
}

let registered: OnDeviceSummaryPlugin | null = null;
let injectedForTests: OnDeviceSummaryPlugin | null = null;

/**
 * 지금 이 순간 실제로 진행 중인 요청.
 *
 * single-flight의 의미가 여기 있다. 표지가 다시 계산될 때마다 새 요청을 겹쳐 던지면 모델이
 * 직렬화된 큐를 만들고, 먼저 던진 요청의 응답이 뒤에 도착해 이미 지나간 화면 상태를 덮는다.
 * 새 요청은 이전 요청을 먼저 취소하고, 취소된 요청의 응답은 도착해도 버린다.
 */
let currentRequestId: string | null = null;

function plugin(): OnDeviceSummaryPlugin | null {
  if (injectedForTests) return injectedForTests;
  if (registered) return registered;
  try {
    registered = registerPlugin<OnDeviceSummaryPlugin>(ON_DEVICE_SUMMARY_PLUGIN_NAME);
    return registered;
  } catch {
    return null;
  }
}

function isIosNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

function isPluginRegistered(): boolean {
  try {
    return Capacitor.isPluginAvailable(ON_DEVICE_SUMMARY_PLUGIN_NAME);
  } catch {
    return false;
  }
}

/** 호출 전에 확인할 수 있는 모든 게이트. `'ready'`가 아니면 규칙 결과를 쓴다. */
export function onDeviceSummaryGate(): 'ready' | OnDeviceSummaryFailure {
  if (!isOnDeviceDailySummaryEnabled()) return 'disabled';
  // 테스트가 주입한 플러그인은 플랫폼 판정을 건너뛴다. 실제 게이트는 위의 flag와 아래의
  // 네이티브 판정이며, 이 우회는 `injectedForTests`가 설정된 동안에만 존재한다.
  if (injectedForTests) return 'ready';
  if (!isIosNative()) return 'not_ios';
  if (!isPluginRegistered()) return 'plugin_missing';
  return 'ready';
}

/** 콘텐츠를 담지 않는 불투명 상관관계 id. */
function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // 아래 fallback으로 내려간다.
  }
  return `ods-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 취소는 언제나 best-effort다. 실패해도 호출부의 결과를 바꾸지 않는다. */
function requestCancel(port: OnDeviceSummaryPlugin, requestId: string): void {
  void Promise.resolve()
    .then(() => port.cancel({ requestId }))
    .catch(() => undefined);
}

export async function refineOnDeviceSummary(
  items: readonly OnDeviceSummaryItem[],
  options: { timeoutMs?: number } = {},
): Promise<OnDeviceRefineOutcome> {
  const gate = onDeviceSummaryGate();
  if (gate !== 'ready') return { ok: false, reason: gate };
  if (items.length === 0) return { ok: false, reason: 'rejected' };

  const port = plugin();
  if (!port) return { ok: false, reason: 'plugin_missing' };

  const previous = currentRequestId;
  const requestId = newRequestId();
  currentRequestId = requestId;
  if (previous && previous !== requestId) requestCancel(port, previous);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = options.timeoutMs ?? ON_DEVICE_SUMMARY_TIMEOUT_MS;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const support = await Promise.race([
      port.availability({ locale: ON_DEVICE_SUMMARY_LOCALE }),
      timedOut,
    ]);
    if (support === 'timeout') {
      requestCancel(port, requestId);
      return { ok: false, reason: 'timeout' };
    }
    if (support?.available !== true) {
      return { ok: false, reason: availabilityFailure(support?.reason) };
    }
    if (currentRequestId !== requestId) return { ok: false, reason: 'cancelled' };

    const raced = await Promise.race([
      port.refineLines({ requestId, locale: ON_DEVICE_SUMMARY_LOCALE, items: [...items] }),
      timedOut,
    ]);

    if (raced === 'timeout') {
      requestCancel(port, requestId);
      return { ok: false, reason: 'timeout' };
    }
    // 이 요청이 진행 중인 요청이 아니라면 응답이 늦게 도착한 것이다. 화면에 쓰지 않는다.
    if (currentRequestId !== requestId) return { ok: false, reason: 'cancelled' };
    if (raced?.requestId !== requestId) return { ok: false, reason: 'rejected' };
    return { ok: true, items: raced.items };
  } catch {
    // 네이티브는 콘텐츠 없는 코드만 던진다. 그 코드조차 여기서 하나로 접는다 -- 호출부가
    // 분기할 이유가 없고, 분기하지 않는 편이 실패 경로를 하나로 유지한다.
    return { ok: false, reason: 'native_error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (currentRequestId === requestId) currentRequestId = null;
  }
}

/** 화면을 떠날 때 부른다. 진행 중인 요청을 놓아 주고 늦은 응답을 무효화한다. */
export function cancelOnDeviceSummary(): void {
  const requestId = currentRequestId;
  currentRequestId = null;
  if (!requestId) return;
  const port = plugin();
  if (!port) return;
  requestCancel(port, requestId);
}

/** 테스트 seam. 운영 호출부는 쓰지 않는다. */
export function __setOnDeviceSummaryPluginForTests(port: OnDeviceSummaryPlugin | null): void {
  injectedForTests = port;
  currentRequestId = null;
}
