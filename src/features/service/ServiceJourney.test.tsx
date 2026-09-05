import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MilitaryInfo } from '@/types';
import { serviceDateAtMs } from '@/lib/serviceLevel';
import { ServiceJourney } from './ServiceJourney';

const military: MilitaryInfo = {
  branch: 'army', militaryStatus: 'serving', enlistmentDate: '2025-01-01',
  expectedDischargeDate: '2026-07-02', dischargeDateSource: 'manual',
};
const serviceStart = serviceDateAtMs(military.enlistmentDate!)!;
const identity = { viewerId: 'viewer-1', subjectId: 'soldier-1', coupleId: 'couple-1' };
let reduced = false;

function setElapsed(seconds: number) {
  vi.setSystemTime(serviceStart + seconds * 1000);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-09-01T12:00:00+09:00'));
  reduced = false;
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('live service journey', () => {
  it('shows a prominent hourly level, nickname, explicit estimate and +10 EXP tick', () => {
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.5845');
    expect(screen.getByTestId('service-level')).toHaveClass('service-journey-level--hero');
    expect(screen.getByRole('heading', { name: '상초' })).toBeInTheDocument();
    expect(screen.getByTestId('service-rank-estimate')).toHaveTextContent('예상 계급 · 상병');
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent('0 / 36,000 EXP');
    expect(screen.getByText('다음 레벨까지 60분 0초')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent('10 / 36,000 EXP');
    expect(screen.getByText('다음 레벨까지 59분 59초')).toBeInTheDocument();
    expect(screen.getByText('1초에 +10 EXP')).toBeInTheDocument();
    expect(screen.getByTestId('service-exp-readout').closest('[aria-live]')).toHaveAttribute('aria-live', 'off');
  });

  it('celebrates and politely announces only a genuine live hour crossing', () => {
    setElapsed(3599);
    const view = render(<ServiceJourney {...identity} military={military} name="민우" />);
    expect(screen.queryByTestId('service-level-event')).toBeNull();

    act(() => vi.advanceTimersByTime(1000));
    const event = screen.getByTestId('service-level-event');
    expect(event).toHaveTextContent('Lv.2 달성');
    expect(event).toHaveAttribute('role', 'status');
    expect(event).toHaveAttribute('aria-live', 'polite');
    expect(event).toHaveAttribute('aria-atomic', 'true');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces skipped visible levels into one truthful event', () => {
    setElapsed(3599);
    render(<ServiceJourney {...identity} military={military} name="민우" />);
    vi.setSystemTime(serviceStart + 3 * 3600 * 1000);
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getAllByTestId('service-level-event')).toHaveLength(1);
    expect(screen.getByTestId('service-level-event')).toHaveTextContent('Lv.4 달성 · 3레벨 성장');
  });

  it('does not replay a crossed level after a backward clock edit', () => {
    setElapsed(3599);
    render(<ServiceJourney {...identity} military={military} name="민우" />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-level-event')).toHaveTextContent('Lv.2 달성');
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId('service-level-event')).toBeNull();

    vi.setSystemTime(serviceStart + 3598 * 1000);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId('service-level-event')).toBeNull();
  });

  it('does not celebrate an initial mount or a profile/date switch', () => {
    setElapsed(3600);
    const view = render(<ServiceJourney {...identity} military={military} name="민우" />);
    expect(screen.queryByTestId('service-level-event')).toBeNull();

    view.rerender(<ServiceJourney {...identity} military={{ ...military, enlistmentDate: '2024-12-31' }} name="민우" />);
    expect(screen.queryByTestId('service-level-event')).toBeNull();
  });

  it('pauses, catches up without celebration, then resumes live ticking', () => {
    setElapsed(3599);
    render(<ServiceJourney {...identity} military={military} name="민우" />);
    fireEvent.click(screen.getByRole('button', { name: 'EXP 실시간 표시 멈추기' }));
    const paused = screen.getByTestId('service-exp-readout').textContent;
    vi.setSystemTime(serviceStart + 7200 * 1000);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent(paused!);

    fireEvent.click(screen.getByRole('button', { name: 'EXP 실시간 표시 켜기' }));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.3');
    expect(screen.queryByTestId('service-level-event')).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent('10 / 36,000 EXP');
  });

  it('stops in the background, suppresses catch-up celebration and cleans up on unmount', () => {
    setElapsed(3599);
    const view = render(<ServiceJourney {...identity} military={military} name="민우" />);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(serviceStart + 7200 * 1000);
    hidden.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.3');
    expect(screen.queryByTestId('service-level-event')).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockRestore();
  });

  it('uses a still manual readout with no celebration under reduced motion', () => {
    reduced = true;
    setElapsed(3599);
    render(<ServiceJourney {...identity} military={military} name="민우" />);
    vi.setSystemTime(serviceStart + 3600 * 1000);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.1');
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '현재 EXP 확인' }));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.2');
    expect(screen.queryByTestId('service-level-event')).toBeNull();
  });

  it('can advance past enlistment in reduced-motion mode without leaving the page', () => {
    reduced = true;
    setElapsed(-1);
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.0');
    vi.setSystemTime(serviceStart + 1000);
    fireEvent.click(screen.getByRole('button', { name: '현재 복무 현황 확인' }));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.1');
    expect(screen.getByRole('button', { name: '현재 EXP 확인' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('labels provenance and exposes the growth journey explanation on demand', () => {
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByText('직접 입력한 전역일 기준')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '민우 복무 진행률' })).toBeInTheDocument();
    const summary = screen.getByText('성장 여정');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(screen.getByRole('list', { name: '복무 성장 단계' })).toBeVisible();
    expect(screen.getByText(/한 시간에 한 레벨\. 앱을 닫아도 자라요\./)).toBeInTheDocument();
    expect(screen.getByText(/실제 진급·선임 관계와 다를 수 있어요/)).toBeInTheDocument();
  });

  it.each(['social_service', 'other'] as const)('uses a rank-free journey for %s', branch => {
    render(<ServiceJourney military={{ ...military, branch }} name="민우" />);
    expect(screen.queryByTestId('service-rank-estimate')).toBeNull();
    expect(screen.queryByText(/병장|이등병|훈련병/)).toBeNull();
    expect(screen.getByRole('heading', { name: '적응' })).toBeInTheDocument();
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.5845');
  });

  it('shows a coherent MAX state with no next-level promise', () => {
    setElapsed(547 * 86400);
    render(<ServiceJourney military={{ ...military, militaryStatus: 'discharged' }} name="민우" />);
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.13129 · MAX');
    expect(screen.getByRole('heading', { name: '전역' })).toBeInTheDocument();
    expect(screen.queryByTestId('service-exp-readout')).toBeNull();
    expect(screen.queryByText(/다음 레벨/)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a date-recovery hint rather than MAX for contradictory discharge dates', () => {
    render(<ServiceJourney military={{ ...military, militaryStatus: 'discharged' }} name="민우" />);
    expect(screen.getByText('복무 날짜를 확인해 주세요')).toBeInTheDocument();
    expect(screen.queryByTestId('service-level')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('never rounds to completed service before the actual end', () => {
    setElapsed(547 * 86400 - 1);
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByRole('progressbar', { name: '민우 복무 진행률' })).toHaveAttribute('aria-valuenow', '99.9');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.13129 · MAX');
    expect(screen.getByRole('progressbar', { name: '민우 복무 진행률' })).toHaveAttribute('aria-valuenow', '100');
  });

  it('stops ticking offscreen and catches up without celebration when visible again', () => {
    let intersect: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe() { /* controlled by test */ }
      disconnect = disconnect;
    });
    setElapsed(3599);
    const view = render(<ServiceJourney {...identity} military={military} name="민우" />);
    act(() => intersect!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(serviceStart + 7200 * 1000);
    act(() => intersect!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.3');
    expect(screen.queryByTestId('service-level-event')).toBeNull();
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it.each([
    { ...identity, subjectId: 'soldier-2' },
    { ...identity, viewerId: 'viewer-2' },
    { ...identity, coupleId: 'couple-2' },
    { ...identity, subjectId: undefined },
    { ...identity, viewerId: undefined },
  ])('clears an existing banner immediately when identity changes to %j', nextIdentity => {
    setElapsed(3599);
    const view = render(<ServiceJourney {...identity} military={military} name="민우" />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-level-event')).toHaveTextContent('Lv.2 달성');

    // Same component, name and service dates; only real identity changes.
    view.rerender(<ServiceJourney {...nextIdentity} military={military} name="민우" />);
    expect(screen.queryByTestId('service-level-event')).toBeNull();
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.2');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent('10 / 36,000 EXP');
    expect(screen.queryByTestId('service-level-event')).toBeNull();
  });

  it.each([
    { ...identity, subjectId: undefined },
    { ...identity, viewerId: undefined },
  ])('keeps EXP visible without inventing an event identity: %j', missingIdentity => {
    setElapsed(3599);
    render(<ServiceJourney {...missingIdentity} military={military} name="민우" />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.2');
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent('0 / 36,000 EXP');
    expect(screen.queryByTestId('service-level-event')).toBeNull();
  });
});
