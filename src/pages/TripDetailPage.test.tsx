import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  TripChecklistsFetchResult,
  TripFetchResult,
  TripItemsFetchResult,
} from '@/lib/trips';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const parentRequests: Array<{ id: string; request: ReturnType<typeof deferred<TripFetchResult>> }> = [];
const itemRequests: Array<{ id: string; request: ReturnType<typeof deferred<TripItemsFetchResult>> }> = [];
const checklistRequests: Array<{ id: string; request: ReturnType<typeof deferred<TripChecklistsFetchResult>> }> = [];
const deleteRequests: Array<{ id: string; request: ReturnType<typeof deferred<boolean>> }> = [];
const saveTripItemMock = vi.fn();
const recognizePlaceScreenshotMock = vi.fn();
const storeState = {
  authenticatedUser: { id: 'user-a', provider: 'google' },
  profile: {
    role: 'gomsin',
    couple: { coupleId: 'couple-a', connected: true, status: 'active' },
  },
  trips: [],
};

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/supabase', () => ({ supabase: null }));
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: storeState }),
}));
vi.mock('@/lib/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trips')>();
  return {
    ...actual,
    fetchTripResultFromDB: (id: string) => {
      const request = deferred<TripFetchResult>();
      parentRequests.push({ id, request });
      return request.promise;
    },
    fetchTripItemsResultFromDB: (id: string) => {
      const request = deferred<TripItemsFetchResult>();
      itemRequests.push({ id, request });
      return request.promise;
    },
    fetchTripChecklistsResultFromDB: (id: string) => {
      const request = deferred<TripChecklistsFetchResult>();
      checklistRequests.push({ id, request });
      return request.promise;
    },
    deleteTripFromDB: (id: string) => {
      const request = deferred<boolean>();
      deleteRequests.push({ id, request });
      return request.promise;
    },
    saveTripItemToDB: (...args: unknown[]) => saveTripItemMock(...args),
  };
});
vi.mock('@/lib/placeOcr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/placeOcr')>();
  return {
    ...actual,
    recognizePlaceScreenshot: (...args: unknown[]) => recognizePlaceScreenshotMock(...args),
  };
});

const { TripDetailPage } = await import('@/pages/TripDetailPage');

function Harness() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <span data-testid="location">{location.pathname}</span>
      <button type="button" onClick={() => navigate('/trips/trip-b')}>go-b</button>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </>
  );
}

function trip(id: string, title: string, date: string) {
  return {
    id,
    coupleId: 'couple-a',
    createdBy: 'user-a',
    title,
    startDate: date,
    endDate: date,
    status: 'planned' as const,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('TripDetailPage route request isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    saveTripItemMock.mockReset();
    recognizePlaceScreenshotMock.mockReset();
  });
  it('ignores late child responses from the previous trip route', async () => {
    parentRequests.length = 0;
    itemRequests.length = 0;
    checklistRequests.length = 0;
    deleteRequests.length = 0;
    render(
      <MemoryRouter initialEntries={['/trips/trip-a']}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => expect(parentRequests.some((entry) => entry.id === 'trip-a')).toBe(true));
    const parentA = parentRequests.find((entry) => entry.id === 'trip-a')!.request;
    await act(async () => parentA.resolve({ ok: true, trip: trip('trip-a', 'A trip', '2026-08-01') }));
    await waitFor(() => expect(itemRequests.some((entry) => entry.id === 'trip-a')).toBe(true));

    await act(async () => screen.getByText('go-b').click());
    await waitFor(() => expect(parentRequests.some((entry) => entry.id === 'trip-b')).toBe(true));
    const parentB = parentRequests.find((entry) => entry.id === 'trip-b')!.request;
    await act(async () => parentB.resolve({ ok: true, trip: trip('trip-b', 'B trip', '2026-08-02') }));
    await waitFor(() => expect(itemRequests.some((entry) => entry.id === 'trip-b')).toBe(true));

    const itemsB = itemRequests.filter((entry) => entry.id === 'trip-b').at(-1)!.request;
    const checksB = checklistRequests.filter((entry) => entry.id === 'trip-b').at(-1)!.request;
    await act(async () => {
      itemsB.resolve({
        ok: true,
        items: [{
          id: 'item-b', tripId: 'trip-b', itemDate: '2026-08-02', title: 'B item',
          category: 'activity', sortOrder: 0,
        }],
      });
      checksB.resolve({ ok: true, checklists: [] });
    });
    expect(await screen.findByText('B item')).toBeInTheDocument();

    const itemsA = itemRequests.find((entry) => entry.id === 'trip-a')!.request;
    const checksA = checklistRequests.find((entry) => entry.id === 'trip-a')!.request;
    await act(async () => {
      itemsA.resolve({
        ok: true,
        items: [{
          id: 'item-a', tripId: 'trip-a', itemDate: '2026-08-01', title: 'A item',
          category: 'activity', sortOrder: 0,
        }],
      });
      checksA.resolve({ ok: true, checklists: [] });
    });

    expect(screen.queryByText('A item')).not.toBeInTheDocument();
    expect(screen.getByText('B item')).toBeInTheDocument();
    expect(screen.getByText('B trip')).toBeInTheDocument();
  });

  it('ignores a late parent response from the previous trip route', async () => {
    parentRequests.length = 0;
    itemRequests.length = 0;
    checklistRequests.length = 0;
    deleteRequests.length = 0;
    render(
      <MemoryRouter initialEntries={['/trips/trip-a']}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => expect(parentRequests.some((entry) => entry.id === 'trip-a')).toBe(true));
    const parentA = parentRequests.find((entry) => entry.id === 'trip-a')!.request;
    await act(async () => screen.getByText('go-b').click());
    await waitFor(() => expect(parentRequests.some((entry) => entry.id === 'trip-b')).toBe(true));
    const parentB = parentRequests.find((entry) => entry.id === 'trip-b')!.request;

    await act(async () => parentB.resolve({ ok: true, trip: trip('trip-b', 'B trip', '2026-08-02') }));
    await waitFor(() => expect(itemRequests.some((entry) => entry.id === 'trip-b')).toBe(true));
    const itemsB = itemRequests.filter((entry) => entry.id === 'trip-b').at(-1)!.request;
    const checksB = checklistRequests.filter((entry) => entry.id === 'trip-b').at(-1)!.request;
    await act(async () => {
      itemsB.resolve({ ok: true, items: [] });
      checksB.resolve({ ok: true, checklists: [] });
    });
    expect(await screen.findByText('B trip')).toBeInTheDocument();

    await act(async () => parentA.resolve({ ok: true, trip: trip('trip-a', 'A trip', '2026-08-01') }));
    expect(screen.queryByText('A trip')).not.toBeInTheDocument();
    expect(screen.getByText('B trip')).toBeInTheDocument();
  });

  it('does not navigate after a delete from the previous trip route resolves', async () => {
    parentRequests.length = 0;
    itemRequests.length = 0;
    checklistRequests.length = 0;
    deleteRequests.length = 0;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={['/trips/trip-a']}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => expect(parentRequests.some((entry) => entry.id === 'trip-a')).toBe(true));
    await act(async () => parentRequests.find((entry) => entry.id === 'trip-a')!.request.resolve({
      ok: true,
      trip: trip('trip-a', 'A trip', '2026-08-01'),
    }));
    await waitFor(() => expect(itemRequests.some((entry) => entry.id === 'trip-a')).toBe(true));
    await act(async () => {
      itemRequests.find((entry) => entry.id === 'trip-a')!.request.resolve({ ok: true, items: [] });
      checklistRequests.find((entry) => entry.id === 'trip-a')!.request.resolve({ ok: true, checklists: [] });
    });
    expect(await screen.findByText('A trip')).toBeInTheDocument();

    await act(async () => screen.getByLabelText('여행 삭제').click());
    await waitFor(() => expect(deleteRequests.some((entry) => entry.id === 'trip-a')).toBe(true));
    await act(async () => screen.getByText('go-b').click());
    expect(screen.getByTestId('location')).toHaveTextContent('/trips/trip-b');

    await act(async () => deleteRequests.find((entry) => entry.id === 'trip-a')!.request.resolve(true));
    expect(screen.getByTestId('location')).toHaveTextContent('/trips/trip-b');
  });

  it('adds a place from one screenshot and opens the saved row for correction', async () => {
    parentRequests.length = 0;
    itemRequests.length = 0;
    checklistRequests.length = 0;
    deleteRequests.length = 0;
    recognizePlaceScreenshotMock.mockResolvedValue({
      title: '연남토마',
      address: '서울 마포구 연남로 42',
      businessHours: '매일 11:30 - 21:00',
      rawText: '연남토마 카페 서울 마포구 연남로 42',
    });
    saveTripItemMock.mockResolvedValue({
      id: 'item-photo',
      tripId: 'trip-a',
      itemDate: '2026-08-01',
      title: '연남토마',
      address: '서울 마포구 연남로 42',
      businessHours: '매일 11:30 - 21:00',
      category: 'food',
      source: 'screenshot',
      sortOrder: 0,
    });

    render(
      <MemoryRouter initialEntries={['/trips/trip-a']}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(parentRequests.some((entry) => entry.id === 'trip-a')).toBe(true));
    await act(async () => parentRequests.find((entry) => entry.id === 'trip-a')!.request.resolve({
      ok: true,
      trip: trip('trip-a', 'A trip', '2026-08-01'),
    }));
    await waitFor(() => expect(itemRequests.some((entry) => entry.id === 'trip-a')).toBe(true));
    await act(async () => {
      itemRequests.find((entry) => entry.id === 'trip-a')!.request.resolve({ ok: true, items: [] });
      checklistRequests.find((entry) => entry.id === 'trip-a')!.request.resolve({ ok: true, checklists: [] });
    });

    expect(await screen.findByRole('button', { name: '사진으로 바로 추가' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('지도 캡처 선택'), {
      target: { files: [new File(['map'], 'map.png', { type: 'image/png' })] },
    });

    const savedRow = await screen.findByRole('button', { name: '연남토마 일정 수정' });
    expect(saveTripItemMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '연남토마',
      category: 'food',
      source: 'screenshot',
    }));
    fireEvent.click(savedRow);
    expect(screen.getByRole('heading', { name: '일정 수정' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('연남토마')).toBeInTheDocument();
  });
});
