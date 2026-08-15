import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/MobileShell', () => ({ MobileShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/home/WidgetDashboard', () => ({ WidgetDashboard: () => <div data-testid="dashboard" /> }));

import { HomePage } from './HomePage';

describe('home to chat navigation', () => {
  it('reaches chat in one action without adding a bottom tab', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '채팅으로 이동' })).toHaveAttribute('href', '/chat');
    expect(screen.queryByRole('tab', { name: '채팅' })).toBeNull();
  });
});
