import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionGardenView } from './CompanionGardenView';
import { deriveCompanionGardenState } from './companionGarden';
import {
  GARDEN_BOUNDS,
  GARDEN_COMPANION_SIZE,
  companionsOverlap,
  getPhysicalGardenBounds,
  type GardenPoint,
} from './companionGardenMotion';
import type { GardenAccessory, GardenAccessoryState } from '@/lib/companionGardenLocalState';

const AVAILABLE = deriveCompanionGardenState(100);
const DEFAULT_ACCESSORIES: GardenAccessoryState = { version: 1, peach: 'none', sage: 'none' };
const ORIGINAL_RESIZE_OBSERVER = globalThis.ResizeObserver;
const ORIGINAL_GET_BOUNDING_CLIENT_RECT = HTMLElement.prototype.getBoundingClientRect;
const ORIGINAL_CLIENT_WIDTH_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const ORIGINAL_CLIENT_HEIGHT_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const ORIGINAL_CLIENT_LEFT_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientLeft');
const ORIGINAL_CLIENT_TOP_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientTop');

type SceneBorder = { left: number; top: number; right: number; bottom: number };

type GardenLayout = {
  scene: DOMRect;
  sceneBorder: SceneBorder;
  points: Partial<Record<'peach' | 'sage', GardenPoint>>;
  footprints: Record<'peach' | 'sage', { width: number; height: number }>;
};

let gardenLayout: GardenLayout;

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
  }
}

function mockReducedMotion(matches: boolean) {
  let reduced = matches;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return reduced;
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'change') listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'change') listeners.delete(listener);
    }),
    addListener: vi.fn((listener: () => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: () => void) => listeners.delete(listener)),
    dispatchEvent: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => (
      query === '(prefers-reduced-motion: reduce)'
        ? media
        : { ...media, matches: false, media: query }
    )),
  });
  return {
    set(next: boolean) {
      reduced = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function sceneClientBox(scene: DOMRect, border: SceneBorder) {
  return {
    left: scene.left + border.left,
    top: scene.top + border.top,
    width: Math.max(0, scene.width - border.left - border.right),
    height: Math.max(0, scene.height - border.top - border.bottom),
  };
}

function rectForGardenPoint(
  point: { x: number; y: number },
  scene: DOMRect,
  width = GARDEN_COMPANION_SIZE.width,
  height = GARDEN_COMPANION_SIZE.height,
  border: SceneBorder = gardenLayout.sceneBorder,
): DOMRect {
  const client = sceneClientBox(scene, border);
  const centerX = client.left + (point.x / 100) * client.width;
  const bottom = client.top + (point.y / 100) * client.height;
  return rect(centerX - width / 2, bottom - height, width, height);
}

function restoreHTMLElementMetric(name: 'clientWidth' | 'clientHeight' | 'clientLeft' | 'clientTop', descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
}

function installGardenLayout() {
  gardenLayout = {
    scene: rect(0, 0, 320, 602),
    sceneBorder: { left: 0, top: 1, right: 0, bottom: 1 },
    points: {},
    footprints: {
      peach: { width: GARDEN_COMPANION_SIZE.width, height: GARDEN_COMPANION_SIZE.height },
      sage: { width: GARDEN_COMPANION_SIZE.width, height: GARDEN_COMPANION_SIZE.height },
    },
  };
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: {
      configurable: true,
      get() {
        if (this.getAttribute('data-testid') !== 'garden-scene') return 0;
        return sceneClientBox(this.getBoundingClientRect(), gardenLayout.sceneBorder).width;
      },
    },
    clientHeight: {
      configurable: true,
      get() {
        if (this.getAttribute('data-testid') !== 'garden-scene') return 0;
        return sceneClientBox(this.getBoundingClientRect(), gardenLayout.sceneBorder).height;
      },
    },
    clientLeft: {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'garden-scene' ? gardenLayout.sceneBorder.left : 0;
      },
    },
    clientTop: {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'garden-scene' ? gardenLayout.sceneBorder.top : 0;
      },
    },
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getGardenRect() {
    const testId = this.getAttribute('data-testid');
    if (testId === 'garden-scene') return gardenLayout.scene;
    const match = testId?.match(/^garden-companion-position-(peach|sage)$/);
    if (!match) return ORIGINAL_GET_BOUNDING_CLIENT_RECT.call(this);
    const id = match[1] as 'peach' | 'sage';
    const footprint = gardenLayout.footprints[id];
    const forcedPoint = gardenLayout.points[id];
    if (forcedPoint) {
      return rectForGardenPoint(forcedPoint, gardenLayout.scene, footprint.width, footprint.height);
    }
    const transform = this.style.transform.match(
      /translate3d\(([-+\d.e]+)px,\s*([-+\d.e]+)px,\s*0(?:px)?\)/,
    );
    if (!transform) return rect(Number.NaN, Number.NaN, footprint.width, footprint.height);
    const client = sceneClientBox(gardenLayout.scene, gardenLayout.sceneBorder);
    const centerX = client.left + Number(transform[1]);
    const bottom = client.top + Number(transform[2]);
    return rect(centerX - footprint.width / 2, bottom - footprint.height, footprint.width, footprint.height);
  });
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function installResizeObserverMock() {
  const instances: Array<{
    callback: ResizeObserverCallback;
    observed: Set<Element>;
    disconnected: boolean;
  }> = [];
  class TestResizeObserver {
    private readonly record: (typeof instances)[number];

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, observed: new Set(), disconnected: false };
      instances.push(this.record);
    }

    observe = vi.fn((target: Element) => this.record.observed.add(target));
    unobserve = vi.fn((target: Element) => this.record.observed.delete(target));
    disconnect = vi.fn(() => {
      this.record.disconnected = true;
      this.record.observed.clear();
    });
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });
  return {
    instances,
    trigger(target: Element) {
      for (const instance of instances) {
        if (!instance.disconnected && instance.observed.has(target)) {
          instance.callback([], {} as ResizeObserver);
        }
      }
    },
  };
}

function ControlledGarden({ initial = DEFAULT_ACCESSORIES }: { initial?: GardenAccessoryState }) {
  return (
    <CompanionGardenView
      state={AVAILABLE}
      accessories={initial}
    />
  );
}

beforeEach(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: TestPointerEvent,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  installGardenLayout();
  mockReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreHTMLElementMetric('clientWidth', ORIGINAL_CLIENT_WIDTH_DESCRIPTOR);
  restoreHTMLElementMetric('clientHeight', ORIGINAL_CLIENT_HEIGHT_DESCRIPTOR);
  restoreHTMLElementMetric('clientLeft', ORIGINAL_CLIENT_LEFT_DESCRIPTOR);
  restoreHTMLElementMetric('clientTop', ORIGINAL_CLIENT_TOP_DESCRIPTOR);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ORIGINAL_RESIZE_OBSERVER,
  });
});

describe('interactive companion garden characters', () => {
  it('keeps the garden surface quiet while exposing one discoverable play entry point', () => {
    const onBack = vi.fn();
    const { container } = render(<CompanionGardenView
      state={AVAILABLE}
      accessories={DEFAULT_ACCESSORIES}
      onBack={onBack}
    />);

    expect(screen.getByRole('button', { name: '이전 화면으로' })).toBeInTheDocument();
    expect(screen.queryByText(/함께한 \d+일/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '우리 정원' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '든든한 나무' })).not.toBeInTheDocument();
    const playAction = screen.getByRole('button', { name: '꾸미기와 함께 놀기' });
    expect(playAction).toBeInTheDocument();
    expect(playAction).toHaveClass('min-h-11');
    expect(playAction).toHaveClass('min-w-11');
    expect(playAction.textContent?.trim()).toBe('');
    expect(screen.queryByRole('button', { name: '상점 열기' })).not.toBeInTheDocument();
    expect(screen.queryByText('길게 누르면 친구를 들어 올려 움직일 수 있어요.')).not.toBeInTheDocument();
    expect(screen.queryByText('정원은 점수나 미션 없이 함께한 시간만 따라 자라요.')).not.toBeInTheDocument();
    const scene = screen.getByTestId('garden-scene');
    expect(scene).toHaveClass('garden-surface');
    expect(scene).not.toHaveClass('bg-white');
    expect(scene).not.toHaveClass('bg-card');
    expect(scene).not.toHaveClass('border-y');
    expect(screen.getByTestId('garden-scene')).not.toHaveAttribute('style');

    // The available garden itself stays wordless; names and instructions remain
    // available to assistive technology and inside the progressive-disclosure sheet.
    const visibleTexts = Array.from(container.querySelectorAll('*:not(.sr-only)'))
      .filter((el) => el.children.length === 0 && !el.closest('.sr-only') && (el.textContent || '').trim().length > 0)
      .map((el) => el.textContent?.trim());
    expect(visibleTexts).toEqual([]);
  });

  it('turns care choices into visible, accessible character reactions without scores or chores', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');
    const liveRegion = screen.getByTestId('garden-live-region');

    fireEvent.click(peach, { detail: 0 });
    expect(screen.queryByText('한 번 누르면 정원의 친구들이 바로 반응해요.')).not.toBeInTheDocument();
    expect(screen.queryByText('방향을 골라 정원 안에서 한 칸씩 움직여요.')).not.toBeInTheDocument();
    expect(screen.getByText('선택은 이 계정의 이 기기에 저장돼요.')).toBeInTheDocument();
    for (const name of ['살구 친구 쓰다듬기', '살구 친구에게 인사하기', '두 친구 같이 놀기']) {
      const action = screen.getByRole('button', { name });
      expect(action).toHaveClass('min-h-11');
    }
    expect(screen.queryByText(/레벨|경험치|점수|출석|배고픔/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '살구 친구 쓰다듬기' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(peach).toHaveAttribute('data-care-reaction', 'pet');
    expect(sage).toHaveAttribute('data-care-reaction', 'none');
    expect(screen.queryByTestId('garden-care-reaction-peach')).not.toBeInTheDocument();
    expect(peach).toHaveAttribute('data-motion-state', 'shy');
    expect(liveRegion).toHaveTextContent('살구 친구를 쓰다듬었어요');

    act(() => vi.advanceTimersByTime(260));
    expect(peach).toHaveAttribute('data-motion-state', 'run');
    act(() => vi.advanceTimersByTime(2_000));
    expect(peach).toHaveAttribute('data-care-reaction', 'none');
    expect(screen.queryByTestId('garden-care-reaction-peach')).not.toBeInTheDocument();

    fireEvent.click(sage, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '두 친구 같이 놀기' }));
    expect(peach).toHaveAttribute('data-care-reaction', 'play');
    expect(sage).toHaveAttribute('data-care-reaction', 'play');
    expect(screen.queryByTestId('garden-care-reaction-peach')).not.toBeInTheDocument();
    expect(screen.queryByTestId('garden-care-reaction-sage')).not.toBeInTheDocument();
    expect(liveRegion).toHaveTextContent('두 친구가 함께 신나게 놀아요');
  });

  it('clears a care reaction timer when the garden becomes unavailable', () => {
    vi.useFakeTimers();
    const view = render(<CompanionGardenView state={AVAILABLE} accessories={DEFAULT_ACCESSORIES} />);

    fireEvent.click(screen.getByTestId('garden-companion-peach'), { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '살구 친구에게 인사하기' }));
    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-care-reaction', 'wave');

    view.rerender(<CompanionGardenView
      state={{ isAvailable: false, togetherDays: null, stage: null }}
      accessories={DEFAULT_ACCESSORIES}
    />);
    expect(screen.queryByTestId('garden-care-reaction-peach')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    view.rerender(<CompanionGardenView state={AVAILABLE} accessories={DEFAULT_ACCESSORIES} />);
    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-care-reaction', 'none');
  });

  it('restarts the same care animation, renews its timer, and restores focus to the trigger', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    peach.focus();

    fireEvent.click(peach, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '살구 친구에게 인사하기' }));
    const firstArt = screen.getByTestId('garden-companion-art-peach');
    expect(peach).toHaveFocus();

    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.click(peach, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '살구 친구에게 인사하기' }));
    expect(screen.getByTestId('garden-companion-art-peach')).not.toBe(firstArt);
    expect(peach).toHaveAttribute('data-care-reaction', 'wave');

    act(() => vi.advanceTimersByTime(1_000));
    expect(peach).toHaveAttribute('data-care-reaction', 'wave');
    act(() => vi.advanceTimersByTime(600));
    expect(peach).toHaveAttribute('data-care-reaction', 'none');
  });

  it('pauses autonomy for the complete care reaction and starts a fresh idle afterward', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.click(peach, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '두 친구 같이 놀기' }));
    act(() => vi.advanceTimersByTime(1_600));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(0);
    act(() => vi.advanceTimersByTime(1_999));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(0);
    act(() => vi.advanceTimersByTime(5_000));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(1);
  });

  it('renders exactly two independently addressable companions', () => {
    render(<ControlledGarden />);
    const companions = screen.getAllByRole('button', { name: /친구와 함께 놀기/ });
    expect(companions).toHaveLength(2);
    expect(companions.map((node) => node.getAttribute('data-companion'))).toEqual(['peach', 'sage']);
    expect(companions.every((node) => node.getAttribute('data-lifted') === 'false')).toBe(true);
  });

  it('moves scene positions with translate3d without permanently promoting a layer', () => {
    render(<ControlledGarden />);
    const position = screen.getByTestId('garden-companion-position-peach');

    expect(position.style.left).toBe('0px');
    expect(position.style.top).toBe('0px');
    expect(position.style.transform).toContain('translate3d(');
    expect(position.style.transitionProperty).toBe('transform');
    expect(position.style.willChange).toBe('');
  });

  it('renders lossless crops of the two visually distinct historical bag characters', () => {
    render(<ControlledGarden />);
    const first = screen.getByTestId('garden-exact-character-peach');
    const second = screen.getByTestId('garden-exact-character-sage');

    expect(first).toHaveAttribute('viewBox', '0 0 175 185');
    expect(second).toHaveAttribute('viewBox', '0 0 175 185');
    expect(first.querySelector('image')).toHaveAttribute('x', '0');
    expect(second.querySelector('image')).toHaveAttribute('x', '0');
    expect(first.querySelector('image')?.getAttribute('href')).toContain('paper-companion-peach-v1.webp');
    expect(second.querySelector('image')?.getAttribute('href')).toContain('paper-companion-sage-v1.webp');
  });

  it('renders every motion as source-pixel layers instead of line limbs or floating glyphs', () => {
    render(<ControlledGarden />);

    for (const companion of ['peach', 'sage'] as const) {
      const art = screen.getByTestId(`garden-companion-art-${companion}`);
      expect(art).toHaveAttribute('data-motion-state', 'idle');
      expect(art.querySelectorAll('[data-source-pixel="true"]')).toHaveLength(5);
      expect(art.querySelectorAll('.garden-pixel-limb')).toHaveLength(4);
      expect(art.querySelector('.garden-pixel-body')).not.toHaveAttribute('mask');
      expect(art.querySelectorAll('mask')).toHaveLength(0);
      expect(art.querySelectorAll('.garden-limb')).toHaveLength(0);
      expect(art.querySelectorAll('.garden-care-reaction')).toHaveLength(0);
    }
  });

  it('exposes distinct shy and run states after direct care while keeping the pair safe', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');

    fireEvent.click(peach, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '살구 친구 쓰다듬기' }));
    expect(screen.getByTestId('garden-companion-art-peach')).toHaveAttribute('data-motion-state', 'shy');

    act(() => vi.advanceTimersByTime(260));
    expect(screen.getByTestId('garden-companion-art-peach')).toHaveAttribute('data-motion-state', 'run');
    expect(screen.getByTestId('garden-companion-art-peach')).toHaveClass('garden-motion-run');
  });

  it('renders legible 72x76 art with buttons >=44x44 and deterministic limb DOM', () => {
    render(<ControlledGarden />);
    for (const companion of ['peach', 'sage'] as const) {
      const button = screen.getByTestId(`garden-companion-${companion}`);
      expect(button).toHaveClass('min-h-11');
      expect(button).toHaveClass('min-w-11');
      expect(button).toHaveAttribute('aria-describedby', `garden-companion-${companion}-desc`);

      const art = screen.getByTestId(`garden-companion-art-${companion}`);
      expect(art).toHaveClass('garden-companion-art');
      expect(art).toHaveClass('h-[76px]');
      expect(art).toHaveClass('w-[72px]');

      // Four articulated limbs are exact source-pixel fragments.
      expect(screen.getByTestId(`garden-pixel-limb-${companion}-arm-left`)).toBeInTheDocument();
      expect(screen.getByTestId(`garden-pixel-limb-${companion}-arm-right`)).toBeInTheDocument();
      expect(screen.getByTestId(`garden-pixel-limb-${companion}-leg-left`)).toBeInTheDocument();
      expect(screen.getByTestId(`garden-pixel-limb-${companion}-leg-right`)).toBeInTheDocument();

      // No rear/lift sprite-swap frames exist in DOM
      expect(screen.queryByTestId(`garden-character-${companion}-walk`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`garden-character-${companion}-lift`)).not.toBeInTheDocument();
    }
  });

  it('announces touch, lifted, released, and cancelled-before-lift states without false pickup announcements', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '살구 친구와 함께 놀기. 길게 눌러 직접 이동' });
    const liveRegion = screen.getByTestId('garden-live-region');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).toHaveClass('sr-only');
    expect(liveRegion.textContent).toBe('');

    // 1. A quick pointer tap creates the requested shy -> run reaction without
    // pretending that the character was picked up or opening a covering sheet.
    fireEvent.pointerDown(peach, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(150));
    fireEvent.pointerUp(peach, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.click(peach, { detail: 1 });
    expect(peach).toHaveAttribute('data-motion-state', 'shy');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(liveRegion.textContent).toContain('부끄러워서');
    expect(liveRegion.textContent).not.toMatch(/들어 올|내려놓|취소/);
    act(() => vi.advanceTimersByTime(260));
    expect(peach).toHaveAttribute('data-motion-state', 'run');
    act(() => vi.advanceTimersByTime(1_400));

    // 2. Cancelled before lift (movement > 8px before 500ms)
    fireEvent.pointerDown(peach, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(peach, { pointerId: 2, pointerType: 'touch', clientX: 112, clientY: 100 });
    expect(liveRegion.textContent).toContain('취소');

    // 3. Long-press activates pickup -> lifted announcement
    fireEvent.pointerDown(peach, { pointerId: 3, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(peach).toHaveAttribute('data-lifted', 'true');
    expect(liveRegion.textContent).toContain('들어 올렸어요');

    // 4. Pointer release -> released announcement
    fireEvent.pointerUp(peach, { pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 100 });
    expect(liveRegion.textContent).toContain('내려놓았어요');
  });

  it.each(['cap', 'bow', 'scarf', 'flower'] as const)(
    'keeps the exact paper-pair character and visibly overlays the %s accessory',
    (accessory: GardenAccessory) => {
    const accessories: GardenAccessoryState = { version: 1, peach: accessory, sage: 'none' };
    render(<ControlledGarden initial={accessories} />);

    expect(screen.getByTestId('garden-exact-character-peach')).toHaveAttribute('viewBox', '0 0 175 185');
    expect(screen.getByTestId('garden-exact-character-sage')).toHaveAttribute('viewBox', '0 0 175 185');
    expect(screen.getByTestId('garden-exact-character-peach').querySelector('image'))
      .toHaveAttribute('href', expect.stringContaining('paper-companion-peach-v1.webp'));
    expect(screen.getByTestId(`garden-accessory-peach-${accessory}`)).toBeVisible();
    expect(screen.queryByTestId(`garden-accessory-sage-${accessory}`)).not.toBeInTheDocument();
  });

  it.each(['boots', 'sneakers', 'letter', 'dogtag', 'plane'] as const)(
    'renders source-sheet accessory %s with exact source crop on character body',
    (accessory: GardenAccessory) => {
      const accessories: GardenAccessoryState = { version: 1, peach: accessory, sage: 'none' };
      render(<ControlledGarden initial={accessories} />);

      const accessoryArt = screen.getByTestId(`garden-accessory-peach-${accessory}`);
      expect(accessoryArt).toBeVisible();
      expect(accessoryArt.querySelector('image')?.getAttribute('href'))
        .toContain(`paper-accessory-${accessory}-v1.webp`);
      expect(screen.queryByTestId(`garden-accessory-sage-${accessory}`)).not.toBeInTheDocument();
    },
  );

  it('requires a continuous 500ms press, then stays picked up until release', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '살구 친구와 함께 놀기. 길게 눌러 직접 이동' });

    fireEvent.pointerDown(peach, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    expect(peach).toHaveAttribute('data-pressed', 'true');
    expect(peach).toHaveAttribute('data-lifted', 'false');

    act(() => vi.advanceTimersByTime(499));
    expect(peach).toHaveAttribute('data-lifted', 'false');
    act(() => vi.advanceTimersByTime(1));
    expect(peach).toHaveAttribute('data-lifted', 'true');
    expect(peach.className).toContain('garden-companion-lifted');

    fireEvent.pointerUp(peach, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 });
    expect(peach).toHaveAttribute('data-lifted', 'false');
  });

  it('keeps one active pointer pickup and ignores a second pointer', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(peach, { pointerId: 41, pointerType: 'touch', button: 0, clientX: 90, clientY: 450 });
    fireEvent.pointerDown(sage, { pointerId: 42, pointerType: 'touch', button: 0, clientX: 280, clientY: 450 });
    act(() => vi.advanceTimersByTime(500));

    expect(peach).toHaveAttribute('data-pressed', 'true');
    expect(peach).toHaveAttribute('data-lifted', 'true');
    expect(sage).toHaveAttribute('data-pressed', 'false');
    expect(sage).toHaveAttribute('data-lifted', 'false');

    fireEvent.pointerUp(sage, { pointerId: 42, pointerType: 'touch', clientX: 280, clientY: 450 });
    expect(peach).toHaveAttribute('data-lifted', 'true');
    fireEvent.pointerUp(peach, { pointerId: 41, pointerType: 'touch', clientX: 90, clientY: 450 });
    expect(peach).toHaveAttribute('data-lifted', 'false');
  });

  it('does not cancel a primary hold when an ignored pointer loses capture on the same companion', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');

    fireEvent.pointerDown(peach, {
      pointerId: 71,
      pointerType: 'touch',
      button: 0,
      clientX: 90,
      clientY: 450,
    });
    fireEvent.pointerDown(peach, {
      pointerId: 72,
      pointerType: 'touch',
      button: 0,
      clientX: 92,
      clientY: 452,
    });
    fireEvent.lostPointerCapture(peach, { pointerId: 72, pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(500));

    expect(peach).toHaveAttribute('data-lifted', 'true');
    fireEvent.pointerUp(peach, { pointerId: 71, pointerType: 'touch', clientX: 90, clientY: 450 });
    expect(peach).toHaveAttribute('data-lifted', 'false');
  });

  it.each(['touch', 'pen'] as const)(
    'consumes the delayed compatibility click from an ignored second %s pointer without sticking',
    (secondPointerType) => {
      vi.useFakeTimers();
      render(<ControlledGarden />);
      const peach = screen.getByTestId('garden-companion-peach');
      const sage = screen.getByTestId('garden-companion-sage');

      fireEvent.pointerDown(peach, { pointerId: 51, pointerType: 'touch', button: 0, clientX: 90, clientY: 450 });
      fireEvent.pointerDown(sage, { pointerId: 52, pointerType: secondPointerType, button: 0, clientX: 280, clientY: 450 });
      fireEvent.pointerUp(peach, { pointerId: 51, pointerType: 'touch', clientX: 90, clientY: 450 });
      fireEvent.pointerUp(sage, { pointerId: 52, pointerType: secondPointerType, clientX: 280, clientY: 450 });
      act(() => vi.advanceTimersByTime(200));
      fireEvent.click(sage, { detail: 1 });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.pointerDown(sage, { pointerId: 53, pointerType: secondPointerType, button: 0, clientX: 280, clientY: 450 });
      fireEvent.pointerUp(sage, { pointerId: 53, pointerType: secondPointerType, clientX: 280, clientY: 450 });
      fireEvent.click(sage, { detail: 1 });
      expect(sage).toHaveAttribute('data-motion-state', 'shy');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('keeps an assistive detail-zero activation available while an ignored touch click is pending', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(peach, { pointerId: 61, pointerType: 'touch', button: 0, clientX: 90, clientY: 450 });
    fireEvent.pointerDown(sage, { pointerId: 62, pointerType: 'touch', button: 0, clientX: 280, clientY: 450 });
    fireEvent.pointerUp(peach, { pointerId: 61, pointerType: 'touch', clientX: 90, clientY: 450 });
    fireEvent.pointerUp(sage, { pointerId: 62, pointerType: 'touch', clientX: 280, clientY: 450 });
    fireEvent.click(sage, { detail: 0 });

    expect(screen.getByRole('dialog', { name: '초록 친구와 함께 놀기' })).toBeInTheDocument();
  });

  it('reacts shyly and runs after a quick pointer tap without covering the character', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(sage, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(sage, { pointerId: 2, pointerType: 'mouse', clientX: 100, clientY: 100 });
    fireEvent.click(sage, { detail: 1 });

    expect(sage).toHaveAttribute('data-lifted', 'false');
    expect(sage).toHaveAttribute('data-motion-state', 'shy');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('garden-live-region')).toHaveTextContent('초록 친구가 부끄러워서');
    act(() => vi.advanceTimersByTime(260));
    expect(sage).toHaveAttribute('data-motion-state', 'run');
  });

  it('cancels a pre-activation pickup after movement without opening the action sheet', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(sage, { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(sage, { pointerId: 3, pointerType: 'mouse', clientX: 110, clientY: 100 });
    act(() => vi.advanceTimersByTime(50));
    fireEvent.pointerUp(sage, { pointerId: 3, pointerType: 'mouse', clientX: 110, clientY: 100 });
    fireEvent.click(sage, { detail: 1 });
    act(() => vi.advanceTimersByTime(500));

    expect(sage).toHaveAttribute('data-lifted', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the next deliberate tap react when a moved gesture produced no click', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(sage, { pointerId: 31, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(sage, { pointerId: 31, pointerType: 'touch', clientX: 112, clientY: 100 });
    fireEvent.pointerUp(sage, { pointerId: 31, pointerType: 'touch', clientX: 112, clientY: 100 });

    fireEvent.pointerDown(sage, { pointerId: 32, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(sage, { pointerId: 32, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.click(sage, { detail: 1 });

    expect(sage).toHaveAttribute('data-motion-state', 'shy');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels a pre-activation pickup on pointercancel and clears its timer', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByRole('button', { name: '초록 친구와 함께 놀기. 길게 눌러 직접 이동' });

    fireEvent.pointerDown(sage, { pointerId: 5, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    expect(sage).toHaveAttribute('data-pressed', 'true');
    fireEvent.pointerCancel(sage, { pointerId: 5, pointerType: 'touch', clientX: 100, clientY: 100 });

    expect(sage).toHaveAttribute('data-pressed', 'false');
    expect(sage).toHaveAttribute('data-lifted', 'false');
    act(() => vi.advanceTimersByTime(600));
    expect(sage).toHaveAttribute('data-lifted', 'false');
  });

  it('cancels an activated pickup on pointercancel and clears its lifted state', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '살구 친구와 함께 놀기. 길게 눌러 직접 이동' });

    fireEvent.pointerDown(peach, { pointerId: 6, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(peach).toHaveAttribute('data-pressed', 'true');
    expect(peach).toHaveAttribute('data-lifted', 'true');

    fireEvent.pointerCancel(peach, { pointerId: 6, pointerType: 'touch', clientX: 100, clientY: 100 });

    expect(peach).toHaveAttribute('data-pressed', 'false');
    expect(peach).toHaveAttribute('data-lifted', 'false');
    act(() => vi.advanceTimersByTime(1_000));
    expect(peach).toHaveAttribute('data-lifted', 'false');
  });

  it('drags a picked companion within the full scene and releases it safely', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 600, width: 300, height: 600,
      toJSON: () => ({}),
    });
    const peach = screen.getByRole('button', { name: '살구 친구와 함께 놀기. 길게 눌러 직접 이동' });
    const before = [peach.getAttribute('data-x'), peach.getAttribute('data-y')];

    fireEvent.pointerDown(peach, { pointerId: 4, pointerType: 'mouse', button: 0, clientX: 90, clientY: 450 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(peach, { pointerId: 4, pointerType: 'mouse', clientX: 230, clientY: 420 });

    expect([peach.getAttribute('data-x'), peach.getAttribute('data-y')]).not.toEqual(before);
    expect(Number(peach.getAttribute('data-x'))).toBeGreaterThanOrEqual(GARDEN_BOUNDS.minX);
    expect(Number(peach.getAttribute('data-x'))).toBeLessThanOrEqual(GARDEN_BOUNDS.maxX);
    expect(Number(peach.getAttribute('data-y'))).toBeGreaterThanOrEqual(28);
    expect(Number(peach.getAttribute('data-y'))).toBeLessThanOrEqual(94);

    fireEvent.pointerUp(peach, { pointerId: 4, pointerType: 'mouse', clientX: 230, clientY: 420 });
    expect(peach).toHaveAttribute('data-lifted', 'false');
  });

  it('uses the same physical-safe horizontal bounds when dragged to either scene edge', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 600, width: 320, height: 600,
      toJSON: () => ({}),
    });
    const peach = screen.getByRole('button', { name: '살구 친구와 함께 놀기. 길게 눌러 직접 이동' });
    const sage = screen.getByRole('button', { name: '초록 친구와 함께 놀기. 길게 눌러 직접 이동' });

    fireEvent.pointerDown(peach, { pointerId: 7, pointerType: 'touch', button: 0, clientX: 160, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(peach, { pointerId: 7, pointerType: 'touch', clientX: 0, clientY: 100 });
    expect(Number(peach.getAttribute('data-x'))).toBe(GARDEN_BOUNDS.minX);
    fireEvent.pointerUp(peach, { pointerId: 7, pointerType: 'touch', clientX: 0, clientY: 100 });

    fireEvent.pointerDown(sage, { pointerId: 8, pointerType: 'touch', button: 0, clientX: 160, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(sage, { pointerId: 8, pointerType: 'touch', clientX: 320, clientY: 100 });
    expect(Number(sage.getAttribute('data-x'))).toBe(GARDEN_BOUNDS.maxX);
    fireEvent.pointerUp(sage, { pointerId: 8, pointerType: 'touch', clientX: 320, clientY: 100 });
  });

  it('maps pointer drag coordinates through the inner scene box instead of its border box', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    gardenLayout.scene = rect(10, 20, 340, 640);
    gardenLayout.sceneBorder = { left: 10, top: 20, right: 10, bottom: 20 };
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');

    // Inner scene: left 20, top 40, 320×600. This pointer is exactly (20%, 80%).
    fireEvent.pointerDown(peach, {
      pointerId: 70,
      pointerType: 'touch',
      button: 0,
      clientX: 84,
      clientY: 520,
    });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(peach, {
      pointerId: 70,
      pointerType: 'touch',
      clientX: 84,
      clientY: 520,
    });

    expect(Number(peach.getAttribute('data-x'))).toBeCloseTo(20, 2);
    expect(Number(peach.getAttribute('data-y'))).toBeCloseTo(80, 2);
    fireEvent.pointerUp(peach, {
      pointerId: 70,
      pointerType: 'touch',
      clientX: 84,
      clientY: 520,
    });
  });

  it('keeps dragged companions from stacking on the other rendered sprite', () => {
    // This test owns the drag constraint; disable autonomous timers so wandering
    // cannot race the explicit pointer move and make the assertion flaky.
    mockReducedMotion(true);
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 375, bottom: 602, width: 375, height: 602,
      toJSON: () => ({}),
    });
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(peach, { pointerId: 8, pointerType: 'touch', button: 0, clientX: 100, clientY: 450 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(peach, { pointerId: 8, pointerType: 'touch', clientX: 277, clientY: 444 });

    const bounds = getPhysicalGardenBounds(375, 600);
    const peachPoint = {
      x: Number(peach.getAttribute('data-x')),
      y: Number(peach.getAttribute('data-y')),
    };
    const sagePoint = {
      x: Number(sage.getAttribute('data-x')),
      y: Number(sage.getAttribute('data-y')),
    };
    expect(companionsOverlap(peachPoint, sagePoint, { width: 375, height: 600 }, GARDEN_COMPANION_SIZE.gap)).toBe(false);
    expect(peachPoint.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(peachPoint.x).toBeLessThanOrEqual(bounds.maxX);
    fireEvent.pointerUp(peach, { pointerId: 8, pointerType: 'touch', clientX: 277, clientY: 444 });
  });

  it('keeps a drag-to-other request separated in a short 430x180 scene', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 430, bottom: 180, width: 430, height: 180,
      toJSON: () => ({}),
    });
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(peach, { pointerId: 13, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(peach, { pointerId: 13, pointerType: 'touch', clientX: 318.2, clientY: 133.2 });

    const peachPoint = {
      x: Number(peach.getAttribute('data-x')),
      y: Number(peach.getAttribute('data-y')),
    };
    const sagePoint = {
      x: Number(sage.getAttribute('data-x')),
      y: Number(sage.getAttribute('data-y')),
    };
    expect(companionsOverlap(peachPoint, sagePoint, { width: 430, height: 180 }, GARDEN_COMPANION_SIZE.gap)).toBe(false);
    fireEvent.pointerUp(peach, { pointerId: 13, pointerType: 'touch', clientX: 318.2, clientY: 133.2 });
  });

  it('clips a large drag delta before it can cross through the other companion', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 320, 600));
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(peach, { pointerId: 43, pointerType: 'touch', button: 0, clientX: 83, clientY: 468 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(peach, { pointerId: 43, pointerType: 'touch', clientX: 310, clientY: 468 });

    const peachX = Number(peach.getAttribute('data-x'));
    const sageX = Number(sage.getAttribute('data-x'));
    expect(peachX).toBeGreaterThan(26);
    expect(peachX).toBeLessThan(sageX);
    expect(companionsOverlap(
      { x: peachX, y: Number(peach.getAttribute('data-y')) },
      { x: sageX, y: Number(sage.getAttribute('data-y')) },
      { width: 320, height: 600 },
    )).toBe(false);
    fireEvent.pointerUp(peach, { pointerId: 43, pointerType: 'touch', clientX: 310, clientY: 468 });
  });

  it('freezes the rendered position before a long press interrupts wandering', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 375, bottom: 602, width: 375, height: 602,
      toJSON: () => ({}),
    });
    const position = screen.getByTestId('garden-companion-position-peach');
    vi.spyOn(position, 'getBoundingClientRect').mockReturnValue({
      x: 41, y: 180, left: 41, top: 180, right: 139, bottom: 292, width: 98, height: 112,
      toJSON: () => ({}),
    });
    const peach = screen.getByTestId('garden-companion-peach');
    expect(scene.clientHeight).toBe(600);
    expect(scene.clientTop).toBe(1);

    fireEvent.pointerDown(peach, { pointerId: 9, pointerType: 'touch', button: 0, clientX: 90, clientY: 240 });

    expect(Number(peach.getAttribute('data-x'))).toBeCloseTo((41 + 49) / 375 * 100, 2);
    expect(Number(peach.getAttribute('data-y'))).toBeCloseTo((292 - 1) / 600 * 100, 2);
    fireEvent.pointerUp(peach, { pointerId: 9, pointerType: 'touch', clientX: 90, clientY: 240 });
  });

  it.each(['Enter', ' '])('keyboard %s activation opens the same action sheet', (key) => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    peach.focus();
    fireEvent.keyDown(peach, { key });

    expect(peach).toHaveAttribute('data-lifted', 'false');
    expect(screen.getByRole('dialog', { name: '살구 친구와 함께 놀기' })).toBeInTheDocument();
  });

  it('ignores held-key repeats instead of reopening the action sheet', () => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    peach.focus();

    fireEvent.keyDown(peach, { key: 'Enter', repeat: false });
    const dialog = screen.getByRole('dialog', { name: '살구 친구와 함께 놀기' });
    fireEvent.keyDown(peach, { key: 'Enter', repeat: true });

    expect(screen.getAllByRole('dialog')).toEqual([dialog]);
  });

  it('supports an assistive semantic detail-zero click through the same action sheet', () => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');

    fireEvent.click(peach, { detail: 0 });

    expect(peach).toHaveAttribute('data-lifted', 'false');
    expect(screen.getByRole('dialog', { name: '살구 친구와 함께 놀기' })).toBeInTheDocument();
  });

  it('does not open the action sheet after a completed long-press pickup', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');

    fireEvent.pointerDown(peach, { pointerId: 10, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(peach).toHaveAttribute('data-lifted', 'true');
    fireEvent.pointerUp(peach, { pointerId: 10, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.click(peach, { detail: 1 });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves in all four directions, stays bounded and non-overlapping, and announces the result', () => {
    mockReducedMotion(true);
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.click(peach, { detail: 0 });
    const actions = [
      { label: '위쪽', axis: 'y', compare: (next: number, prior: number) => next < prior },
      { label: '아래쪽', axis: 'y', compare: (next: number, prior: number) => next > prior },
      { label: '왼쪽', axis: 'x', compare: (next: number, prior: number) => next < prior },
      { label: '오른쪽', axis: 'x', compare: (next: number, prior: number) => next > prior },
    ] as const;
    for (const action of actions) {
      const prior = Number(peach.getAttribute(`data-${action.axis}`));
      fireEvent.click(screen.getByRole('button', { name: `살구 친구 ${action.label}으로 이동` }));
      const next = Number(peach.getAttribute(`data-${action.axis}`));
      expect(action.compare(next, prior)).toBe(true);
      expect(screen.getByRole('status')).toHaveTextContent(`살구 친구를 ${action.label}으로 옮겼어요.`);
    }

    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: '살구 친구 오른쪽으로 이동' }));
    }
    const peachPoint = {
      x: Number(peach.getAttribute('data-x')),
      y: Number(peach.getAttribute('data-y')),
    };
    const sagePoint = {
      x: Number(sage.getAttribute('data-x')),
      y: Number(sage.getAttribute('data-y')),
    };
    expect(peachPoint.x).toBeGreaterThanOrEqual(GARDEN_BOUNDS.minX);
    expect(peachPoint.x).toBeLessThanOrEqual(GARDEN_BOUNDS.maxX);
    expect(peachPoint.x).toBeLessThan(sagePoint.x);
    expect(companionsOverlap(peachPoint, sagePoint, { width: 320, height: 600 }, GARDEN_COMPANION_SIZE.gap)).toBe(false);
  });

  it('revalidates rapid directional moves and a companion switch from both rendered positions', () => {
    gardenLayout.scene = rect(0, 0, 375, 602);
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.click(peach, { detail: 0 });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: '살구 친구 오른쪽으로 이동' }));
    }
    fireEvent.click(screen.getByRole('button', { name: '살구 친구 위쪽으로 이동' }));
    fireEvent.click(screen.getByRole('button', { name: '살구 친구 위쪽으로 이동' }));
    const stagedPeach = {
      x: Number(peach.getAttribute('data-x')),
      y: Number(peach.getAttribute('data-y')),
    };
    expect(stagedPeach.x).toBeGreaterThan(50);
    expect(stagedPeach.x).toBeLessThan(58);
    expect(stagedPeach.y).toBe(52);

    // Reviewer path: the state target has already been clipped for the larger
    // sprite, but CSS is still rendered lower on the way from its prior point.
    // A rapid right move must revalidate from that rendered position rather than
    // cutting diagonally through the other companion.
    const scene = gardenLayout.scene;
    vi.spyOn(screen.getByTestId('garden-companion-position-peach'), 'getBoundingClientRect')
      .mockReturnValue(rectForGardenPoint({ x: stagedPeach.x, y: 70 }, scene));
    vi.spyOn(screen.getByTestId('garden-companion-position-sage'), 'getBoundingClientRect')
      .mockReturnValue(rectForGardenPoint({ x: 74, y: 74 }, scene));

    fireEvent.click(screen.getByRole('button', { name: '살구 친구 오른쪽으로 이동' }));
    const peachAfterRapidMove = {
      x: Number(peach.getAttribute('data-x')),
      y: Number(peach.getAttribute('data-y')),
    };
    expect(peachAfterRapidMove.x).toBeLessThan(66);
    expect(peachAfterRapidMove.y).toBe(70);
    expect(companionsOverlap(
      peachAfterRapidMove,
      { x: 74, y: 74 },
      { width: 375, height: 600 },
      GARDEN_COMPANION_SIZE.gap,
    )).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '초록 친구', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '초록 친구 왼쪽으로 이동' }));
    expect(Number(sage.getAttribute('data-x'))).toBeGreaterThan(66);
    expect(companionsOverlap(
      { x: Number(peach.getAttribute('data-x')), y: Number(peach.getAttribute('data-y')) },
      { x: Number(sage.getAttribute('data-x')), y: Number(sage.getAttribute('data-y')) },
      { width: 375, height: 600 },
      GARDEN_COMPANION_SIZE.gap,
    )).toBe(false);
  });

  it('names the modal, closes it with Escape, and restores focus to its trigger', () => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    peach.focus();

    fireEvent.click(peach, { detail: 0 });
    const dialog = screen.getByRole('dialog', { name: '살구 친구와 함께 놀기' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(peach).toHaveFocus();
  });

  it('pauses both autonomous companions while the action sheet is open and resumes after it closes', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.click(peach, { detail: 0 });
    act(() => vi.advanceTimersByTime(20_000));

    expect(peach).toHaveAttribute('data-move-count', '0');
    expect(sage).toHaveAttribute('data-move-count', '0');
    expect(peach).toHaveAttribute('data-wandering', 'false');
    expect(sage).toHaveAttribute('data-wandering', 'false');
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: '살구 친구와 함께 놀기 닫기' }));
    act(() => vi.advanceTimersByTime(1_999));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(0);
    act(() => vi.advanceTimersByTime(5_000));

    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(1);
  });

  it('clears pickup state when availability is withdrawn and restored', () => {
    vi.useFakeTimers();
    const view = render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '살구 친구와 함께 놀기. 길게 눌러 직접 이동' });

    fireEvent.pointerDown(peach, { pointerId: 11, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    view.rerender(
      <CompanionGardenView
        state={{ ...AVAILABLE, isAvailable: false }}
        accessories={DEFAULT_ACCESSORIES}
      />,
    );
    act(() => vi.advanceTimersByTime(600));
    view.rerender(<ControlledGarden />);

    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-lifted', 'false');
    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-pressed', 'false');
  });

  it('ends pickup when pointer capture is lost', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');

    fireEvent.pointerDown(peach, { pointerId: 12, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(peach).toHaveAttribute('data-lifted', 'true');
    fireEvent.lostPointerCapture(peach, { pointerId: 12, pointerType: 'touch' });

    expect(peach).toHaveAttribute('data-lifted', 'false');
    expect(peach).toHaveAttribute('data-pressed', 'false');
  });

  it('observes live geometry and atomically separates the pair after resize and orientation changes', () => {
    const resizeObserver = installResizeObserverMock();
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sceneNode = screen.getByTestId('garden-scene');
    const peachPosition = screen.getByTestId('garden-companion-position-peach');
    const sagePosition = screen.getByTestId('garden-companion-position-sage');
    const landscapeScene = rect(0, 0, 430, 182);
    gardenLayout.scene = landscapeScene;
    vi.spyOn(sceneNode, 'getBoundingClientRect').mockReturnValue(landscapeScene);
    vi.spyOn(peachPosition, 'getBoundingClientRect').mockReturnValue(rectForGardenPoint({ x: 50, y: 74 }, landscapeScene, 47, 55));
    vi.spyOn(sagePosition, 'getBoundingClientRect').mockReturnValue(rectForGardenPoint({ x: 50, y: 74 }, landscapeScene, 51, 57));

    expect(resizeObserver.instances.some((instance) => (
      !instance.disconnected
      && instance.observed.has(sceneNode)
      && instance.observed.has(peachPosition)
      && instance.observed.has(sagePosition)
    ))).toBe(true);

    act(() => resizeObserver.trigger(sceneNode));
    let peachPoint = {
      x: Number(screen.getByTestId('garden-companion-peach').getAttribute('data-x')),
      y: Number(screen.getByTestId('garden-companion-peach').getAttribute('data-y')),
    };
    let sagePoint = {
      x: Number(screen.getByTestId('garden-companion-sage').getAttribute('data-x')),
      y: Number(screen.getByTestId('garden-companion-sage').getAttribute('data-y')),
    };
    expect(companionsOverlap(
      peachPoint,
      sagePoint,
      { width: 430, height: 180 },
      GARDEN_COMPANION_SIZE.gap,
      { width: 47, height: 55 },
      { width: 51, height: 57 },
    )).toBe(false);
    expect(peachPoint).not.toEqual({ x: 26, y: 78 });

    act(() => window.dispatchEvent(new Event('resize')));
    act(() => window.dispatchEvent(new Event('orientationchange')));
    peachPoint = {
      x: Number(screen.getByTestId('garden-companion-peach').getAttribute('data-x')),
      y: Number(screen.getByTestId('garden-companion-peach').getAttribute('data-y')),
    };
    sagePoint = {
      x: Number(screen.getByTestId('garden-companion-sage').getAttribute('data-x')),
      y: Number(screen.getByTestId('garden-companion-sage').getAttribute('data-y')),
    };
    expect(companionsOverlap(
      peachPoint,
      sagePoint,
      { width: 430, height: 180 },
      GARDEN_COMPANION_SIZE.gap,
      { width: 47, height: 55 },
      { width: 51, height: 57 },
    )).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps both rendered Y anchors invariant across repeated unchanged resize freezes and horizontal moves', () => {
    const resizeObserver = installResizeObserverMock();
    mockReducedMotion(true);
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');
    const peachPosition = screen.getByTestId('garden-companion-position-peach');
    const sagePosition = screen.getByTestId('garden-companion-position-sage');
    const before = {
      peachDataY: Number(peach.getAttribute('data-y')),
      sageDataY: Number(sage.getAttribute('data-y')),
      peachBottom: peachPosition.getBoundingClientRect().bottom,
      sageBottom: sagePosition.getBoundingClientRect().bottom,
    };

    for (let event = 0; event < 10; event += 1) {
      act(() => resizeObserver.trigger(scene));
    }

    expect(Number(peach.getAttribute('data-y'))).toBeCloseTo(before.peachDataY, 6);
    expect(Number(sage.getAttribute('data-y'))).toBeCloseTo(before.sageDataY, 6);
    expect(peachPosition.getBoundingClientRect().bottom).toBeCloseTo(before.peachBottom, 6);
    expect(sagePosition.getBoundingClientRect().bottom).toBeCloseTo(before.sageBottom, 6);

    fireEvent.click(peach, { detail: 0 });
    for (let move = 0; move < 5; move += 1) {
      fireEvent.click(screen.getByRole('button', { name: '살구 친구 오른쪽으로 이동' }));
      fireEvent.click(screen.getByRole('button', { name: '살구 친구 왼쪽으로 이동' }));
    }
    fireEvent.click(screen.getByRole('button', { name: '초록 친구', exact: true }));
    for (let move = 0; move < 5; move += 1) {
      fireEvent.click(screen.getByRole('button', { name: '초록 친구 왼쪽으로 이동' }));
      fireEvent.click(screen.getByRole('button', { name: '초록 친구 오른쪽으로 이동' }));
    }

    expect(Number(peach.getAttribute('data-y'))).toBeCloseTo(before.peachDataY, 6);
    expect(Number(sage.getAttribute('data-y'))).toBeCloseTo(before.sageDataY, 6);
    expect(peachPosition.getBoundingClientRect().bottom).toBeCloseTo(before.peachBottom, 6);
    expect(sagePosition.getBoundingClientRect().bottom).toBeCloseTo(before.sageBottom, 6);
  });

  it('freezes rendered positions while hidden and starts a fresh idle after becoming visible', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);
    const sceneNode = screen.getByTestId('garden-scene');
    const scene = rect(0, 0, 375, 602);
    gardenLayout.scene = scene;
    vi.spyOn(sceneNode, 'getBoundingClientRect').mockReturnValue(scene);
    vi.spyOn(screen.getByTestId('garden-companion-position-peach'), 'getBoundingClientRect')
      .mockReturnValue(rectForGardenPoint({ x: 35, y: 70 }, scene));
    vi.spyOn(screen.getByTestId('garden-companion-position-sage'), 'getBoundingClientRect')
      .mockReturnValue(rectForGardenPoint({ x: 70, y: 72 }, scene));

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-x', '35.00');
    expect(screen.getByTestId('garden-companion-sage')).toHaveAttribute('data-x', '70.00');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-move-count', '0');
    expect(screen.getByTestId('garden-companion-sage')).toHaveAttribute('data-move-count', '0');

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-move-count', '0');
    expect(screen.getByTestId('garden-companion-sage')).toHaveAttribute('data-move-count', '0');
    act(() => vi.advanceTimersByTime(2_000));
    expect(
      Number(screen.getByTestId('garden-companion-peach').getAttribute('data-move-count'))
      + Number(screen.getByTestId('garden-companion-sage').getAttribute('data-move-count')),
    ).toBe(1);
  });

  it('cleans scheduler, visibility, resize, and orientation resources across StrictMode remounts', () => {
    const resizeObserver = installResizeObserverMock();
    const reducedMotion = mockReducedMotion(false);
    vi.useFakeTimers();
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const view = render(<StrictMode><ControlledGarden /></StrictMode>);

    expect(vi.getTimerCount()).toBe(1);
    expect(resizeObserver.instances.filter((instance) => !instance.disconnected)).toHaveLength(1);
    expect(documentAdd.mock.calls.filter(([type]) => type === 'visibilitychange').length).toBeGreaterThan(0);
    expect(windowAdd.mock.calls.filter(([type]) => type === 'resize').length).toBeGreaterThan(0);
    expect(windowAdd.mock.calls.filter(([type]) => type === 'orientationchange').length).toBeGreaterThan(0);
    expect(reducedMotion.listenerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(resizeObserver.instances.every((instance) => instance.disconnected)).toBe(true);
    expect(reducedMotion.listenerCount()).toBe(0);
    expect(documentRemove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(
      documentAdd.mock.calls.filter(([type]) => type === 'visibilitychange').length,
    );
    expect(windowRemove.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(
      windowAdd.mock.calls.filter(([type]) => type === 'resize').length,
    );
    expect(windowRemove.mock.calls.filter(([type]) => type === 'orientationchange')).toHaveLength(
      windowAdd.mock.calls.filter(([type]) => type === 'orientationchange').length,
    );
  });
});

describe('garden availability announcements', () => {
  it('announces shared-workspace checking immediately without deferring the live message', () => {
    render(
      <CompanionGardenView
        state={{ ...AVAILABLE, isAvailable: false }}
        unavailableReason="shared_unavailable"
      />,
    );

    const status = screen.getByRole('status');
    expect(screen.getByRole('region', { name: '정원 확인 중' })).toContainElement(status);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).not.toHaveAttribute('aria-busy');
  });

  it('announces a settled unavailable reason without claiming work is still busy', () => {
    render(
      <CompanionGardenView
        state={{ ...AVAILABLE, isAvailable: false }}
        unavailableReason="inactive_couple"
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('커플 연결이 확인되면 정원이 자라기 시작해요.');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).not.toHaveAttribute('aria-busy');
  });
});

describe('autonomous companion wandering', () => {
  it('keeps invalid rendered geometry stopped and starts a full idle only after valid recovery', () => {
    const resizeObserver = installResizeObserverMock();
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    gardenLayout.scene = rect(0, 0, 0, 0);
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(0);

    gardenLayout.scene = rect(0, 0, 40, 42);
    act(() => resizeObserver.trigger(scene));
    expect(vi.getTimerCount()).toBe(0);

    gardenLayout.scene = rect(0, 0, 375, 602);
    gardenLayout.points.peach = { x: Number.NaN, y: 78 };
    act(() => resizeObserver.trigger(scene));
    expect(vi.getTimerCount()).toBe(0);

    gardenLayout.points = {};
    act(() => resizeObserver.trigger(scene));
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1_999));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(1);
  });

  it('does not busy-retry when valid pair geometry has no safe autonomous destination', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    gardenLayout.scene = rect(0, 0, 160, 100);
    gardenLayout.points = { peach: { x: 26, y: 80 }, sage: { x: 74, y: 80 } };
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(2_000));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(0);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    act(() => vi.advanceTimersByTime(1_999));
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(0);
  });

  it('runs the actual React scheduler for a seeded 60s with one timer and low pair duty', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(0xd2c0ffee));
    gardenLayout.scene = rect(0, 0, 375, 602);
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');
    const movers: Array<'peach' | 'sage'> = [];
    const previousCounts = { peach: 0, sage: 0 };
    let movingTicks = 0;

    for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
      act(() => vi.advanceTimersByTime(100));
      const counts = {
        peach: Number(peach.getAttribute('data-move-count')),
        sage: Number(sage.getAttribute('data-move-count')),
      };
      for (const id of ['peach', 'sage'] as const) {
        if (counts[id] > previousCounts[id]) movers.push(id);
        previousCounts[id] = counts[id];
      }
      const movingCount = [peach, sage]
        .filter((node) => node.getAttribute('data-wandering') === 'true').length;
      expect(movingCount).toBeLessThanOrEqual(1);
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
      if (movingCount === 1) movingTicks += 1;
    }

    expect(movers.length).toBeLessThanOrEqual(12);
    expect(previousCounts.peach).toBeGreaterThanOrEqual(1);
    expect(previousCounts.sage).toBeGreaterThanOrEqual(1);
    expect(movingTicks * 100 / 60_000).toBeLessThanOrEqual(0.45);
    let streak = 0;
    let prior: 'peach' | 'sage' | null = null;
    for (const mover of movers) {
      streak = mover === prior ? streak + 1 : 1;
      expect(streak).toBeLessThanOrEqual(2);
      prior = mover;
    }
  });

  it('uses one scheduler timer and never moves both companions at once', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);

    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');
    expect(peach).toHaveAttribute('data-move-count', '0');
    expect(sage).toHaveAttribute('data-move-count', '0');
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(3_500));

    const moving = [peach, sage].filter((node) => node.getAttribute('data-wandering') === 'true');
    expect(moving).toHaveLength(1);
    expect(Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count'))).toBe(1);
    expect(companionsOverlap(
      { x: Number(peach.getAttribute('data-x')), y: Number(peach.getAttribute('data-y')) },
      { x: Number(sage.getAttribute('data-x')), y: Number(sage.getAttribute('data-y')) },
      { width: 320, height: 600 },
    )).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('respects prefers-reduced-motion by keeping both companions stationary', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    act(() => vi.advanceTimersByTime(20_000));

    expect(peach).toHaveAttribute('data-move-count', '0');
    expect(sage).toHaveAttribute('data-move-count', '0');
    expect(peach).toHaveAttribute('data-wandering', 'false');
    expect(sage).toHaveAttribute('data-wandering', 'false');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps touch and care reactions spatially stationary when reduced motion is requested', () => {
    mockReducedMotion(true);
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const before = {
      x: peach.getAttribute('data-x'),
      y: peach.getAttribute('data-y'),
      moves: peach.getAttribute('data-move-count'),
    };

    fireEvent.click(peach, { detail: 1 });
    expect(peach).toHaveAttribute('data-motion-state', 'shy');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_600));
    expect(peach).toHaveAttribute('data-motion-state', 'idle');
    expect(peach).toHaveAttribute('data-x', before.x);
    expect(peach).toHaveAttribute('data-y', before.y);
    expect(peach).toHaveAttribute('data-move-count', before.moves);

    fireEvent.click(peach, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '살구 친구 쓰다듬기' }));
    expect(peach).toHaveAttribute('data-motion-state', 'shy');
    act(() => vi.advanceTimersByTime(1_600));
    expect(peach).toHaveAttribute('data-motion-state', 'idle');
    expect(peach).toHaveAttribute('data-x', before.x);
    expect(peach).toHaveAttribute('data-y', before.y);
    expect(peach).toHaveAttribute('data-move-count', before.moves);
  });

  it('cancels a pending direct-touch run when reduced motion turns on during the shy pose', () => {
    const reducedMotion = mockReducedMotion(false);
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const before = {
      x: peach.getAttribute('data-x'),
      y: peach.getAttribute('data-y'),
      moves: peach.getAttribute('data-move-count'),
    };

    fireEvent.click(peach, { detail: 1 });
    expect(peach).toHaveAttribute('data-motion-state', 'shy');

    act(() => reducedMotion.set(true));
    act(() => vi.advanceTimersByTime(2_000));

    expect(peach).toHaveAttribute('data-motion-state', 'idle');
    expect(peach).toHaveAttribute('data-x', before.x);
    expect(peach).toHaveAttribute('data-y', before.y);
    expect(peach).toHaveAttribute('data-move-count', before.moves);
  });

  it('cancels a pending care run when reduced motion turns on during the shy pose', () => {
    const reducedMotion = mockReducedMotion(false);
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const before = {
      x: peach.getAttribute('data-x'),
      y: peach.getAttribute('data-y'),
      moves: peach.getAttribute('data-move-count'),
    };

    fireEvent.click(peach, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: '살구 친구 쓰다듬기' }));
    expect(peach).toHaveAttribute('data-motion-state', 'shy');

    act(() => reducedMotion.set(true));
    act(() => vi.advanceTimersByTime(2_000));

    expect(peach).toHaveAttribute('data-motion-state', 'idle');
    expect(peach).toHaveAttribute('data-care-reaction', 'none');
    expect(peach).toHaveAttribute('data-x', before.x);
    expect(peach).toHaveAttribute('data-y', before.y);
    expect(peach).toHaveAttribute('data-move-count', before.moves);
  });

  it('dynamically freezes at rendered positions when reduced motion turns on and keeps direct actions usable', () => {
    const reducedMotion = mockReducedMotion(false);
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);
    const sceneNode = screen.getByTestId('garden-scene');
    const scene = rect(0, 0, 375, 602);
    gardenLayout.scene = scene;
    vi.spyOn(sceneNode, 'getBoundingClientRect').mockReturnValue(scene);
    vi.spyOn(screen.getByTestId('garden-companion-position-peach'), 'getBoundingClientRect')
      .mockReturnValue(rectForGardenPoint({ x: 35, y: 70 }, scene));
    vi.spyOn(screen.getByTestId('garden-companion-position-sage'), 'getBoundingClientRect')
      .mockReturnValue(rectForGardenPoint({ x: 70, y: 72 }, scene));

    act(() => vi.advanceTimersByTime(3_500));
    const movesBefore = Number(screen.getByTestId('garden-companion-peach').getAttribute('data-move-count'))
      + Number(screen.getByTestId('garden-companion-sage').getAttribute('data-move-count'));
    expect(movesBefore).toBe(1);

    act(() => reducedMotion.set(true));

    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');
    expect(peach).toHaveAttribute('data-x', '35.00');
    expect(sage).toHaveAttribute('data-x', '70.00');
    expect(peach).toHaveAttribute('data-wandering', 'false');
    expect(sage).toHaveAttribute('data-wandering', 'false');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(30_000));
    expect(
      Number(peach.getAttribute('data-move-count')) + Number(sage.getAttribute('data-move-count')),
    ).toBe(movesBefore);

   fireEvent.click(peach, { detail: 0 });
   const beforeMove = Number(peach.getAttribute('data-x'));
   fireEvent.click(screen.getByRole('button', { name: '살구 친구 왼쪽으로 이동' }));
   expect(Number(peach.getAttribute('data-x'))).toBeLessThan(beforeMove);
 });

  it('seeds lifted portrait initial coordinates on first valid portrait scene and preserves short landscape seeds', () => {
    // Portrait scene: 375x812
    gardenLayout.scene = rect(0, 0, 375, 814);
    const view = render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');

    expect(Number(peach.getAttribute('data-x'))).toBeCloseTo(26, 1);
    expect(Number(peach.getAttribute('data-y'))).toBeCloseTo(68, 1);
    expect(Number(sage.getAttribute('data-x'))).toBeCloseTo(74, 1);
    expect(Number(sage.getAttribute('data-y'))).toBeCloseTo(65, 1);

    view.unmount();

    // Short landscape scene: 812x375
    gardenLayout.scene = rect(0, 0, 812, 377);
    render(<ControlledGarden />);
    const peachLand = screen.getByTestId('garden-companion-peach');
    const sageLand = screen.getByTestId('garden-companion-sage');

    expect(Number(peachLand.getAttribute('data-x'))).toBeCloseTo(26, 1);
    expect(Number(peachLand.getAttribute('data-y'))).toBeCloseTo(78, 1);
    expect(Number(sageLand.getAttribute('data-x'))).toBeCloseTo(74, 1);
    expect(Number(sageLand.getAttribute('data-y'))).toBeCloseTo(74, 1);
  });

  it('renders the lifted tree bottom anchor for portrait scenes', () => {
    render(<ControlledGarden />);
    const tree = screen.getByTestId('garden-tree-stage-3');
    expect(tree).toHaveClass('bottom-[33%]');
    expect(tree).toHaveClass('landscape:bottom-[2%]');
    expect(tree).not.toHaveClass('bottom-[21%]');
  });
});
