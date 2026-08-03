import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { classifyServerError } from '@/lib/serverErrors';

/**
 * The 인터넷 연결 contract, enforced across the whole live client.
 *
 * `serverErrors.test.ts` already proves that no CLASSIFIED message mentions
 * 인터넷 연결 unless the kind is `offline`. That guarantee was being bypassed by
 * call sites that never classified at all: they hard-coded "check your internet
 * connection" into a mutation failure toast, so an RLS rejection (`42501`), an
 * expired JWT (`PGRST301`) and an unclassifiable error all told the user to fix a
 * connection that was working. The user then retried forever instead of
 * reconnecting their couple space or signing in again.
 *
 * These are the four sites that still did it when this suite was added:
 *
 *   - `consumeCoupleInvitation()`'s catch in `src/lib/supabase.ts`
 *   - the profile upsert error in `src/pages/OnboardingPage.tsx`
 *   - the final-setup catch in `src/pages/OnboardingPage.tsx`
 *   - the disconnect failure and catch in `src/pages/SettingsPage.tsx`
 *
 * This file scans every live (non-test) client source instead of just those four,
 * because the defect class is "someone writes the phrase by hand", not "these
 * specific lines". Anything new must either classify the error or stay silent
 * about the cause.
 */

const NETWORK_PHRASE = '인터넷 연결';
const SRC_ROOT = resolve(process.cwd(), 'src');

/**
 * Occurrences that are legitimate, each for a reason that is verified by an
 * assertion further down rather than taken on trust.
 */
const ALLOWED_FILES: Record<string, string> = {
  'src/lib/serverErrors.ts':
    'Defines the single offline message and documents the rule; the classifier is the intended source of this phrase.',
  'src/components/OfflineBanner.tsx':
    'Renders only while the device is genuinely offline, so the diagnosis is true by construction.',
  'src/App.tsx':
    'AuthSyncUnavailable picks this copy strictly inside the reason === \'offline\' branch.',
};

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // Test files legitimately assert on the phrase.
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

function relative(file: string): string {
  return file.slice(resolve(process.cwd()).length + 1).replace(/\\/g, '/');
}

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('no live client code invents an internet diagnosis', () => {
  it('only the documented offline-only sites mention 인터넷 연결', () => {
    const offenders = listSourceFiles(SRC_ROOT)
      .filter((file) => readFileSync(file, 'utf8').includes(NETWORK_PHRASE))
      .map(relative)
      .filter((file) => !(file in ALLOWED_FILES));

    expect(offenders).toEqual([]);
  });

  it('every allowlisted file still actually exists and still contains the phrase', () => {
    // Stops the allowlist from silently rotting into a blanket exemption.
    for (const file of Object.keys(ALLOWED_FILES)) {
      expect(read(file), file).toContain(NETWORK_PHRASE);
    }
  });

  it("App.tsx uses the phrase only under reason === 'offline'", () => {
    const app = read('src/App.tsx');
    const line = app
      .split('\n')
      .find((candidate) => candidate.includes(NETWORK_PHRASE) && !candidate.includes('*'));
    expect(line).toBeTruthy();
    // The ternary arm immediately above the copy is the offline test.
    expect(app).toMatch(/reason === 'offline'\s*\n\s*\?\s*'인터넷 연결/);
  });
});

describe('the four repaired mutation paths classify their cause', () => {
  it('consumeCoupleInvitation classifies the thrown error', () => {
    const source = read('src/lib/supabase.ts');
    const block = source.slice(source.indexOf("[gomsinlog] redeem_invitation threw:"));
    expect(block).toContain('classifyServerError(err).message');
    expect(block.slice(0, 400)).not.toContain(NETWORK_PHRASE);
  });

  it('the onboarding profile upsert failure classifies its error', () => {
    const source = read('src/pages/OnboardingPage.tsx');
    expect(source).toContain("import { classifyServerError } from '@/lib/serverErrors';");
    expect(source).toContain(
      '`프로필을 저장하지 못했어요. ${classifyServerError(profileError).message}`',
    );
  });

  it('the onboarding final-setup catch classifies its error', () => {
    const source = read('src/pages/OnboardingPage.tsx');
    expect(source).toContain(
      '`설정을 완료하지 못했어요. ${classifyServerError(error).message}`',
    );
  });

  it('the settings disconnect catch classifies its error', () => {
    const source = read('src/pages/SettingsPage.tsx');
    expect(source).toContain("import { classifyServerError } from '@/lib/serverErrors';");
    expect(source).toContain(
      '`연결을 해제하지 못했어요. ${classifyServerError(error).message}`',
    );
  });

  it('the boolean disconnect failure stays honest instead of inventing a cause', () => {
    // `disconnect()` returns a bare boolean, so the cause is unavailable here.
    // The fix is honest generic copy, NOT a redesign of the store API for copy.
    const source = read('src/pages/SettingsPage.tsx');
    expect(source).toContain("toast.error('연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.');");
  });

  it('PRESERVATION: the success paths are untouched', () => {
    expect(read('src/pages/SettingsPage.tsx')).toContain("toast.success('연결이 해제되었습니다.');");
    // Onboarding still only marks completion after the server write succeeded.
    expect(read('src/pages/OnboardingPage.tsx')).toContain('setSetupComplete(true);');
  });
});

describe('classified copy per kind, as the repaired sites now render it', () => {
  const cases = [
    { label: 'RLS rejection', error: { code: '42501', message: 'permission denied' }, kind: 'forbidden' },
    { label: 'expired session', error: { code: 'PGRST301', message: 'JWT expired' }, kind: 'auth_expired' },
    { label: 'missing target', error: { code: 'PGRST116', message: 'no rows' }, kind: 'not_found' },
    { label: 'server failure', error: { status: 500, message: 'boom' }, kind: 'server' },
    { label: 'unclassifiable failure', error: { message: 'something odd' }, kind: 'unknown' },
  ] as const;

  for (const { label, error, kind } of cases) {
    it(`a ${label} is never described as an internet failure`, () => {
      const classified = classifyServerError(error, { online: true });
      expect(classified.kind).toBe(kind);
      expect(classified.message).not.toContain(NETWORK_PHRASE);
      // The prefixed form the call sites build must also stay clean.
      expect(`프로필을 저장하지 못했어요. ${classified.message}`).not.toContain(NETWORK_PHRASE);
      expect(`연결을 해제하지 못했어요. ${classified.message}`).not.toContain(NETWORK_PHRASE);
      expect(`초대 코드를 확인하지 못했습니다. ${classified.message}`).not.toContain(NETWORK_PHRASE);
    });
  }

  it('a real offline classification may still mention the connection', () => {
    // The contract forbids a FALSE diagnosis, not a true one.
    const offline = classifyServerError(new TypeError('Failed to fetch'), { online: false });
    expect(offline.kind).toBe('offline');
    expect(offline.message).toContain(NETWORK_PHRASE);
  });

  it('a dead network detected while the error is shapeless is still offline', () => {
    const offline = classifyServerError({ message: 'something odd' }, { online: false });
    expect(offline.kind).toBe('offline');
    expect(offline.message).toContain(NETWORK_PHRASE);
  });
});
