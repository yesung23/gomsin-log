import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/components/InstallPromptBanner', () => ({ InstallPromptBanner: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/SharedSyncBanner', () => ({ SharedSyncBanner: () => null }));

const { MobileShell } = await import('@/components/MobileShell');

describe('MobileShell visual navigation labels', () => {
  it('shows the name of every primary destination without relying on icon recognition', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <MobileShell>
          <p>본문</p>
        </MobileShell>
      </MemoryRouter>,
    );

    for (const label of ['홈', '찾기', '일기장', '일정', '우리']) {
      const tab = screen.getByRole('tab', { name: label });
      const visibleLabel = within(tab).getByText(label);

      expect(visibleLabel).not.toHaveClass('sr-only');
    }
  });
});
