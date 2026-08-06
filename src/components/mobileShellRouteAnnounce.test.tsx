import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The behavioural half of `accessibilityInvariants.test.ts`.
 *
 * That suite pins the attributes in source. This one drives the real component:
 * clicks a tab, and asserts that the live region actually says the new screen's
 * name and that focus actually lands in `<main>` instead of staying on the tab in
 * the bar at the bottom.
 *
 * Before the fix a tab change announced nothing at all, and focus stayed on the
 * tab, so the next Tab press walked backwards through the navigation rather than
 * into the content the user had just asked for. WCAG 2.1 SC 4.1.3 and SC 2.4.3.
 */

vi.mock('@/components/InstallPromptBanner', () => ({ InstallPromptBanner: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/SharedSyncBanner', () => ({ SharedSyncBanner: () => null }));

const { MobileShell } = await import('@/components/MobileShell');

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileShell>
        <p>본문</p>
      </MobileShell>
    </MemoryRouter>,
  );
}

describe('MobileShell announces the screen and moves focus on navigation', () => {
  it('says nothing on the first render, which is not a navigation', () => {
    renderShell('/home');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces the new screen after a tab change', async () => {
    const user = userEvent.setup();
    renderShell('/home');

    await user.click(screen.getByRole('tab', { name: '기록' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('기록 화면입니다');
    });
  });

  it('moves focus into main, off the tab that was clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderShell('/home');

    const tab = screen.getByRole('tab', { name: '일정' });
    await user.click(tab);

    const main = container.querySelector('#main-content');
    await waitFor(() => {
      expect(document.activeElement).toBe(main);
    });
    expect(document.activeElement).not.toBe(tab);
  });

  it('offers the skip link as the first focusable element, pointing at main', async () => {
    const user = userEvent.setup();
    const { container } = renderShell('/home');

    await user.tab();

    const skip = screen.getByRole('link', { name: '본문으로 건너뛰기' });
    expect(document.activeElement).toBe(skip);
    expect(skip).toHaveAttribute('href', '#main-content');
    expect(container.querySelector('#main-content')).not.toBeNull();
  });

  it('PRESERVATION: the tab bar still lights the section it is in', () => {
    renderShell('/trips/abc');
    // `/trips/:id` is inside 일정, and the highlight must survive a detail screen.
    expect(screen.getByRole('tab', { name: '일정' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '홈' })).toHaveAttribute('aria-selected', 'false');
  });

  it('PRESERVATION: children still render inside main', () => {
    const { container } = renderShell('/home');
    expect(container.querySelector('#main-content')?.textContent).toContain('본문');
  });
});
