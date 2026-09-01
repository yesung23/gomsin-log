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

/**
 * The SAME defect, phrased so the 인터넷 연결 guard above could not see it.
 *
 * `uploadRecordMedia()` held the real Storage error and returned a hard-coded
 * '파일을 올리지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.'. An RLS
 * rejection on the storage INSERT policy, a 413 on an oversized object and an
 * expired JWT therefore all told the user to check their connection -- exactly
 * the defect the guard above exists to prevent -- while passing it, because the
 * literal it greps for is 인터넷 연결 and this copy said 연결 상태.
 *
 * The guard is only worth having if it covers the DEFECT CLASS rather than one
 * spelling of it, so the connection-blaming phrase family is enforced here too.
 * Anything that wants to say it must either be genuinely offline-only, or be a
 * branch that has already excluded the auth/permission causes -- and each such
 * site records which, with an assertion below that checks the claim.
 */
const CONNECTION_PHRASES = ['연결 상태', '연결을 확인'] as const;

/**
 * Strip comments before scanning.
 *
 * Only USER-FACING copy is in scope. A comment that names the phrase in order to
 * document why it was removed -- which is exactly what the repaired sites now
 * carry -- is not a diagnosis shown to anyone, and treating it as one would make
 * the guard punish its own documentation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/**
 * Sites permitted to blame a connection, and the reason each is not a false
 * diagnosis. Every reason is verified by an assertion in this block.
 */
const ALLOWED_CONNECTION_FILES: Record<string, string> = {
  'src/lib/serverErrors.ts':
    'The classifier itself. `offline` owns the only genuine connection message, and '
    + '`forbidden` says 커플 공간 연결 상태, which is the COUPLE link rather than the network.',
  'src/App.tsx':
    "AuthSyncUnavailable picks this copy strictly inside the reason === 'offline' branch.",
  'src/components/CycleTrackerSection.tsx':
    'Residual-error branch only: `LoadState` is the CycleFetchFailureReason itself, so '
    + '`unauthenticated` and `forbidden` are separate states with their own copy and can '
    + 'never reach this string.',
  'src/pages/SchedulePage.tsx':
    'Both StatusCards sit in already-classified branches: `forbidden` is split out of the '
    + "load state at `result.reason === 'forbidden'`, so neither card can describe an RLS "
    + 'rejection or an expired session as a connection problem.',
};

function filesMentioningConnection(): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((file) => {
      const source = stripComments(readFileSync(file, 'utf8'));
      return CONNECTION_PHRASES.some((phrase) => source.includes(phrase));
    })
    .map(relative);
}

describe('no live client code blames the connection without classifying', () => {
  it('only the documented sites mention 연결 상태 / 연결을 확인', () => {
    const offenders = filesMentioningConnection()
      .filter((file) => !(file in ALLOWED_CONNECTION_FILES));
    expect(offenders).toEqual([]);
  });

  it('every connection allowlist entry still exists and still contains a phrase', () => {
    // Same anti-rot rule as the 인터넷 연결 allowlist.
    for (const file of Object.keys(ALLOWED_CONNECTION_FILES)) {
      const source = stripComments(read(file));
      expect(
        CONNECTION_PHRASES.some((phrase) => source.includes(phrase)),
        file,
      ).toBe(true);
      expect(ALLOWED_CONNECTION_FILES[file].length).toBeGreaterThan(40);
    }
  });

  it('the media upload failure classifies its Storage error', () => {
    const source = read('src/lib/records.ts');
    expect(source).toContain("import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';");
    expect(source).toContain(
      '`파일을 올리지 못했어요. ${classifyServerError(error).message}`',
    );
    // The literal it replaced must not come back as live copy.
    expect(stripComments(source)).not.toContain('연결 상태');
  });

  it('every TripDetailPage mutation catch classifies its error', () => {
    const source = read('src/pages/TripDetailPage.tsx');
    expect(source).toContain("import { classifyServerError } from '@/lib/serverErrors';");
    for (const prefix of [
      '여행 정보를 수정하지 못했어요',
      '여행을 삭제하지 못했어요',
      '일정을 저장하지 못했어요',
      '일정을 삭제하지 못했어요',
      '준비물을 추가하지 못했어요',
      '준비물을 삭제하지 못했어요',
    ]) {
      expect(source, prefix).toContain(
        `\`${prefix}. \${classifyServerError(error).message}\``,
      );
    }
  });

  it("CycleTrackerSection reaches its connection copy only after 'forbidden' is excluded", () => {
    const source = read('src/components/CycleTrackerSection.tsx');
    // The two authoritative causes are returned before the residual line.
    const at = source.indexOf('연결을 확인');
    expect(at).toBeGreaterThan(-1);
    const before = source.slice(0, at);
    expect(before).toContain("if (state === 'unauthenticated')");
    expect(before).toContain("if (state === 'forbidden')");
  });

  it("SchedulePage splits 'forbidden' out of its load state", () => {
    const source = read('src/pages/SchedulePage.tsx');
    expect(source).toContain("result.reason === 'forbidden' ? 'forbidden' : 'error'");
  });

  it('stripComments removes documentation but keeps live copy', () => {
    // Guard soundness: if this were wrong the scan above would be vacuous.
    expect(stripComments('/* said 연결 상태 once */\nconst a = 1;')).not.toContain('연결 상태');
    expect(stripComments('// said 연결을 확인 once\nconst a = 1;')).not.toContain('연결을 확인');
    expect(stripComments("const copy = '연결 상태를 확인해 주세요';")).toContain('연결 상태');
    expect(stripComments("const url = 'https://example.com';")).toContain('https://example.com');
  });

  it('the guard would still catch a newly hard-coded connection message', () => {
    // Soundness: the phrase list must match the shape of the copy it targets.
    for (const invented of [
      '파일을 올리지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.',
      '저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
    ]) {
      expect(CONNECTION_PHRASES.some((phrase) => invented.includes(phrase))).toBe(true);
    }
    // ...and must not fire on classified copy.
    for (const classified of [
      '파일을 올리지 못했어요. 세션이 만료되었어요. 다시 로그인해 주세요.',
      '파일을 올리지 못했어요. 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    ]) {
      expect(CONNECTION_PHRASES.some((phrase) => classified.includes(phrase))).toBe(false);
    }
  });

  it('an RLS rejection, a 413 and an expired JWT get three different upload messages', () => {
    // The point of the fix: these were one message, and it named the connection.
    const messages = [
      { code: '42501', message: 'new row violates row-level security policy' },
      { status: 413, message: 'Payload too large' },
      { code: 'PGRST301', message: 'JWT expired' },
    ].map((error) => `파일을 올리지 못했어요. ${classifyServerError(error, { online: true }).message}`);

    for (const message of messages) {
      expect(message).not.toContain(NETWORK_PHRASE);
      for (const phrase of CONNECTION_PHRASES) {
        // 커플 공간 연결 상태 is the couple link, not the network, and is the
        // correct answer for 42501 -- so only the network phrasing is forbidden.
        if (phrase === '연결 상태') continue;
        expect(message).not.toContain(phrase);
      }
    }
    expect(new Set(messages).size).toBe(3);
  });
});

describe('the four repaired mutation paths classify their cause', () => {
  it('consumeCoupleInvitation classifies the thrown error without logging the raw cause', () => {
    const source = read('src/lib/supabase.ts');
    const block = source.slice(source.indexOf("[gomsinlog] redeem_invitation threw."));
    expect(block).toContain('classifyServerError(err).message');
    expect(block.slice(0, 400)).not.toContain(NETWORK_PHRASE);
    expect(block.slice(0, 200)).not.toContain("console.error('[gomsinlog] redeem_invitation threw.', err)");
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
