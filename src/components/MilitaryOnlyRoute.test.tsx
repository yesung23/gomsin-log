import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let relationshipContext: 'military' | 'general' | undefined = 'military';

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      profile: {
        couple: { relationshipContext },
      },
    },
  }),
}));

const { MilitaryOnlyRoute } = await import('@/components/MilitaryOnlyRoute');

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/service']}>
      <Routes>
        <Route
          path="/service"
          element={(
            <MilitaryOnlyRoute>
              <div>military service screen</div>
            </MilitaryOnlyRoute>
          )}
        />
        <Route path="/my" element={<div>my screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MilitaryOnlyRoute', () => {
  beforeEach(() => {
    relationshipContext = 'military';
  });

  it('keeps legacy and explicit military couples on the service route', () => {
    renderRoute();
    expect(screen.getByText('military service screen')).toBeInTheDocument();
  });

  it('treats a missing legacy context as military', () => {
    relationshipContext = undefined;
    renderRoute();
    expect(screen.getByText('military service screen')).toBeInTheDocument();
  });

  it('redirects a general couple away from a military-only deep link', () => {
    relationshipContext = 'general';
    renderRoute();
    expect(screen.queryByText('military service screen')).toBeNull();
    expect(screen.getByText('my screen')).toBeInTheDocument();
  });
});
