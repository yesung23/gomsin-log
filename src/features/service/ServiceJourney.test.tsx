import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MilitaryInfo } from '@/types';
import { ServiceJourney } from './ServiceJourney';

const military: MilitaryInfo = {
  branch: 'army', militaryStatus: 'serving', enlistmentDate: '2025-01-01',
  expectedDischargeDate: '2026-07-02', dischargeDateSource: 'manual',
};
let reduced = false;
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
  it('updates each second, can pause, and catches up from the clock when resumed', () => {
    render(<ServiceJourney military={military} name="민우" />);
    const readout = screen.getByTestId('service-exp-readout');
    const first = readout.textContent;
    act(() => vi.advanceTimersByTime(1000));
    expect(readout.textContent).not.toBe(first);
    fireEvent.click(screen.getByRole('button', { name: 'EXP 실시간 표시 멈추기' }));
    const paused = readout.textContent;
    act(() => vi.advanceTimersByTime(60000));
    expect(readout.textContent).toBe(paused);
    fireEvent.click(screen.getByRole('button', { name: 'EXP 실시간 표시 켜기' }));
    expect(readout.textContent).not.toBe(paused);
    expect(readout.closest('[aria-live]')).toHaveAttribute('aria-live', 'off');
  });
  it('stops work in the background and cleans up its timer on unmount', () => {
    const view = render(<ServiceJourney military={military} name="민우" />);
    const readout = screen.getByTestId('service-exp-readout');
    const first = readout.textContent;
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60000));
    expect(readout.textContent).toBe(first);
    hidden.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(readout.textContent).not.toBe(first);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockRestore();
  });
  it('defaults to a still, manually refreshable readout under reduced motion', () => {
    reduced = true;
    render(<ServiceJourney military={military} name="민우" />);
    const first = screen.getByTestId('service-exp-readout').textContent;
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent(first!);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '현재 EXP 확인' }));
    expect(screen.getByTestId('service-exp-readout').textContent).not.toBe(first);
  });
  it('can advance past enlistment in reduced-motion mode without leaving the page', () => {
    reduced = true;
    vi.setSystemTime(new Date('2024-12-31T23:59:59+09:00'));
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.0');
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole('button', { name: '현재 복무 현황 확인' }));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.1');
    expect(screen.getByRole('button', { name: '현재 EXP 확인' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('labels estimates, preserves date provenance and exposes the whole journey on demand', () => {
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByText('예상 계급')).toBeInTheDocument();
    expect(screen.getByText('직접 입력한 전역일 기준')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '민우 복무 진행률' })).toBeInTheDocument();
    expect(screen.getByText('계급별 여정').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText(/왕고|일꺾|상꺾/)).toBeNull();
  });
  it.each(['social_service', 'other'] as const)('uses a rank-free journey for %s', branch => {
    render(<ServiceJourney military={{ ...military, branch }} name="민우" />);
    expect(screen.queryByText('예상 계급')).toBeNull();
    expect(screen.queryByText(/병장|이등병|훈련병/)).toBeNull();
    expect(screen.getByText('복무 여정')).toBeInTheDocument();
  });
  it('does not animate completed service or invent progress from missing dates', () => {
    vi.setSystemTime(new Date('2026-07-03T12:00:00+09:00'));
    const view = render(<ServiceJourney military={{ ...military, militaryStatus: 'discharged' }} name="민우" />);
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.200');
    expect(screen.queryByTestId('service-exp-readout')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<ServiceJourney military={{ branch: 'army', militaryStatus: 'unknown' }} name="민우" />);
    expect(screen.queryByTestId('service-level')).toBeNull();
  });
  it('shows a date-recovery hint rather than MAX for contradictory discharge dates', () => {
    render(<ServiceJourney military={{ ...military, militaryStatus: 'discharged' }} name="민우" />);
    expect(screen.getByText('복무 날짜를 확인해 주세요')).toBeInTheDocument();
    expect(screen.queryByTestId('service-level')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
  it('levels up exactly at the time boundary, resetting only the next-level bar', () => {
    vi.setSystemTime(new Date('2025-08-31T23:59:59+09:00'));
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.114');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.115');
    expect(screen.getByRole('progressbar', { name: '다음 레벨 경험치' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('heading', { name: '상병' })).toBeInTheDocument();
  });
  it('never rounds to completed service before the actual end', () => {
    vi.setSystemTime(new Date('2026-07-01T23:59:59+09:00'));
    render(<ServiceJourney military={military} name="민우" />);
    expect(screen.getByRole('progressbar', { name: '민우 복무 진행률' })).toHaveAttribute('aria-valuenow', '99.9');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.200');
    expect(screen.getByRole('progressbar', { name: '민우 복무 진행률' })).toHaveAttribute('aria-valuenow', '100');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops ticking offscreen and catches up when scrolled back into view', () => {
    let intersect: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe() { /* controlled by test */ }
      disconnect = disconnect;
    });
    const view = render(<ServiceJourney military={military} name="민우" />);
    const first = screen.getByTestId('service-exp-readout').textContent;
    act(() => intersect!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByTestId('service-exp-readout').textContent).toBe(first);
    act(() => intersect!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByTestId('service-exp-readout').textContent).not.toBe(first);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
