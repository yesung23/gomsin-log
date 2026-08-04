import type { Trip, TripStatus } from '@/types';

/**
 * Where a trip sits in time, derived from its dates.
 *
 * `Trip.status` is a stored column that only ever changes when a human edits it,
 * so a trip whose dates passed months ago still displayed 계획중 forever. Deriving
 * the phase from the dates means the list is honest without anyone maintaining it,
 * and it is what makes "과거 · 현재 · 미래를 모두 확인" possible at a glance.
 *
 * The stored `status` is NOT discarded: `completed` is treated as authoritative for
 * a finished trip even if the dates say otherwise, because a couple who marked a
 * trip 다녀옴 has said something the calendar cannot know (a cancelled trip, a trip
 * cut short). Dates only ever *promote* a trip out of 계획중.
 */
export type TripPhase = 'current' | 'upcoming' | 'past';

export const TRIP_PHASE_LABEL: Record<TripPhase, string> = {
  current: '지금 여행 중',
  upcoming: '다가오는 여행',
  past: '다녀온 여행',
};

/** Short pill text for a single trip card. */
export const TRIP_PHASE_PILL: Record<TripPhase, string> = {
  current: '여행 중',
  upcoming: '예정',
  past: '다녀옴',
};

export function deriveTripPhase(
  trip: Pick<Trip, 'startDate' | 'endDate' | 'status'>,
  today: string,
): TripPhase {
  // An explicit 다녀옴 wins: the user knows something the dates do not.
  if (trip.status === 'completed') return 'past';
  if (trip.endDate < today) return 'past';
  if (trip.startDate > today) return 'upcoming';
  return 'current';
}

/**
 * Group trips for the planning hub.
 *
 * Ordering is deliberate and different per bucket:
 *  - `current` first, soonest-ending first, because it is what you act on today.
 *  - `upcoming` ascending: the nearest plan is the one you are preparing for.
 *  - `past` DESCENDING: the most recent memory is the one worth revisiting, and a
 *    couple with two years of trips should not have to scroll to last month.
 */
export function groupTripsByPhase(
  trips: Trip[],
  today: string,
): Record<TripPhase, Trip[]> {
  const grouped: Record<TripPhase, Trip[]> = { current: [], upcoming: [], past: [] };
  for (const trip of trips) grouped[deriveTripPhase(trip, today)].push(trip);
  grouped.current.sort((a, b) => a.endDate.localeCompare(b.endDate));
  grouped.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  grouped.past.sort((a, b) => b.endDate.localeCompare(a.endDate));
  return grouped;
}

/** The order sections are rendered in: what is happening, then next, then memory. */
export const TRIP_PHASE_ORDER: readonly TripPhase[] = ['current', 'upcoming', 'past'] as const;

/**
 * How many days until a trip starts, or null when it is not upcoming.
 * Pure string comparison at the caller's `today`, so no clock lives in here.
 */
export function daysUntilTrip(startDate: string, today: string): number | null {
  if (startDate <= today) return null;
  const start = Date.UTC(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(5, 7)) - 1,
    Number(startDate.slice(8, 10)),
  );
  const now = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10)),
  );
  return Math.round((start - now) / 86_400_000);
}

/** Kept so the detail screen's status <select> still has its labels. */
export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  planned: '계획중',
  ongoing: '여행중',
  completed: '다녀옴',
};
