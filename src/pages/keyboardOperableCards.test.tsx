import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppState, DailyRecord } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(app) = a card that performs an action is a `<div onClick>`, so
 *                         it is in no tab order, answers no key, and is announced
 *                         as plain text.
 *
 * Measured on the tree before this file existed, three surfaces were pointer-only:
 *
 *   src/pages/RecordPage.tsx        the whole timeline card -- the ONLY way to open
 *                                   a record, on the screen the app is named after
 *   src/pages/UsPage.tsx            every trip row, and the empty-state 새로운 여행
 *                                   계획하기 card
 *   src/components/widgets/DDayWidget.tsx
 *                                   the connection card, which navigates to
 *                                   settings while the anniversary is unset
 *
 * This is the same defect class an earlier pass already fixed elsewhere:
 * `WidgetWrapper`'s drag handle and `AddWidgetBottomSheet`'s rows were converted
 * from divs to buttons, and `accessibilityInvariants.test.ts` records why. That
 * pass simply never looked at these three files, and its assertions were written
 * per-file, so nothing generalised. Hence the scan below: it is keyed on the
 * PATTERN, not on the three files that happened to have it, so the next one fails
 * a test the moment it is written.
 *
 * The record card additionally could not simply become a `<button>`: an attachment
 * renders `<video controls>` / `<audio controls>`, and a button may not contain a
 * control. The card-level handler also caught taps aimed at those controls and
 * opened the modal over the clip the user had just started. So the opener covers
 * the card's text and the media stays outside it.
 */

const SRC = resolve(process.cwd(), 'src');

/** Elements that are keyboard-operable on their own. */
const INTERACTIVE_TAGS = new Set([
  'a',
  'audio',
  'button',
  'details',
  'input',
  'label',
  'option',
  'select',
  'summary',
  'textarea',
  'video',
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Collect every opening tag of a lowercase (i.e. DOM, not component) element.
 *
 * Written as a brace- and quote-aware walk rather than a regex because the
 * attributes contain arrow functions: `onClick={() => navigate('/trips')}` has a
 * `>` inside it, so `<div[^>]*>` stops in the middle of the tag and reports
 * nothing. That is exactly how a scan like this silently passes.
 */
function domOpeningTags(source: string): { tag: string; attrs: string; line: number }[] {
  const found: { tag: string; attrs: string; line: number }[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '<') continue;
    const name = /^<([a-z][a-zA-Z0-9]*)[\s/>]/.exec(source.slice(i, i + 24));
    if (!name) continue;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let j = i + 1 + name[1].length; j < source.length; j += 1) {
      const char = source[j];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) continue;
    found.push({
      tag: name[1],
      attrs: source.slice(i + 1 + name[1].length, end),
      line: source.slice(0, i).split('\n').length,
    });
    i = end;
  }
  return found;
}

describe('nothing in the app is operable by pointer only', () => {
  it('finds the tags it is supposed to find', () => {
    // A scanner that reports nothing looks identical to a clean tree, so it is
    // proven against a fixture first. The arrow function's `>` is the trap.
    const tags = domOpeningTags('<div onClick={() => go(1)} className="x"><p>hi</p></div>');
    expect(tags.map((t) => t.tag)).toEqual(['div', 'p']);
    expect(tags[0].attrs).toContain('onClick=');
  });

  it('no non-interactive element carries a click handler', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const { tag, attrs, line } of domOpeningTags(source)) {
        if (!/\bonClick=/.test(attrs)) continue;
        if (INTERACTIVE_TAGS.has(tag)) continue;
        // A div MAY carry a handler if it is given the full button contract:
        // a role, a tab stop and a key handler. None currently does, and a real
        // <button> is preferable, but the rule should describe the requirement
        // rather than the current implementation.
        const hasButtonContract =
          /role="button"/.test(attrs) && /tabIndex=/.test(attrs) && /onKey(Down|Up|Press)=/.test(attrs);
        if (hasButtonContract) continue;
        // A modal backdrop is the one shape that is legitimately not a control:
        // it is hidden from the accessibility tree on purpose, it duplicates a
        // dismissal that Escape already performs, and giving it a tab stop would
        // put a nameless button in front of the dialog it dims. Both halves are
        // required -- `aria-hidden` alone would exempt any invisible div.
        const isDismissalBackdrop =
          /aria-hidden="true"/.test(attrs) && /useEscapeKey\(/.test(source);
        if (isDismissalBackdrop) continue;
        offenders.push(`${file.slice(SRC.length + 1).replace(/\\/g, '/')}:${line} <${tag}>`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the backdrop exemption is only as wide as its justification', () => {
    // The exemption above is claimed by exactly one element. If a second appears
    // it should be read, not waved through, so the count is pinned here.
    const backdrops: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const { tag, attrs } of domOpeningTags(source)) {
        if (!/\bonClick=/.test(attrs) || INTERACTIVE_TAGS.has(tag)) continue;
        if (/aria-hidden="true"/.test(attrs)) {
          backdrops.push(file.slice(SRC.length + 1).replace(/\\/g, '/'));
        }
      }
    }
    expect(backdrops).toEqual(['components/widgets/AddWidgetBottomSheet.tsx']);
    // And the keyboard equivalent it relies on is real, not assumed.
    expect(readFileSync(resolve(SRC, 'components/widgets/AddWidgetBottomSheet.tsx'), 'utf8'))
      .toContain('useEscapeKey(onClose, isOpen)');
  });
});

/* ------------------------------------------------------------------------- */
/* The three fixed surfaces, proven to work from the keyboard.               */
/* ------------------------------------------------------------------------- */

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-07-31';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: 'live' as const,
    coupleLifecycle: 'connected' as const,
    updateRecord: vi.fn(async () => ({ ok: true as const })),
    deleteRecord: vi.fn(async () => ({ ok: true as const })),
    updateRecordMedia: vi.fn(async () => ({ ok: true as const, failedFiles: [] as string[] })),
    setHighlightedRecordId: vi.fn(),
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');
const { DDayWidget } = await import('@/components/widgets/DDayWidget');

function makeState(records: DailyRecord[], anniversaryDate: string | undefined): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    isDemoMode: false,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '몽룡',
      role: 'soldier',
      couple: {
        coupleId: 'couple-1',
        partnerName: '춘향',
        anniversaryDate,
        coupleCode: '',
        connected: true,
        status: 'active',
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
  } as AppState;
}

const OWN_RECORD: DailyRecord = {
  id: 'rec-mine',
  userId: ME,
  date: TODAY,
  time: '08:00',
  authorRole: 'soldier',
  log: '점호 끝나고 잠깐 생각났어',
  isPrivate: false,
  createdAt: `${TODAY}T08:00:00.000Z`,
};

const PARTNER_RECORD: DailyRecord = {
  ...OWN_RECORD,
  id: 'rec-theirs',
  userId: PARTNER,
  authorRole: 'gomsin',
  time: '21:00',
  log: '오늘 하루도 잘 버텼어',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Element.prototype.scrollIntoView = vi.fn();
});

describe('a record can be opened without a pointer', () => {
  function renderRecordPage(records: DailyRecord[]) {
    currentState = makeState(records, '2025-01-01');
    // Noon UTC is 21:00 KST the same day, so `localToday()` resolves to TODAY.
    vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
    return render(
      <MemoryRouter initialEntries={['/record']}>
        <RecordPage />
      </MemoryRouter>,
    );
  }

  it('exposes each card as a button named after its author', async () => {
    renderRecordPage([OWN_RECORD, PARTNER_RECORD]);

    // The name is the attribution sentence, not "기록" or the raw log text: a
    // screen-reader user listing the buttons on this screen hears whose day each
    // one is before deciding to open it.
    expect(
      await screen.findByRole('button', { name: '군화 나가 남긴 기록 자세히 보기' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '곰신 춘향가 남긴 기록 자세히 보기' }),
    ).toBeInTheDocument();
  });

  it('opens the detail modal on Enter', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderRecordPage([OWN_RECORD]);

    const opener = await screen.findByRole('button', { name: /군화 나가 남긴 기록/ });
    opener.focus();
    expect(opener).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('opens the detail modal on Space', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderRecordPage([OWN_RECORD]);

    const opener = await screen.findByRole('button', { name: /군화 나가 남긴 기록/ });
    opener.focus();
    await user.keyboard(' ');

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('keeps an attachment outside the opener, so a button never nests a control', async () => {
    const { container } = renderRecordPage([
      {
        ...OWN_RECORD,
        attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/rec-mine/a.jpg' }],
      } as DailyRecord,
    ]);
    await screen.findByText('08:00');

    const card = container.querySelector<HTMLElement>('#record-rec-mine');
    const attachment = card?.querySelector('[data-testid="record-attachment"]');
    expect(attachment).not.toBeNull();
    // `<video controls>` inside a <button> is invalid HTML, and a card-level
    // handler swallowed the taps meant for its controls.
    expect(attachment?.closest('button')).toBeNull();
  });

  it('PRESERVATION: a pointer tap on the card body still opens the record', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderRecordPage([OWN_RECORD]);

    await user.click(await screen.findByText('점호 끝나고 잠깐 생각났어'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});

describe('the D-Day connection card offers a control only when it has an action', () => {
  function renderDDay(anniversaryDate: string | undefined) {
    currentState = makeState([], anniversaryDate);
    // The day count is printed, so the clock has to be fixed for it to be
    // assertable at all.
    vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
    return render(
      <MemoryRouter>
        <DDayWidget />
      </MemoryRouter>,
    );
  }

  it('is a named button while the anniversary is unset', () => {
    renderDDay(undefined);

    expect(screen.getByRole('button', { name: '사귄 날짜 설정하기' })).toBeInTheDocument();
    expect(screen.getByText('기념일 미설정')).toBeInTheDocument();
  });

  it('stops pretending to be pressable once the date is known', () => {
    // The old div kept `cursor-pointer` and swallowed every tap while doing
    // nothing, which reads as a broken card rather than a static one.
    const { container } = renderDDay(TODAY);

    expect(screen.queryByRole('button', { name: '사귄 날짜 설정하기' })).not.toBeInTheDocument();
    expect(screen.getByText('연결 1일째')).toBeInTheDocument();
    const card = container.querySelector('.from-lilac');
    expect(card?.className).not.toContain('cursor-pointer');
  });

  it('PRESERVATION: the 복무 현황 card still reaches /service', () => {
    renderDDay(TODAY);
    expect(
      screen.getByRole('button', { name: '복무 현황과 전역 D-Day 보기' }),
    ).toBeInTheDocument();
  });
});
