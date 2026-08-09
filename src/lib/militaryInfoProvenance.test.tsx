import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AppState, MilitaryInfo } from '@/types';

/**
 * M-1: absent service info must not be back-filled with invented dates.
 *
 * `sync.ts` used to substitute a fixed literal triple for any `profiles` row
 * whose `military_info` was null:
 *
 *   enlistmentDate:       '2025-03-10'
 *   expectedDischargeDate:'2026-09-09'
 *   dischargeDateSource:  'calculated'
 *
 * Two separate lies came out of that. First the dates: `computeServiceProgress`
 * happily divides them, so ServicePage and the 복무 진행률 widget rendered a
 * specific D-Day and a specific service percentage for a user who had never told
 * the app anything about a service period. Second the provenance:
 * `'calculated'` asserts the discharge date was DERIVED from a real branch and a
 * real enlistment date, and the 자동 계산 badge repeated that claim on screen.
 *
 * `DEFAULT_STATE` in `store.tsx` carried the identical triple, so a local-only
 * or pre-field stored state produced the same fake D-Day without any server
 * involved.
 *
 * The honest representation is `militaryStatus: 'unknown'` with no dates and
 * `dischargeDateSource: 'unknown'`, which makes `computeServiceProgress` return
 * null and every dependent surface fall through to its own empty state.
 */

const FABRICATED_ENLISTMENT = '2025-03-10';
const FABRICATED_DISCHARGE = '2026-09-09';

// ---------------------------------------------------------------------------
// sync.ts: the hydration path
// ---------------------------------------------------------------------------

const { mockFrom, mockSupabase } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return { mockFrom, mockSupabase: { from: mockFrom, rpc: vi.fn() } };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/records', () => ({
  fetchRecordsResultFromDB: vi.fn(async () => ({ ok: true, records: [] })),
}));
vi.mock('@/lib/events', () => ({
  fetchEventsResultFromDB: vi.fn(async () => ({ ok: true, events: [] })),
}));
vi.mock('@/lib/trips', () => ({
  fetchTripsResultFromDB: vi.fn(async () => ({ ok: true, trips: [] })),
}));
vi.mock('@/lib/privacy', () => ({
  visibleRecordsForViewer: vi.fn(() => []),
}));

// The shell is irrelevant here and drags in the install banner and the tab bar.
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { fetchFullStateResultFromDB } from '@/lib/sync';
import { computeServiceProgress } from '@/lib/milestones';
import { ServicePage } from '@/pages/ServicePage';

const userId = 'user-001';

function profileRow(militaryInfo: unknown) {
  return {
    id: userId,
    display_name: '춘향',
    role: 'gomsin',
    avatar_path: null,
    onboarding_completed_at: '2026-01-01T00:00:00Z',
    military_info: militaryInfo,
  };
}

/** Minimal `from()` router: profile row present, no couple, no contact row. */
function mockTables(militaryInfo: unknown) {
  mockFrom.mockReset();
  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: profileRow(militaryInfo),
        error: null,
      });
      return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    }
    if (table === 'couple_members') {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) };
    }
    if (table === 'contact_preferences') {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      return { select: () => ({ eq: () => ({ maybeSingle }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

async function militaryFromSync(militaryInfo: unknown): Promise<MilitaryInfo> {
  mockTables(militaryInfo);
  const result = await fetchFullStateResultFromDB(userId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok');
  return result.state.profile!.military;
}

describe('M-1: a profile row without military_info invents nothing', () => {
  it('carries no enlistment or discharge date', async () => {
    const military = await militaryFromSync(null);
    expect(military.enlistmentDate).toBeUndefined();
    expect(military.expectedDischargeDate).toBeUndefined();
    expect(military.dischargeDate).toBeUndefined();
  });

  it('never reproduces the fabricated literal pair', async () => {
    const military = await militaryFromSync(null);
    expect(military.enlistmentDate).not.toBe(FABRICATED_ENLISTMENT);
    expect(military.expectedDischargeDate).not.toBe(FABRICATED_DISCHARGE);
  });

  it("does not claim the discharge date was 'calculated'", async () => {
    const military = await militaryFromSync(null);
    // Provenance must not be asserted for a value that does not exist.
    expect(military.dischargeDateSource).not.toBe('calculated');
    expect(military.dischargeDateSource).toBe('unknown');
  });

  it("reports the service status as 'unknown' rather than 'serving'", async () => {
    const military = await militaryFromSync(null);
    expect(military.militaryStatus).toBe('unknown');
  });

  it('yields no computable D-Day, so no surface can render a fake one', async () => {
    const military = await militaryFromSync(null);
    expect(computeServiceProgress(military, '2026-03-01')).toBeNull();
  });

  it('PRESERVATION: a row WITH military_info is passed through untouched', async () => {
    const stored: MilitaryInfo = {
      branch: 'navy',
      militaryStatus: 'serving',
      enlistmentDate: '2025-06-01',
      expectedDischargeDate: '2027-02-01',
      dischargeDateSource: 'manual',
      memo: '해군',
    };
    const military = await militaryFromSync(stored);
    expect(military).toEqual(stored);
    // ...and it still computes a real D-Day for that user.
    expect(computeServiceProgress(military, '2026-03-01')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// store.tsx DEFAULT_STATE: the local-only path
// ---------------------------------------------------------------------------

describe('M-1: DEFAULT_STATE seeds no service period either', () => {
  const storeSource = readFileSync(
    resolve(process.cwd(), 'src/lib/store.tsx'),
    'utf8',
  );

  it('contains neither fabricated date literal', () => {
    expect(storeSource).not.toContain(FABRICATED_ENLISTMENT);
    expect(storeSource).not.toContain(FABRICATED_DISCHARGE);
  });

  it("declares the default military block as unknown on both axes", () => {
    const at = storeSource.indexOf('const DEFAULT_STATE');
    expect(at).toBeGreaterThan(-1);
    const block = storeSource.slice(at, at + 1600);
    expect(block).toContain("militaryStatus: 'unknown'");
    expect(block).toContain("dischargeDateSource: 'unknown'");
    expect(block).not.toContain('enlistmentDate:');
    expect(block).not.toContain('expectedDischargeDate:');
  });

  it('sync.ts no longer contains either literal', () => {
    const syncSource = readFileSync(resolve(process.cwd(), 'src/lib/sync.ts'), 'utf8');
    // The comment explaining the fix names them; the fallback object must not.
    const at = syncSource.indexOf('profileData.military_info ||');
    expect(at).toBeGreaterThan(-1);
    const fallback = syncSource.slice(at, syncSource.indexOf('}', at) + 1);
    expect(fallback).not.toContain(FABRICATED_ENLISTMENT);
    expect(fallback).not.toContain(FABRICATED_DISCHARGE);
    expect(fallback).not.toContain("dischargeDateSource: 'calculated'");
  });
});

// ---------------------------------------------------------------------------
// ServicePage: the surface that showed the fake D-Day
// ---------------------------------------------------------------------------

const updateProfile = vi.fn();
let currentMilitary: MilitaryInfo;

function stateWithMilitary(military: MilitaryInfo): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: userId, email: 'a@b.c', provider: 'google' },
    profile: {
      id: userId,
      myName: '몽룡',
      role: 'soldier',
      couple: {
        coupleId: 'couple-1',
        partnerName: '춘향',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military,
      contact: {
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '12:00',
        weekendEnd: '21:00',
        enabled: true,
      },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: ['dday'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as AppState;
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: stateWithMilitary(currentMilitary),
    isReady: true,
    updateProfile,
  }),
}));

describe('M-1: ServicePage renders an honest empty state, not a fake D-Day', () => {
  beforeEach(() => {
    updateProfile.mockReset();
  });

  it('shows the "no service info yet" card when nothing is known', () => {
    currentMilitary = {
      branch: 'army',
      militaryStatus: 'unknown',
      dischargeDateSource: 'unknown',
    };
    render(
      <MemoryRouter>
        <ServicePage />
      </MemoryRouter>,
    );
    expect(screen.getByText('복무 정보가 아직 없어요')).toBeTruthy();
    // No D-Day, no service percentage, and no provenance claim.
    expect(screen.queryByText(/^D-\d+$/)).toBeNull();
    // A percentage is only rendered next to a real number.
    expect(screen.queryByText(/복무율 \d/)).toBeNull();
    expect(screen.queryByText('자동 계산')).toBeNull();
    expect(screen.queryByText('직접 입력')).toBeNull();
  });

  it('PRESERVATION: a user with real dates still sees their D-Day and provenance', () => {
    currentMilitary = {
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2025-03-10',
      expectedDischargeDate: '2026-09-09',
      dischargeDateSource: 'calculated',
    };
    render(
      <MemoryRouter>
        <ServicePage />
      </MemoryRouter>,
    );
    expect(screen.queryByText('복무 정보가 아직 없어요')).toBeNull();
    expect(screen.getByText('자동 계산')).toBeTruthy();
    expect(screen.getByText(/복무율 \d/)).toBeTruthy();
  });
});
