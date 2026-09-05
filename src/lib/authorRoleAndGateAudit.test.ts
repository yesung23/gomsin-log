import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two audit items that were flagged UNCONFIRMED and turned out NOT to be
 * defects. Pinned here so the properties that make them safe cannot silently
 * disappear -- both would be serious if they ever did.
 *
 * M-9 (suspected High): does the realtime records-slice refresh recompute
 * `authorRole`? `records.ts` sets a placeholder `'gomsin'` on every row because
 * the couple-scoped query does not know who is viewing, and `sync.ts` fixes it up
 * from `user_id`. Had the realtime refresh path skipped that step, a partner's
 * record would have rendered as the viewer's own after a live update -- and worse,
 * `visibleRecordsForViewer` keys off the same value, so an author-only row could
 * have been mis-scoped.
 *
 * VERDICT: not a defect. `store.tsx` recomputes it identically to `sync.ts` AND
 * re-applies `visibleRecordsForViewer`, in both the full-refresh path and the
 * realtime slice path.
 *
 * M-10 (suspected gate bypass): are the `profiles` and `contact_preferences`
 * upserts in `OnboardingPage.finishSetup()` issued outside the pre-flight
 * deletion gate? They are not enumerated in `gatePathCoverage.test.ts` or
 * `serverCallGate.test.ts`.
 *
 * VERDICT: not a defect, and not an exemption either. `finishSetup()` runs its
 * authority read, profile/contact writes, nested anniversary write and local
 * reconciliation inside one `runServerMutationBehindDeletionBarrier()` callback.
 * The callback receives one shared lease and reuses it for the nested helper, so
 * deletion cannot begin between a boolean pre-flight and the final write.
 */

const store = readFileSync(resolve(process.cwd(), 'src/lib/store.tsx'), 'utf8');
const sync = readFileSync(resolve(process.cwd(), 'src/lib/sync.ts'), 'utf8');
const records = readFileSync(resolve(process.cwd(), 'src/lib/records.ts'), 'utf8');
const onboarding = readFileSync(resolve(process.cwd(), 'src/pages/OnboardingPage.tsx'), 'utf8');

/** The exact recomputation, ignoring which identifier holds the viewer's id. */
const AUTHOR_ROLE_RECOMPUTE =
  /authorRole:\s*record\.userId === [\w.]+\s*\?\s*(?:profile\.)?role\s*:\s*partnerRole/g;

const PARTNER_ROLE_DERIVATION =
  /partnerRole(?::\s*Role)?\s*=\s*(?:profile\.)?role === 'gomsin'\s*\?\s*'soldier'\s*:\s*'gomsin'/;

describe('M-9: authorRole is recomputed on every path that loads records', () => {
  it('records.ts really does hand out a placeholder that must be fixed up', () => {
    // If this stopped being true the recomputation would be unnecessary, and the
    // reasoning below would need revisiting rather than silently passing.
    expect(records).toMatch(/authorRole:\s*'gomsin',\s*\/\/ recomputed from user_id in sync\.ts/);
  });

  it('sync.ts recomputes it during hydration', () => {
    expect(sync.match(AUTHOR_ROLE_RECOMPUTE)?.length).toBe(1);
    expect(sync).toMatch(PARTNER_ROLE_DERIVATION);
  });

  it('store.tsx recomputes it on BOTH the full refresh and the realtime slice', () => {
    // Two sites: reconcile/full refresh, and the realtime `slice === 'records'`
    // branch. This is the assertion that would have caught M-9 had it been real.
    expect(store.match(AUTHOR_ROLE_RECOMPUTE)?.length).toBe(2);
    expect(store).toMatch(PARTNER_ROLE_DERIVATION);
  });

  it('the realtime records branch specifically recomputes it', () => {
    const at = store.indexOf("if (slice === 'records')");
    expect(at).toBeGreaterThan(-1);
    const branch = store.slice(at, at + 1400);
    expect(branch).toMatch(AUTHOR_ROLE_RECOMPUTE);
    // ...and never trusts the placeholder that came off the wire.
    expect(branch).not.toMatch(/authorRole:\s*'gomsin'/);
  });

  it('every recomputation is paired with a visibility re-filter', () => {
    // `visibleRecordsForViewer` reads authorRole, so the order matters: filtering
    // before the fix-up would scope rows using the placeholder.
    const at = store.indexOf("if (slice === 'records')");
    const branch = store.slice(at, at + 1400);
    expect(branch).toContain('visibleRecordsForViewer(');
    const filterAt = branch.indexOf('visibleRecordsForViewer(');
    const recomputeAt = branch.search(AUTHOR_ROLE_RECOMPUTE);
    expect(filterAt).toBeLessThan(recomputeAt);
    expect(sync).toContain('visibleRecordsForViewer(');
  });

  it('the viewer id used is the authenticated user, not the record author', () => {
    const at = store.indexOf("if (slice === 'records')");
    const branch = store.slice(at, at + 1400);
    expect(branch).toContain('record.userId === authUserId');
    expect(branch).toContain('{ userId: authUserId, role }');
  });
});

describe('M-10: onboarding holds the operation-lifetime deletion barrier', () => {
  const finishAt = onboarding.indexOf('const finishSetup = async ()');
  const barrierAt = onboarding.indexOf(
    'runServerMutationBehindDeletionBarrier(async ({ lease, assertCurrent }) => {',
    finishAt,
  );
  const barrierEnd = onboarding.indexOf('}, { expectedUserId: userId });', barrierAt);

  it('finishSetup enters the operation-lifetime barrier', () => {
    expect(finishAt).toBeGreaterThan(-1);
    expect(barrierAt).toBeGreaterThan(finishAt);
    expect(barrierEnd).toBeGreaterThan(barrierAt);
    expect(onboarding).toContain(
      'runServerMutationBehindDeletionBarrier,',
    );
  });

  it('the profiles upsert is inside the held barrier', () => {
    const profileAt = onboarding.indexOf("supabase!.from('profiles').upsert(");
    expect(profileAt).toBeGreaterThan(-1);
    expect(barrierAt).toBeLessThan(profileAt);
    expect(profileAt).toBeLessThan(barrierEnd);
  });

  it('the contact_preferences upsert is inside the held barrier', () => {
    const contactAt = onboarding.indexOf("supabase!.from('contact_preferences').upsert(");
    expect(contactAt).toBeGreaterThan(-1);
    expect(barrierAt).toBeLessThan(contactAt);
    expect(contactAt).toBeLessThan(barrierEnd);
  });

  it('the anniversary write is inside the barrier and reuses its lease', () => {
    const anniversaryAt = onboarding.indexOf('saveCoupleAnniversary(');
    expect(anniversaryAt).toBeGreaterThan(-1);
    expect(barrierAt).toBeLessThan(anniversaryAt);
    expect(anniversaryAt).toBeLessThan(barrierEnd);
    expect(onboarding.slice(anniversaryAt, anniversaryAt + 120)).toContain('lease');
  });

  it('no server write in finishSetup precedes the held barrier', () => {
    const beforeGate = onboarding.slice(finishAt, barrierAt);
    expect(beforeGate).not.toContain('.upsert(');
    expect(beforeGate).not.toContain('.insert(');
    expect(beforeGate).not.toContain('.update(');
    expect(beforeGate).not.toContain('.delete(');
    expect(beforeGate).not.toContain('saveCoupleAnniversary(');
  });

  it('local state is only mirrored after the server write succeeded', () => {
    // The barrier is worthless if the client marks onboarding complete anyway.
    const profileAt = onboarding.indexOf("supabase!.from('profiles').upsert(");
    const setCompleteAt = onboarding.indexOf('setSetupComplete(true);');
    expect(profileAt).toBeGreaterThan(-1);
    expect(setCompleteAt).toBeGreaterThan(profileAt);
  });
});
