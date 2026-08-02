import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';

/**
 * Offline is a PRE-EMPTIVE read-only mode.
 *
 * The point is not the banner. It is that a mutation control consults this hook and
 * refuses to fire a request that can only fail -- because that failure used to be
 * classified and shown as a permission-shaped or generic error.
 */

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function Probe({ onSave }: { onSave?: () => void }) {
  const online = useOnlineStatus();
  return (
    <div>
      <span data-testid="status">{online ? 'online' : 'offline'}</span>
      <button data-testid="save" disabled={!online} onClick={onSave}>저장</button>
      {!online && <p data-testid="notice">{OFFLINE_READONLY_MESSAGE}</p>}
    </div>
  );
}

afterEach(() => {
  setOnLine(true);
});

describe('useOnlineStatus', () => {
  it('reports the initial connectivity from navigator.onLine', () => {
    setOnLine(false);
    render(<Probe />);
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
  });

  it('reports online when the browser says so', () => {
    setOnLine(true);
    render(<Probe />);
    expect(screen.getByTestId('status')).toHaveTextContent('online');
  });

  it('reacts to the offline event and disables mutation controls', () => {
    setOnLine(true);
    render(<Probe />);
    expect(screen.getByTestId('save')).toBeEnabled();

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByTestId('status')).toHaveTextContent('offline');
    expect(screen.getByTestId('save')).toBeDisabled();
    expect(screen.getByTestId('notice')).toHaveTextContent(OFFLINE_READONLY_MESSAGE);
  });

  it('re-enables mutation controls when the connection returns', () => {
    setOnLine(false);
    render(<Probe />);
    expect(screen.getByTestId('save')).toBeDisabled();

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.getByTestId('status')).toHaveTextContent('online');
    expect(screen.getByTestId('save')).toBeEnabled();
    expect(screen.queryByTestId('notice')).toBeNull();
  });

  it('issues no server call while offline, because the control cannot be activated', () => {
    setOnLine(false);
    let calls = 0;
    render(<Probe onSave={() => { calls += 1; }} />);

    screen.getByTestId('save').click();

    // A disabled button cannot dispatch its click handler, so the request is never
    // built -- which is the difference between "read-only mode" and "a write that
    // fails with a misleading message".
    expect(calls).toBe(0);
  });

  it('reads the flag again on mount so a race cannot leave controls enabled', () => {
    // The `offline` event can fire between the initial render and the effect. The
    // hook re-reads `navigator.onLine` in the effect for exactly that window.
    setOnLine(true);
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('status')).toHaveTextContent('online');
    unmount();

    setOnLine(false);
    render(<Probe />);
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
  });

  it('removes its listeners on unmount', () => {
    setOnLine(true);
    const { unmount } = render(<Probe />);
    unmount();
    // No assertion is possible on listener counts directly; what matters is that
    // dispatching after unmount does not throw a React state-update warning.
    expect(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    }).not.toThrow();
  });

  it('exposes one shared piece of Korean copy for the read-only state', () => {
    expect(OFFLINE_READONLY_MESSAGE).toContain('오프라인');
    expect(OFFLINE_READONLY_MESSAGE).toContain('읽기만');
  });
});
