import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripsFetchResult } from '@/lib/trips';
import type { AppState, Trip } from '@/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const fetchRequests: Array<ReturnType<typeof deferred<TripsFetchResult>>> = [];
const saveRequests: Array<ReturnType<typeof deferred<Trip | null>>> = [];

function activeState(userId = 'user-a', coupleId = 'couple-a'): AppState {
  return {
    authenticatedUser: { id: userId, provider: 'google' },
    profile: {
      myName: userId,
      role: 'gomsin',
      couple: { coupleId, partnerName: 'partner', coupleCode: '', connected: true, status: 'active' },
      military: {} as never,
      contact: {} as never,
    },
    trips: [], records: [], events: [], setupComplete: true, onboardingStep: 0,
    isDemoMode: false, widgetLayout: [], hasSeenInstallPrompt: false, theme: 'light',
  };
}

let currentState = activeState();

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/useStore', () => ({ useStore: () => ({ state: currentState }) }));
vi.mock('@/lib/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trips')>();
  return {
    ...actual,
    fetchTripsResultFromDB: () => {
      const request = deferred<TripsFetchResult>();
      fetchRequests.push(request);
      return request.promise;
    },
    saveTripToDB: () => {
      const request = deferred<Trip | null>();
      saveRequests.push(request);
      return request.promise;
    },
  };
});

const { TripsPage } = await import('@/pages/TripsPage');

function Harness() {
  const location = useLocation();
  return <><span data-testid="location">{location.pathname}</span><TripsPage /></>;
}

function plannedTrip(id: string, coupleId = 'couple-a'): Trip {
  return {
    id,
    coupleId,
    createdBy: 'user-a',
    title: 'Secret shared trip',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    status: 'planned',
    createdAt: '2026-07-31T00:00:00.000Z',
  };
}

describe('TripsPage workspace isolation', () => {
  beforeEach(() => {
    currentState = activeState();
    fetchRequests.length = 0;
    saveRequests.length = 0;
  });

  it('hides the local trip list before paint when couple access is revoked', async () => {
    const view = render(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);
    await waitFor(() => expect(fetchRequests).toHaveLength(1));
    await act(async () => fetchRequests[0].resolve({ ok: true, trips: [plannedTrip('trip-a')] }));
    expect(await screen.findByText('Secret shared trip')).toBeInTheDocument();

    currentState = {
      ...currentState,
      profile: {
        ...currentState.profile,
        couple: { partnerName: '', coupleCode: '', connected: false, status: 'disconnected' },
      },
      trips: [plannedTrip('trip-a')],
    };
    view.rerender(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);

    expect(screen.queryByText('Secret shared trip')).not.toBeInTheDocument();
    expect(screen.getByText('우리 공간 연결이 필요해요')).toBeInTheDocument();
  });

  it('ignores a create response after switching to another workspace', async () => {
    const view = render(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);
    await waitFor(() => expect(fetchRequests).toHaveLength(1));
    await act(async () => fetchRequests[0].resolve({ ok: true, trips: [] }));
    expect(await screen.findByText('등록된 여행이 없어요')).toBeInTheDocument();

    fireEvent.click(screen.getByText('새 여행 만들기'));
    fireEvent.change(screen.getByLabelText('여행 이름'), { target: { value: 'Old workspace trip' } });
    fireEvent.change(screen.getByLabelText('가는 날'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('오는 날'), { target: { value: '2026-08-02' } });
    fireEvent.click(screen.getByText('만들기'));
    await waitFor(() => expect(saveRequests).toHaveLength(1));

    currentState = activeState('user-b', 'couple-b');
    view.rerender(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);
    await act(async () => saveRequests[0].resolve(plannedTrip('trip-old')));

    expect(screen.getByTestId('location')).toHaveTextContent('/trips');
    expect(screen.queryByText('Secret shared trip')).not.toBeInTheDocument();
  });
});
