import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorNote } from '@/components/ui/ErrorNote';

/**
 * The failure surface.
 *
 * `design-preview/ui.tsx` states the contract: errors name the cause, what
 * survived, and the retry -- never "check your internet". The tests below hold the
 * component to all three, and hold the app to using one shape for the job.
 */

describe('an error says what happened, and what survived', () => {
  it('announces itself, so a screen reader interrupts', () => {
    render(<ErrorNote>일정을 저장하지 못했어요.</ErrorNote>);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('puts what survived INSIDE the alert, not beside it', () => {
    /*
     * The line people most need and the one most often dropped. If `kept` sat
     * outside the `role="alert"` element it would never be announced, and the
     * person who just watched a save fail would hear only that it failed.
     */
    render(
      <ErrorNote kept="쓴 내용은 그대로 남아 있어요.">일정을 저장하지 못했어요.</ErrorNote>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('일정을 저장하지 못했어요.');
    expect(alert.textContent).toContain('쓴 내용은 그대로 남아 있어요.');
  });

  it('offers no retry unless one is given', () => {
    // A retry on a permanently-refused write teaches people to press it forever.
    render(<ErrorNote>이 기능이 아직 준비되지 않았어요.</ErrorNote>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('runs the retry it was given', () => {
    const onRetry = vi.fn();
    render(
      <ErrorNote retry={{ label: '다시 시도', onRetry }}>불러오지 못했어요.</ErrorNote>,
    );
    fireEvent.click(screen.getByText('다시 시도'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says it is retrying rather than looking idle', () => {
    render(
      <ErrorNote retry={{ label: '다시 시도', onRetry: () => {}, pending: true }}>
        불러오지 못했어요.
      </ErrorNote>,
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('다시 시도하는 중');
    expect(button).toBeDisabled();
  });

  it('separates a blocked failure from a degraded one by more than wording', () => {
    const blocked = render(<ErrorNote>저장 실패</ErrorNote>).container.innerHTML;
    const degraded = render(<ErrorNote tone="degraded">일부만 불러왔어요</ErrorNote>)
      .container.innerHTML;
    expect(blocked).toContain('destructive');
    expect(degraded).toContain('warning');
    expect(blocked).not.toBe(degraded);
  });

  it('gives the retry a real tap target, at the worst possible moment to miss one', () => {
    render(<ErrorNote retry={{ label: '다시 시도', onRetry: () => {} }}>실패</ErrorNote>);
    expect(screen.getByRole('button').className).toContain('min-h-11');
    expect(screen.getByRole('button').className).toContain('press-response');
  });
});

describe('one shape for one job', () => {
  const files = [
    'src/pages/SchedulePage.tsx',
    'src/pages/TripsPage.tsx',
    'src/pages/TripDetailPage.tsx',
    'src/components/CycleSupportSection.tsx',
    'src/components/CycleTrackerSection.tsx',
  ];

  it('no screen hand-rolls a red caption where ErrorNote belongs', () => {
    /*
     * The same job used to be done four different ways: a bare red caption, a
     * tinted pill, a bordered block and a centred grey panel. The app looked least
     * consistent exactly when the user was already having a bad time.
     *
     * This checks the specific shape that was most common, not every conceivable
     * one -- a check that forbade all inline `role="alert"` would be wrong, because
     * a load-failure PANEL is a legitimately different thing from a form error.
     */
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(
        /<p[^>]*className="text-caption text-destructive"[^>]*role="alert"/,
      );
      expect(source, file).not.toMatch(
        /<p[^>]*role="alert"[^>]*className="text-caption text-destructive"/,
      );
    }
  });

  it('every one of those screens imports the shared note', () => {
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).toContain("from '@/components/ui/ErrorNote'");
    }
  });
});
