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

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

describe('TripsPage offline read-only mode', () => {
  beforeEach(() => {
    currentState = activeState();
    fetchRequests.length = 0;
    saveRequests.length = 0;
    setOnLine(true);
  });

  it('disables trip creation while offline and issues no server call', async () => {
    render(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);
    await waitFor(() => expect(fetchRequests).toHaveLength(1));
    await act(async () => fetchRequests[0].resolve({ ok: true, trips: [] }));
    expect(await screen.findByText('등록된 여행이 없어요')).toBeInTheDocument();

    fireEvent.click(screen.getByText('새 여행 만들기'));
    fireEvent.change(screen.getByLabelText('여행 이름'), { target: { value: 'Offline trip' } });
    fireEvent.change(screen.getByLabelText('가는 날'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('오는 날'), { target: { value: '2026-08-02' } });

    await act(async () => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    const create = screen.getByText('만들기');
    expect(create).toBeDisabled();
    fireEvent.click(create);
    // Read-only means the request is never built, not that it fails politely.
    expect(saveRequests).toHaveLength(0);
  });

  it('re-enables trip creation when the connection returns', async () => {
    setOnLine(false);
    render(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);
    await waitFor(() => expect(fetchRequests).toHaveLength(1));
    await act(async () => fetchRequests[0].resolve({ ok: true, trips: [] }));
    expect(await screen.findByText('등록된 여행이 없어요')).toBeInTheDocument();

    // The "new trip" entry point is disabled while offline.
    expect(screen.getByLabelText('새 여행')).toBeDisabled();

    await act(async () => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.getByLabelText('새 여행')).toBeEnabled();
  });

  it('does not blame the connection for a load failure while online', async () => {
    render(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);
    await waitFor(() => expect(fetchRequests).toHaveLength(1));
    await act(async () => fetchRequests[0].resolve({ ok: false, reason: 'error' }));

    expect(await screen.findByText('여행을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText(/인터넷 연결을 확인하고/)).toBeNull();
  });

  it('leaves local state unchanged when a create is refused by the server', async () => {
    render(<MemoryRouter initialEntries={['/trips']}><Harness /></MemoryRouter>);
    await waitFor(() => expect(fetchRequests).toHaveLength(1));
    await act(async () => fetchRequests[0].resolve({ ok: true, trips: [] }));

    fireEvent.click(screen.getByText('새 여행 만들기'));
    fireEvent.change(screen.getByLabelText('여행 이름'), { target: { value: 'Refused trip' } });
    fireEvent.change(screen.getByLabelText('가는 날'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('오는 날'), { target: { value: '2026-08-02' } });
    fireEvent.click(screen.getByText('만들기'));
    await waitFor(() => expect(saveRequests).toHaveLength(1));

    // `null` means the server did not accept the row.
    await act(async () => saveRequests[0].resolve(null));

    // The trip must NOT appear locally, and the input is retained so the user does
    // not lose their typing.
    expect(screen.queryByText('Refused trip')).not.toBeInTheDocument();
    expect(screen.getByLabelText('여행 이름')).toHaveValue('Refused trip');
  });
});
