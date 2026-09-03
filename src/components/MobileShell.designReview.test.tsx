import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/components/InstallPromptBanner', () => ({ InstallPromptBanner: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/SharedSyncBanner', () => ({ SharedSyncBanner: () => null }));

const { MobileShell } = await import('@/components/MobileShell');

const DESTINATIONS = [
  { path: '/home', label: '홈' },
  { path: '/search', label: '찾기' },
  { path: '/diary', label: '일기장' },
  { path: '/schedule', label: '일정' },
  { path: '/us', label: '우리' },
] as const;

function renderShell(path = '/home') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileShell>
        <p>본문</p>
      </MobileShell>
    </MemoryRouter>,
  );
}

describe('MobileShell icon-only primary navigation', () => {
  it('keeps the exact destination links and Korean accessible names without visible labels or tab roles', () => {
    renderShell();

    const navigation = screen.getByRole('navigation', { name: '하단 내비게이션' });
    const links = within(navigation).getAllByRole('link');

    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute('aria-label')))
      .toEqual(DESTINATIONS.map(({ label }) => label));
    expect(links.map((link) => link.getAttribute('href')))
      .toEqual(DESTINATIONS.map(({ path }) => path));

    for (const [index, link] of links.entries()) {
      expect(within(link).queryByText(DESTINATIONS[index].label)).not.toBeInTheDocument();
      expect(link).toHaveClass('min-h-[52px]');
    }

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it.each(DESTINATIONS)(
    'marks $label as current with a short non-color indicator on $path',
    ({ path, label }) => {
      renderShell(path);

      const navigation = screen.getByRole('navigation', { name: '하단 내비게이션' });
      const links = within(navigation).getAllByRole('link');
      const activeLink = within(navigation).getByRole('link', { name: label });
      const indicator = activeLink.querySelector<HTMLElement>('[data-active-indicator]');

      expect(activeLink).toHaveAttribute('aria-current', 'page');
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveAttribute('aria-hidden', 'true');
      expect(indicator?.style.width).toBe('17px');
      expect(indicator?.style.height).toBe('2px');
      expect(indicator?.style.background).toBe('var(--ink)');

      for (const link of links.filter((candidate) => candidate !== activeLink)) {
        expect(link).not.toHaveAttribute('aria-current');
        expect(link.querySelector('[data-active-indicator]')).toBeNull();
      }
    },
  );

  it('uses one 23px outline family with consistent active and inactive strokes', () => {
    renderShell('/home');

    const navigation = screen.getByRole('navigation', { name: '하단 내비게이션' });
    const links = within(navigation).getAllByRole('link');
    const icons = links.map((link) => link.querySelector('svg'));

    expect(icons.every((icon) => icon !== null)).toBe(true);
    for (const [index, icon] of icons.entries()) {
      expect(icon).toHaveAttribute('width', '23');
      expect(icon).toHaveAttribute('height', '23');
      expect(icon).toHaveAttribute('fill', 'none');
      expect(icon).toHaveAttribute('stroke-width', index === 0 ? '2.25' : '1.75');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }

    expect(icons[4]).toHaveClass('lucide-users-round');
  });
});
