import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord } from '@/types';

/**
 * The conversation home.
 *
 * Two things are being guarded, and only one of them is visual.
 *
 * 1. It is a SECOND PRESENTATION, not a second product. It must read through the
 *    same privacy filter as the dashboard, so a private record and an unconfirmed
 *    feeling cannot reach a partner's screen through a new door.
 * 2. It is not chat. PRODUCT_V3 §12.1 freezes in-app chat for V1 and §16 lists a
 *    general messenger as a non-goal. Drawing existing records in a familiar shape
 *    is allowed; growing a send path is not, and a chat SHAPE is exactly the thing
 *    that invites one.
 */

const setHighlightedRecordId = vi.fn();

function record(partial: Partial<DailyRecord> & { id: string }): DailyRecord {
  return {
    date: '2026-08-20',
    time: '09:00',
    authorRole: 'gomsin',
    log: '기록',
    isPrivate: false,
    createdAt: '2026-08-20T00:00:00.000Z',
    ...partial,
  };
}

const MINE = record({
  id: 'mine-1', userId: 'me', authorRole: 'gomsin', time: '08:00', log: '내가 쓴 것',
});
const PARTNERS = record({
  id: 'theirs-1', userId: 'them', authorRole: 'soldier', time: '10:00', log: '상대가 쓴 것',
});
const PARTNERS_PRIVATE = record({
  id: 'theirs-private', userId: 'them', authorRole: 'soldier', time: '11:00',
  log: '상대의 비공개 기록', isPrivate: true,
});

let records: DailyRecord[] = [];

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'me', email: 'a@b.c', provider: 'google' },
    profile: {
      id: 'me',
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1', partnerName: '몽룡', anniversaryDate: '2025-01-01',
        coupleCode: '', connected: true, status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
    homeStyle: 'conversation',
  };
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: makeState(), isReady: true, setHighlightedRecordId }),
}));
vi.mock('@/components/CoupleStatusBanner', () => ({ CoupleStatusBanner: () => null }));

const { ConversationHome } = await import('@/features/home/ConversationHome');

function renderHome(given: DailyRecord[]) {
  records = given;
  return render(<MemoryRouter><ConversationHome /></MemoryRouter>);
}

const bubbles = () => screen.queryAllByTestId('conversation-bubble');

describe('it shows the exchange, and only what the viewer may see', () => {
  it('places the viewer\'s own records opposite the partner\'s', () => {
    renderHome([MINE, PARTNERS]);
    const sides = bubbles().map((b) => b.getAttribute('data-mine'));
    expect(sides).toEqual(['true', 'false']);
  });

  it('orders oldest first, the way a backlog is read', () => {
    renderHome([PARTNERS, MINE]);
    expect(screen.getByText('내가 쓴 것')).toBeInTheDocument();
    const texts = bubbles().map((b) => b.textContent);
    expect(texts[0]).toContain('내가 쓴 것');
    expect(texts[1]).toContain('상대가 쓴 것');
  });

  /**
   * The one that matters. A new surface reading records is a new place for the
   * privacy rule to be missing, so this asserts on the OUTPUT rather than trusting
   * that the right helper was called.
   */
  it('never renders a partner\'s private record', () => {
    renderHome([PARTNERS, PARTNERS_PRIVATE]);
    expect(screen.queryByText('상대의 비공개 기록')).not.toBeInTheDocument();
    expect(bubbles()).toHaveLength(1);
  });

  it('says what to do next when there is nothing yet', () => {
    renderHome([]);
    expect(bubbles()).toHaveLength(0);
    // An empty screen is an invitation to act, not a description of absence.
    expect(screen.getByText(/눌러 오늘 있었던 일을 남겨보세요/)).toBeInTheDocument();
  });
});

describe('every bubble still reaches the exact original', () => {
  it('offers an open control on a record with no text at all', () => {
    // A media-only record has no text to tap, and it must not become the one kind
    // of record the conversation cannot open.
    renderHome([record({ id: 'media-only', userId: 'them', authorRole: 'soldier', log: '' })]);
    expect(screen.getByRole('button', { name: /기록 원본 열기/ })).toBeInTheDocument();
  });
});

/**
 * Source-level, because these are absences and an absence cannot be clicked.
 */
describe('it is a presentation, not a messenger', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/features/home/ConversationHome.tsx'),
    'utf8',
  );

  it('has no send path of any kind', () => {
    for (const forbidden of [/sendMessage/i, /addMessage/i, /messages?Repository/i, /<textarea/i, /<input/i]) {
      expect(source, `unexpected messaging affordance: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('reads records through the shared privacy filter rather than its own', () => {
    expect(source).toContain('visibleRecordsForViewer');
    // A hand-rolled `isPrivate` test here would be a second copy of the rule, and
    // a second place for it to drift from the one the dashboard uses.
    expect(source).not.toMatch(/\.filter\([^)]*!\w+\.isPrivate/);
  });

  it('derives its summary from the deterministic function, not a model', () => {
    expect(source).toContain('generateDailySummary');
    for (const forbidden of [/fetch\(/, /openai/i, /completion/i, /\bprompt\b/i]) {
      expect(source, `unexpected inference call: ${forbidden}`).not.toMatch(forbidden);
    }
  });
});
