import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { CompanionGardenView } from './CompanionGardenView';
import { deriveCompanionGardenState } from './companionGarden';
import type {
  GardenAccessory,
  GardenAccessoryState,
  GardenCompanionId,
} from '@/lib/companionGardenLocalState';

const AVAILABLE = deriveCompanionGardenState(100);
const DEFAULT_ACCESSORIES: GardenAccessoryState = { version: 1, peach: 'none', sage: 'none' };
const OWNED_ACCESSORIES = ['cap', 'bow', 'scarf', 'flower'] as const;

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
  const [accessories, setAccessories] = useState(initial);
  const change = (companion: GardenCompanionId, accessory: GardenAccessory) => {
    setAccessories((current) => ({ ...current, [companion]: accessory }));
  };
  return (
    <CompanionGardenView
      state={AVAILABLE}
      accessories={accessories}
      ownedAccessories={OWNED_ACCESSORIES}
      onAccessoryChange={change}
    />
  );
}

beforeEach(() => {
  mockReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('interactive companion garden characters', () => {
  it('renders exactly two independently addressable companions', () => {
    render(<ControlledGarden />);
    const companions = screen.getAllByRole('button', { name: /친구 들어올리기/ });
    expect(companions).toHaveLength(2);
    expect(companions.map((node) => node.getAttribute('data-companion'))).toEqual(['peach', 'sage']);
    expect(companions.every((node) => node.getAttribute('data-lifted') === 'false')).toBe(true);
  });

  it('opens optional decoration controls and applies an accessory to each companion independently', async () => {
    const user = userEvent.setup();
    render(<ControlledGarden />);

    expect(screen.queryByRole('region', { name: '정원 꾸미기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '정원 꾸미기' }));

    const panel = screen.getByRole('region', { name: '정원 꾸미기' });
    const peachGroup = within(panel).getByRole('radiogroup', { name: '분홍 친구 액세서리' });
    const sageGroup = within(panel).getByRole('radiogroup', { name: '초록 친구 액세서리' });
    expect(within(peachGroup).getAllByRole('radio')).toHaveLength(5);
    expect(within(sageGroup).getAllByRole('radio')).toHaveLength(5);

    await user.click(within(peachGroup).getByRole('radio', { name: '분홍 친구 모자' }));
    await user.click(within(sageGroup).getByRole('radio', { name: '초록 친구 꽃' }));

    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-accessory', 'cap');
    expect(screen.getByTestId('garden-companion-sage')).toHaveAttribute('data-accessory', 'flower');
    expect(screen.getByTestId('garden-accessory-peach-cap')).toBeInTheDocument();
    expect(screen.getByTestId('garden-accessory-sage-flower')).toBeInTheDocument();
  });

  it('clicking a companion lifts and wriggles it, then reliably returns it to the ground', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '분홍 친구 들어올리기' });

    fireEvent.click(peach);
    expect(peach).toHaveAttribute('data-lifted', 'true');
    expect(peach.className).toContain('garden-companion-lifted');

    act(() => vi.advanceTimersByTime(899));
    expect(peach).toHaveAttribute('data-lifted', 'true');
    act(() => vi.advanceTimersByTime(1));
    expect(peach).toHaveAttribute('data-lifted', 'false');
  });

  it('a repeated tap restarts the lift timer instead of leaving the companion stuck', () => {
    vi.useFakeTimers();
    render(<ControlledGarden />);
    const sage = screen.getByRole('button', { name: '초록 친구 들어올리기' });

    fireEvent.click(sage);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.click(sage);
    act(() => vi.advanceTimersByTime(600));
    expect(sage).toHaveAttribute('data-lifted', 'true');
    act(() => vi.advanceTimersByTime(300));
    expect(sage).toHaveAttribute('data-lifted', 'false');
  });

  it('keyboard activation provides the same lift interaction', async () => {
    const user = userEvent.setup();
    render(<ControlledGarden />);
    const peach = screen.getByRole('button', { name: '분홍 친구 들어올리기' });
    peach.focus();
    await user.keyboard('{Enter}');
    expect(peach).toHaveAttribute('data-lifted', 'true');
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
