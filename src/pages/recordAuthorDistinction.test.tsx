import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppState, DailyRecord, RelationshipContext } from '@/types';
import { recordAuthorPresentation, ROLE_EMOJI, ROLE_LABEL } from '@/lib/recordAuthor';

/**
 * Bug condition:
 *   isBugCondition(timeline) = the card for a 군화 record and the card for a 곰신
 *                              record are rendered with the same class string, so
 *                              nothing but an 11px muted name distinguishes them.
 *
 * Measured on the unfixed tree, `src/pages/RecordPage.tsx`:
 *
 *   const isOwn = r.authorRole === profile.role;
 *   className={cn('rounded-2xl bg-card border p-4 shadow-sm ...', isHighlighted ? ... : 'border-border/60')}
 *   <span className="text-muted-foreground/70">{isOwn ? '나' : partnerDisplayName}</span>
 *
 * `isOwn` reached exactly one thing: the name. Surface, border, width, position
 * and text colour were byte-identical for both authors. On a date both people
 * wrote on -- the normal case for this app -- reading the timeline meant reading
 * that label on every single card.
 *
 * Nothing caught it: 1,184 tests, typecheck, lint and the build all passed while
 * the two authors were visually indistinguishable, because no test compared one
 * author's card with the other's.
 *
 * The fix uses three independent channels (hue / position / text). This file
 * asserts each one separately, so removing any single channel fails a test rather
 * than silently degrading the screen to colour-only -- which would break WCAG 2.1
 * SC 1.4.1 for the ~8% of men in the target audience with a colour vision
 * deficiency.
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-07-31';

const setHighlightedRecordId = vi.fn();

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
    updateRecord: vi.fn(async () => ({ ok: true as const })),
    deleteRecord: vi.fn(async () => ({ ok: true as const })),
    updateRecordMedia: vi.fn(async () => ({ ok: true as const, failedFiles: [] as string[] })),
    setHighlightedRecordId,
    markTalkAbout: vi.fn(async () => ({ ok: true })),
    unmarkTalkAbout: vi.fn(async () => ({ ok: true })),
    resolveTalkAbout: vi.fn(async () => ({ ok: true })),
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '오늘의 기록',
    isPrivate: false,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

/** The viewer is a 군화; the partner writing alongside them is a 곰신. */
function makeState(
  records: DailyRecord[],
  relationshipContext: RelationshipContext = 'military',
): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '몽룡',
      role: 'soldier',
      couple: {
        coupleId: 'couple-1',
        relationshipContext,
        partnerName: '춘향',
        anniversaryDate: '2025-01-01',
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

function renderPage(
  records: DailyRecord[],
  relationshipContext: RelationshipContext = 'military',
) {
  currentState = makeState(records, relationshipContext);
  // Noon UTC is 21:00 KST the same day, so `localToday()` resolves to TODAY.
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  return render(
    <MemoryRouter initialEntries={['/record']}>
      <RecordPage />
    </MemoryRouter>,
  );
}

/** The two cards under test: one written by the viewer, one by the partner. */
const MINE = record({
  id: 'rec-mine',
  userId: ME,
  authorRole: 'soldier',
  time: '08:00',
  log: '점호 끝나고 잠깐 생각났어',
});
const THEIRS = record({
  id: 'rec-theirs',
  userId: PARTNER,
  authorRole: 'gomsin',
  time: '21:00',
  log: '오늘 하루도 잘 버텼어',
});

function cardOf(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`#record-${id}`);
  if (!element) throw new Error(`no card rendered for ${id}`);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setHighlightedRecordId.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('the timeline tells 군화 and 곰신 apart', () => {
  it('renders the two authors with different class strings', async () => {
    const { container } = renderPage([MINE, THEIRS]);
    await screen.findByText('08:00');

    /*
     * The bug condition itself, stated as an assertion -- restated for the
     * editorial timeline.
     *
     * It used to be enough to compare the two cards' own `className`, because the
     * distinction lived on the card element: `ml-auto` / `mr-auto` plus
     * `max-w-[94%]` was the ownership channel. The 2026-08-08 revision replaced that
     * chat-bubble indentation with a fixed time column, so the row WRAPPER is now
     * deliberately identical for both authors and the three channels live on its
     * descendants (hue stripe, marker dot, attribution chip).
     *
     * So the signature is taken across every element in the row. This is strictly
     * stronger than the original: it fails if the authors differ only by the name
     * text, which is exactly the defect this file was written for.
     */
    const classSignature = (id: string) =>
      [...cardOf(container, id).querySelectorAll('*')]
        .map((node) => node.getAttribute('class') ?? '')
        .join('|');

    expect(classSignature('rec-mine')).not.toBe(classSignature('rec-theirs'));
  });

  it('channel 1 -- hue: each role gets its own accent stripe', async () => {
    const { container } = renderPage([MINE, THEIRS]);
    await screen.findByText('08:00');

    const stripe = (id: string) =>
      cardOf(container, id).querySelector('[aria-hidden="true"]')?.className ?? '';

    // 군화 is info-blue, 곰신 is coral. Both are theme tokens with a light AND a
    // dark value, so the accent survives a theme switch.
    expect(stripe('rec-mine')).toContain('bg-info');
    expect(stripe('rec-theirs')).toContain('bg-coral');
    expect(stripe('rec-mine')).not.toBe(stripe('rec-theirs'));
  });

  it('channel 2 -- geometry: own records get a filled dot, partner gets a hollow ring', async () => {
    /**
     * The editorial timeline replaced the chat-bubble indentation (ml-auto /
     * mr-auto / max-w-[94%]) with a fixed-column layout where the time column at
     * 44px is the anchor. Indentation destroyed that column, so the second non-
     * colour channel is now SHAPE: the viewer’s dot is filled (bg-foreground),
     * the partner’s is a hollow ring (border-foreground bg-transparent). Both are
     * the same diameter, so the difference is geometry, not size.
     */
    const { container } = renderPage([MINE, THEIRS]);
    await screen.findByText('08:00');

    const mineCard = cardOf(container, 'rec-mine');
    const theirsCard = cardOf(container, 'rec-theirs');

    const markerOf = (card: HTMLElement) => {
      const ariaHiddenSpans = [...card.querySelectorAll('span[aria-hidden="true"]')];
      const markerContainer = ariaHiddenSpans.find((span) =>
        span.className.includes('flex-col') && span.className.includes('items-center')
      );
      return markerContainer?.querySelector('span') ?? null;
    };

    const myMarker = markerOf(mineCard);
    const theirMarker = markerOf(theirsCard);

    expect(myMarker).not.toBeNull();
    expect(theirMarker).not.toBeNull();

    // Own record: filled dot (has bg-foreground, no border class)
    expect(myMarker!.className).toContain('bg-foreground');
    expect(myMarker!.className).not.toContain('border');

    // Partner record: hollow ring (has border-foreground, bg-transparent)
    expect(theirMarker!.className).toContain('border');
    expect(theirMarker!.className).toContain('bg-transparent');

    // The two marker classes differ
    expect(myMarker!.className).not.toBe(theirMarker!.className);
  });

  it('channel 3 -- text: the role is written out, never colour-only', async () => {
    renderPage([MINE, THEIRS]);

    // WCAG 1.4.1. A reader who cannot separate coral from blue still gets the role
    // as words and as the emoji onboarding already taught.
    expect(await screen.findByText('🪖 군화 · 나')).toBeInTheDocument();
    expect(screen.getByText('🌸 곰신 · 춘향')).toBeInTheDocument();
  });

  it('channel 3 -- text: a screen reader gets a sentence, not the emoji chip', async () => {
    const { container } = renderPage([MINE, THEIRS]);
    await screen.findByText('08:00');

    // Read aloud, `🌸 곰신 · 춘향` is "cherry blossom 곰신 middle dot 춘향". So the
    // chip is aria-hidden and an sr-only sentence carries the same fact. Both must
    // hold: a visible-only chip leaves the author unannounced, and a chip left in
    // the a11y tree makes the card announce it twice.
    for (const [id, sentence] of [
      ['rec-mine', '군화 나가 남긴 기록'],
      ['rec-theirs', '곰신 춘향가 남긴 기록'],
    ] as const) {
      const card = cardOf(container, id);
      /*
       * The chip is the span that paints the `·` ITSELF, not any ancestor whose
       * subtree happens to contain it.
       *
       * The old finder took the first `<span>` whose textContent included `·`, which
       * worked while the row's wrappers were `<div>`s. In the editorial row the
       * opener is a `<button>`, so every wrapper inside it had to become a `<span>` --
       * a button may not contain a div's block semantics -- and `querySelectorAll`
       * returns document order, so an ancestor wrapper now matched first and reported
       * `aria-hidden: null`. Matching on the element's own text node finds the chip
       * regardless of how the row is wrapped.
       */
      const chip = [...card.querySelectorAll('span')].find((span) =>
        [...span.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').includes('·'),
        ),
      );
      expect(chip?.getAttribute('aria-hidden')).toBe('true');
      expect([...card.querySelectorAll('.sr-only')].map((node) => node.textContent)).toContain(
        sentence,
      );
    }
  });

  it('exposes the author on the DOM so the distinction is queryable', async () => {
    const { container } = renderPage([MINE, THEIRS]);
    await screen.findByText('08:00');

    expect(cardOf(container, 'rec-mine').dataset.authorRole).toBe('soldier');
    expect(cardOf(container, 'rec-mine').dataset.authorOwn).toBe('true');
    expect(cardOf(container, 'rec-theirs').dataset.authorRole).toBe('gomsin');
    expect(cardOf(container, 'rec-theirs').dataset.authorOwn).toBe('false');
  });

  it('names the author in the detail modal too', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage([MINE, THEIRS]);

    await user.click(await screen.findByText('21:00'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // Two now: the timeline chip and the modal chip.
    expect(screen.getAllByText('🌸 곰신 · 춘향').length).toBe(2);
    // And the modal carries the spoken sentence as well, so opening a card does not
    // drop the attribution for a screen reader.
    const dialog = screen.getByRole('dialog');
    expect([...dialog.querySelectorAll('.sr-only')].map((node) => node.textContent)).toContain(
      '곰신 춘향가 남긴 기록',
    );
  });

  it('keeps the author accent readable on the highlighted card', async () => {
    const { container } = renderPage([MINE, THEIRS]);
    await screen.findByText('08:00');

    // The highlight is a ring around the whole card; the author accent is an edge
    // stripe. Different geometry, so one cannot mask the other. The old code put
    // `bg-coral/5` on the highlighted card, which would have read as the 곰신 tint.
    const mine = cardOf(container, 'rec-mine');
    expect(mine.className).not.toContain('bg-coral/5');
    expect(mine.querySelector('[aria-hidden="true"]')?.className).toContain('bg-info');
  });

  it('is covered by the project-wide theme-token guard', () => {
    // Asserting membership rather than re-implementing the regex: one guard, one
    // definition. `src/lib/themeTokens.test.ts` is where the rule lives.
    const guard = readFileSync(resolve(process.cwd(), 'src/lib/themeTokens.test.ts'), 'utf8');
    const occurrences = guard.match(/'src\/lib\/recordAuthor\.ts'/g) ?? [];
    // Once in the C4 palette-literal list and once in the C5 text-navy list.
    expect(occurrences.length).toBe(2);
  });

  it('PRESERVATION: the time label still opens the record', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage([MINE, THEIRS]);

    await user.click(await screen.findByText('08:00'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // Owner-only controls still appear on an own record.
    expect(screen.getByText('수정')).toBeInTheDocument();
  });

  it('PRESERVATION: the partner’s record still hides the owner-only controls', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage([MINE, THEIRS]);

    await user.click(await screen.findByText('21:00'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.queryByText('수정')).not.toBeInTheDocument();
    expect(screen.queryByText('삭제')).not.toBeInTheDocument();
  });

  it('PRESERVATION: a private own record still shows its 나에게만 badge', async () => {
    renderPage([record({ id: 'rec-private', userId: ME, authorRole: 'soldier', time: '07:00', isPrivate: true })]);

    expect(await screen.findByText('나에게만')).toBeInTheDocument();
  });
});

describe('the general-couple timeline uses neutral author language', () => {
  it('shows identity without exposing military slot labels or emoji', async () => {
    const { container } = renderPage([MINE, THEIRS], 'general');
    await screen.findByText('08:00');

    expect(screen.getByText('나')).toBeInTheDocument();
    expect(screen.getByText('춘향')).toBeInTheDocument();
    expect(screen.queryByText(/군화|곰신|🪖|🌸/)).toBeNull();

    const mine = cardOf(container, 'rec-mine');
    const theirs = cardOf(container, 'rec-theirs');
    expect(mine.querySelector('.sr-only')).toHaveTextContent('내가 남긴 기록');
    expect(theirs.querySelector('.sr-only')).toHaveTextContent('춘향의 기록');
    expect(mine.querySelector('[aria-hidden="true"]')?.className)
      .not.toBe(theirs.querySelector('[aria-hidden="true"]')?.className);
  });
});

describe('recordAuthorPresentation', () => {
  const viewer = { userId: ME, role: 'soldier' as const };

  it('prefers the server identity over the role when both sides have one', () => {
    // A stale role can disagree with the immutable author id. Comparing roles
    // would then re-attribute records the viewer really did write.
    const presentation = recordAuthorPresentation(
      { userId: ME, authorRole: 'gomsin' },
      viewer,
      '춘향',
    );
    expect(presentation.isOwn).toBe(true);
    expect(presentation.displayName).toBe('나');
    // The ROLE is still the record's own, so the hue does not lie about who wrote it.
    expect(presentation.role).toBe('gomsin');
    expect(presentation.attribution).toBe('🌸 곰신 · 나');
  });

  it('falls back to the role for a queued offline row without a server identity', () => {
    const presentation = recordAuthorPresentation(
      { authorRole: 'soldier' },
      { role: 'soldier' },
      '춘향',
    );
    expect(presentation.isOwn).toBe(true);
    expect(presentation.attribution).toBe('🪖 군화 · 나');
  });

  it('stays neutral rather than guessing when the role is missing', () => {
    // Legacy and imported rows can arrive without `authorRole` even though the
    // type declares it. Attributing those words to the wrong person is worse than
    // showing no role at all.
    const presentation = recordAuthorPresentation(
      { userId: PARTNER, authorRole: undefined as never },
      viewer,
      '춘향',
    );
    expect(presentation.role).toBeNull();
    expect(presentation.roleLabel).toBeNull();
    expect(presentation.attribution).toBe('춘향');
    expect(presentation.stripeClass).toBe('bg-border');
  });

  it('gives assistive tech a full sentence, not a chip fragment', () => {
    expect(
      recordAuthorPresentation({ userId: PARTNER, authorRole: 'gomsin' }, viewer, '춘향').srAttribution,
    ).toBe('곰신 춘향가 남긴 기록');
  });

  it('keeps the role vocabulary in one place', () => {
    // These strings are duplicated as inline ternaries in SettingsPage and MyPage;
    // the table is the single definition new code should reach for.
    expect(ROLE_LABEL).toEqual({ gomsin: '곰신', soldier: '군화' });
    expect(ROLE_EMOJI).toEqual({ gomsin: '🌸', soldier: '🪖' });
  });

  it('uses ownership and names, not military vocabulary, for a general couple', () => {
    const mine = recordAuthorPresentation(
      { userId: ME, authorRole: 'soldier' },
      viewer,
      '춘향',
      'general',
    );
    const theirs = recordAuthorPresentation(
      { userId: PARTNER, authorRole: 'gomsin' },
      viewer,
      '춘향',
      'general',
    );

    expect(mine).toMatchObject({
      roleLabel: null,
      roleEmoji: null,
      attribution: '나',
      srAttribution: '내가 남긴 기록',
    });
    expect(theirs).toMatchObject({
      roleLabel: null,
      roleEmoji: null,
      attribution: '춘향',
      srAttribution: '춘향의 기록',
    });
    expect(mine.stripeClass).not.toBe(theirs.stripeClass);
    expect(`${mine.attribution}${theirs.attribution}${mine.srAttribution}${theirs.srAttribution}`)
      .not.toMatch(/군화|곰신|🪖|🌸/);
  });

  it('assigns hue by role, so the same person is the same colour on both phones', () => {
    const asSoldierViewer = recordAuthorPresentation(
      { userId: PARTNER, authorRole: 'gomsin' },
      { userId: ME, role: 'soldier' },
      '춘향',
    );
    const asGomsinHerself = recordAuthorPresentation(
      { userId: PARTNER, authorRole: 'gomsin' },
      { userId: PARTNER, role: 'gomsin' },
      '몽룡',
    );
    expect(asSoldierViewer.stripeClass).toBe(asGomsinHerself.stripeClass);
    // Ownership, and only ownership, determines the marker shape.
    // The editorial timeline replaced position-based indentation with geometry:
    // filled dot for own, hollow ring for partner.
    expect(asSoldierViewer.markerClass).toContain('border');
    expect(asSoldierViewer.markerClass).toContain('bg-transparent');
    expect(asGomsinHerself.markerClass).toContain('bg-foreground');
    expect(asGomsinHerself.markerClass).not.toContain('border');
  });
});
