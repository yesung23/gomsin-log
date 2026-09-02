import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionGardenView } from './CompanionGardenView';
import { deriveCompanionGardenState } from './companionGarden';
import {
  GARDEN_BOUNDS,
  GARDEN_COMPANION_SIZE,
  companionsOverlap,
  getPhysicalGardenBounds,
} from './companionGardenMotion';
import type { GardenAccessory, GardenAccessoryState } from '@/lib/companionGardenLocalState';

const AVAILABLE = deriveCompanionGardenState(100);
const DEFAULT_ACCESSORIES: GardenAccessoryState = { version: 1, peach: 'none', sage: 'none' };

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
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
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
  mockReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('interactive companion garden characters', () => {
  it('keeps the garden surface quiet while exposing one discoverable play entry point', () => {
    const onBack = vi.fn();
    render(<CompanionGardenView
      state={AVAILABLE}
      accessories={DEFAULT_ACCESSORIES}
      onBack={onBack}
    />);

    expect(screen.getByRole('button', { name: '이전 화면으로' })).toBeInTheDocument();
    expect(screen.getByText('함께한 100일')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '우리 정원' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '든든한 나무' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '꾸미기와 함께 놀기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '상점 열기' })).not.toBeInTheDocument();
    expect(screen.queryByText('길게 누르면 친구를 들어 올려 움직일 수 있어요.')).not.toBeInTheDocument();
    expect(screen.queryByText('정원은 점수나 미션 없이 함께한 시간만 따라 자라요.')).not.toBeInTheDocument();
    expect(screen.getByTestId('garden-scene')).toHaveClass('bg-card');
    expect(screen.getByTestId('garden-scene')).not.toHaveAttribute('style');
  });

  it('renders exactly two independently addressable companions', () => {
    render(<ControlledGarden />);
    const companions = screen.getAllByRole('button', { name: /친구와 함께 놀기/ });
    expect(companions).toHaveLength(2);
    expect(companions.map((node) => node.getAttribute('data-companion'))).toEqual(['peach', 'sage']);
    expect(companions.every((node) => node.getAttribute('data-lifted') === 'false')).toBe(true);
  });

  it('renders both approved front-facing crops from the exact historical WebP', () => {
    render(<ControlledGarden />);
    const first = screen.getByTestId('garden-exact-character-peach');
    const second = screen.getByTestId('garden-exact-character-sage');

    expect(first).toHaveAttribute('viewBox', '20 515 136 155');
    expect(second).toHaveAttribute('viewBox', '156 514 138 155');
    expect(first.querySelector('image')?.getAttribute('href')).toContain('paper-pair-v1.webp');
    expect(second.querySelector('image')?.getAttribute('href')).toContain('paper-pair-v1.webp');
  });

  it.each(['cap', 'bow', 'scarf', 'flower'] as const)(
    'keeps the exact paper-pair character and visibly overlays the %s accessory',
    (accessory: GardenAccessory) => {
    const accessories: GardenAccessoryState = { version: 1, peach: accessory, sage: 'none' };
    render(<ControlledGarden initial={accessories} />);

    expect(screen.getByTestId('garden-exact-character-peach')).toHaveAttribute('viewBox', '20 515 136 155');
    expect(screen.getByTestId('garden-exact-character-sage')).toHaveAttribute('viewBox', '156 514 138 155');
    expect(screen.getByTestId('garden-exact-character-peach').querySelector('image'))
      .toHaveAttribute('href', expect.stringContaining('paper-pair-v1.webp'));
    expect(screen.getByTestId(`garden-accessory-peach-${accessory}`)).toBeVisible();
    expect(screen.queryByTestId(`garden-accessory-sage-${accessory}`)).not.toBeInTheDocument();
  });

  it('requires a continuous 500ms press, then stays picked up until release', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '첫째 친구와 함께 놀기. 길게 눌러 직접 이동' });

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

  it('opens the same accessible action sheet after a quick pointer tap', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(sage, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(sage, { pointerId: 2, pointerType: 'mouse', clientX: 100, clientY: 100 });
    fireEvent.click(sage, { detail: 1 });

    expect(sage).toHaveAttribute('data-lifted', 'false');
    expect(screen.getByRole('dialog', { name: '둘째 친구와 함께 놀기' })).toBeInTheDocument();
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

  it('lets the next deliberate tap work when a moved gesture produced no click', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByTestId('garden-companion-sage');

    fireEvent.pointerDown(sage, { pointerId: 31, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(sage, { pointerId: 31, pointerType: 'touch', clientX: 112, clientY: 100 });
    fireEvent.pointerUp(sage, { pointerId: 31, pointerType: 'touch', clientX: 112, clientY: 100 });

    fireEvent.pointerDown(sage, { pointerId: 32, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(sage, { pointerId: 32, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.click(sage, { detail: 1 });

    expect(screen.getByRole('dialog', { name: '둘째 친구와 함께 놀기' })).toBeInTheDocument();
  });

  it('cancels a pre-activation pickup on pointercancel and clears its timer', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByRole('button', { name: '둘째 친구와 함께 놀기. 길게 눌러 직접 이동' });

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
    const peach = screen.getByRole('button', { name: '첫째 친구와 함께 놀기. 길게 눌러 직접 이동' });

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
    const peach = screen.getByRole('button', { name: '첫째 친구와 함께 놀기. 길게 눌러 직접 이동' });
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
    const peach = screen.getByRole('button', { name: '첫째 친구와 함께 놀기. 길게 눌러 직접 이동' });
    const sage = screen.getByRole('button', { name: '둘째 친구와 함께 놀기. 길게 눌러 직접 이동' });

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

  it('keeps dragged companions from stacking on the other rendered sprite', () => {
    // This test owns the drag constraint; disable autonomous timers so wandering
    // cannot race the explicit pointer move and make the assertion flaky.
    mockReducedMotion(true);
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 375, bottom: 600, width: 375, height: 600,
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

  it('freezes the rendered position before a long press interrupts wandering', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const scene = screen.getByTestId('garden-scene');
    vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 375, bottom: 600, width: 375, height: 600,
      toJSON: () => ({}),
    });
    const position = screen.getByTestId('garden-companion-position-peach');
    vi.spyOn(position, 'getBoundingClientRect').mockReturnValue({
      x: 41, y: 180, left: 41, top: 180, right: 139, bottom: 292, width: 98, height: 112,
      toJSON: () => ({}),
    });
    const peach = screen.getByTestId('garden-companion-peach');

    fireEvent.pointerDown(peach, { pointerId: 9, pointerType: 'touch', button: 0, clientX: 90, clientY: 240 });

    expect(Number(peach.getAttribute('data-x'))).toBeCloseTo((41 + 49) / 375 * 100, 2);
    expect(Number(peach.getAttribute('data-y'))).toBeCloseTo(292 / 600 * 100, 2);
    fireEvent.pointerUp(peach, { pointerId: 9, pointerType: 'touch', clientX: 90, clientY: 240 });
  });

  it.each(['Enter', ' '])('keyboard %s activation opens the same action sheet', (key) => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    peach.focus();
    fireEvent.keyDown(peach, { key });

    expect(peach).toHaveAttribute('data-lifted', 'false');
    expect(screen.getByRole('dialog', { name: '첫째 친구와 함께 놀기' })).toBeInTheDocument();
  });

  it('ignores held-key repeats instead of reopening the action sheet', () => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    peach.focus();

    fireEvent.keyDown(peach, { key: 'Enter', repeat: false });
    const dialog = screen.getByRole('dialog', { name: '첫째 친구와 함께 놀기' });
    fireEvent.keyDown(peach, { key: 'Enter', repeat: true });

    expect(screen.getAllByRole('dialog')).toEqual([dialog]);
  });

  it('supports an assistive semantic detail-zero click through the same action sheet', () => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');

    fireEvent.click(peach, { detail: 0 });

    expect(peach).toHaveAttribute('data-lifted', 'false');
    expect(screen.getByRole('dialog', { name: '첫째 친구와 함께 놀기' })).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: `첫째 친구 ${action.label}으로 이동` }));
      const next = Number(peach.getAttribute(`data-${action.axis}`));
      expect(action.compare(next, prior)).toBe(true);
      expect(screen.getByRole('status')).toHaveTextContent(`첫째 친구를 ${action.label}으로 옮겼어요.`);
    }

    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: '첫째 친구 오른쪽으로 이동' }));
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
    expect(companionsOverlap(peachPoint, sagePoint, { width: 320, height: 600 }, GARDEN_COMPANION_SIZE.gap)).toBe(false);
  });

  it('names the modal, closes it with Escape, and restores focus to its trigger', () => {
    render(<ControlledGarden />);
    const peach = screen.getByTestId('garden-companion-peach');
    peach.focus();

    fireEvent.click(peach, { detail: 0 });
    const dialog = screen.getByRole('dialog', { name: '첫째 친구와 함께 놀기' });
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

    fireEvent.click(screen.getByRole('button', { name: '첫째 친구와 함께 놀기 닫기' }));
    act(() => vi.advanceTimersByTime(901));

    expect(Number(peach.getAttribute('data-move-count'))).toBeGreaterThan(0);
    expect(Number(sage.getAttribute('data-move-count'))).toBeGreaterThan(0);
  });

  it('clears pickup state when availability is withdrawn and restored', () => {
    vi.useFakeTimers();
    const view = render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '첫째 친구와 함께 놀기. 길게 눌러 직접 이동' });

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
  it('moves both companions after short independent startup delays', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<ControlledGarden />);

    const peach = screen.getByTestId('garden-companion-peach');
    const sage = screen.getByTestId('garden-companion-sage');
    const peachStart = [peach.getAttribute('data-x'), peach.getAttribute('data-y')];
    const sageStart = [sage.getAttribute('data-x'), sage.getAttribute('data-y')];
    expect(peach).toHaveAttribute('data-move-count', '0');
    expect(sage).toHaveAttribute('data-move-count', '0');

    act(() => vi.advanceTimersByTime(901));

    expect(Number(peach.getAttribute('data-move-count'))).toBeGreaterThanOrEqual(1);
    expect(Number(sage.getAttribute('data-move-count'))).toBeGreaterThanOrEqual(1);
    expect([peach.getAttribute('data-x'), peach.getAttribute('data-y')]).not.toEqual(peachStart);
    expect([sage.getAttribute('data-x'), sage.getAttribute('data-y')]).not.toEqual(sageStart);
    expect(peach).toHaveAttribute('data-wandering', 'true');
    expect(sage).toHaveAttribute('data-wandering', 'true');
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
  });
});
