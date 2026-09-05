import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Gate path coverage regression test.
 *
 * Every Supabase mutation function (write operation) must enter
 * `runServerMutationBehindDeletionBarrier()` (directly or through the cycle
 * module's single wrapper) before issuing any server write. The barrier holds a
 * shared account lease for the operation's full lifetime; a boolean pre-flight
 * alone is not sufficient because deletion can begin after the check.
 *
 * If this test fails, a new mutation was added without the deletion gate.
 * Either add the gate call or document the function as an explicit exemption
 * with a justification below.
 */

const DIRECT_BARRIER_PATTERN = /runServerMutationBehindDeletionBarrier\s*\(/;
const CYCLE_BARRIER_WRAPPER_PATTERN = /runCycleMutation\s*\(/;

type TransportKind = 'direct' | 'rpc' | 'edge';

const SERVER_TRANSPORT_PATTERNS: Record<TransportKind, RegExp> = {
  direct: /\.(?:insert|upsert|update)\s*\(|\.delete\s*\(\s*\)|\.storage\s*\.\s*from\s*\(/g,
  rpc: /\.rpc\s*\(/g,
  edge: /\.functions\s*\.\s*invoke\s*\(|functions\s*\.\s*invoke\s*\(/g,
};

/**
 * Exact non-barrier server transports permitted in otherwise exempt functions.
 * A literal RPC is listed even when it is read-only so changing or adding a call
 * forces a security review instead of inheriting the old exemption silently.
 */
const EXEMPT_TRANSPORT_ALLOWLIST: Record<string, Record<string, string[]>> = {
  'records.ts': {
    getRecordMediaMutationStatus: ['rpc:record_media_mutation_status'],
    getRecordPhotoRenditionCapability: ['rpc:get_record_photo_metadata'],
  },
  'trips.ts': {
    fetchTripsResultFromDB: ['rpc:get_my_active_couple_id'],
  },
  'supabase.ts': {
    fetchMyCoupleState: ['rpc:get_my_couple_state'],
    deleteAccountFromDB: ['edge:delete-account'],
  },
  'tasks.ts': {
    fetchTasks: ['rpc:get_my_active_couple_id'],
  },
  'sensitiveConsent.ts': {
    revokeCycleConsentInDB: ['rpc:revoke_cycle_sensitive_consent'],
  },
  'events.ts': {
    fetchEventsResultFromDB: ['rpc:get_my_active_couple_id'],
  },
};

function extractExemptTransportTokens(body: string): string[] {
  const tokens: string[] = [];
  for (const method of ['insert', 'upsert', 'update'] as const) {
    const pattern = new RegExp(`\\.${method}\\s*\\(`, 'g');
    const count = body.match(pattern)?.length ?? 0;
    for (let index = 0; index < count; index += 1) tokens.push(`direct:${method}`);
  }
  const deleteCount = body.match(/\.delete\s*\(\s*\)/g)?.length ?? 0;
  for (let index = 0; index < deleteCount; index += 1) tokens.push('direct:delete');
  for (const method of ['upload', 'remove'] as const) {
    const pattern = new RegExp(`\\.${method}\\s*\\(`, 'g');
    const count = body.match(pattern)?.length ?? 0;
    for (let index = 0; index < count; index += 1) tokens.push(`storage:${method}`);
  }

  const rpcCalls = body.match(/\.rpc\s*\(/g)?.length ?? 0;
  const rpcTargets = Array.from(
    body.matchAll(/\.rpc\s*\(\s*(['"])([^'"]+)\1/g),
    (match) => `rpc:${match[2]}`,
  );
  tokens.push(...rpcTargets);
  for (let index = rpcTargets.length; index < rpcCalls; index += 1) tokens.push('rpc:<dynamic>');

  const edgeCalls = body.match(/(?:\.functions|functions)\s*\.\s*invoke\s*\(/g)?.length ?? 0;
  const edgeTargets = Array.from(
    body.matchAll(/(?:\.functions|functions)\s*\.\s*invoke\s*\(\s*(['"])([^'"]+)\1/g),
    (match) => `edge:${match[2]}`,
  );
  tokens.push(...edgeTargets);
  for (let index = edgeTargets.length; index < edgeCalls; index += 1) tokens.push('edge:<dynamic>');
  return tokens.sort();
}

/**
 * Explicit exemptions: functions that do NOT require the deletion gate.
 * Each exemption must have a documented reason.
 */
const EXEMPTIONS: Record<string, Record<string, string>> = {
  'profileAvatars.ts': {
    readProfileAvatar: 'Read-only private avatar projection; RLS authenticates the exact owner/active partner',
  },
  'trips.ts': {
    // Read-only functions
    fetchTripsResultFromDB: 'Read-only: fetches trips without mutation',
    fetchTripsFromDB: 'Read-only: wrapper around fetchTripsResultFromDB',
    fetchTripResultFromDB: 'Read-only: fetches a single trip without mutation',
    fetchTripItemsResultFromDB: 'Read-only: fetches trip items without mutation',
    fetchTripItemsFromDB: 'Read-only: wrapper around fetchTripItemsResultFromDB',
    fetchTripChecklistsResultFromDB: 'Read-only: fetches checklists without mutation',
    fetchTripChecklistsFromDB: 'Read-only: wrapper around fetchTripChecklistsResultFromDB',
    // Pure utilities
    reconcileParentTrips: 'Pure utility: deduplicates in-memory trip array',
    validateTripDraft: 'Pure utility: validates draft fields locally',
    validateTripRangeAgainstItems: 'Pure utility: validates date range locally',
    validateTripItemUrl: 'Pure utility: validates URL format locally',
    isCalendarDate: 'Pure utility: validates a YYYY-MM-DD string locally, no I/O',
    inclusiveTripDates: 'Pure utility: generates date range array',
    recordsInInclusiveRange: 'Pure utility: filters records in memory',
    parseTripPeriodParams: 'Pure utility: parses URL search params',
    // Re-exports (aliases pointing to gated functions)
    updateTrip: 'Alias: re-exports updateTripInDB which is gated',
    updateTripItem: 'Alias: re-exports updateTripItemInDB which is gated',
    reorderTripItems: 'Alias: re-exports reorderTripItemsInDB which is gated',
  },
  'cycle.ts': {
    // Read-only functions
    fetchCycleSettingsResultFromDB: 'Read-only: fetches cycle settings without mutation',
    fetchCycleSettingsFromDB: 'Read-only: wrapper around fetchCycleSettingsResultFromDB',
    fetchCycleEntriesResultFromDB: 'Read-only: fetches cycle entries without mutation',
    fetchCycleEntriesFromDB: 'Read-only: wrapper around fetchCycleEntriesResultFromDB',
    fetchCycleSupportSignalsResultFromDB: 'Read-only: fetches support signals without mutation',
    listCycleSupportSignalsFromDB: 'Read-only: wrapper around fetchCycleSupportSignalsResultFromDB',
    fetchCycleSupportSignalsFromDB: 'Read-only: alias for listCycleSupportSignalsFromDB',
    // Pure utilities
    toLocalDateString: 'Pure utility: date formatting',
    localToday: 'Pure utility: returns current date string',
    koreaToday: 'Pure utility: returns Korea timezone date string',
    buildMonthCalendarCells: 'Pure utility: generates calendar grid',
    shiftCalendarMonth: 'Pure utility: shifts month offset',
    cycleEntryOccursOnDate: 'Pure utility: date range check',
    cycleRangesOnDate: 'Pure utility: filters entries by date',
    calculateExpectedStartDate: 'Pure utility: date arithmetic',
    validateCycleEntryDraft: 'Pure utility: validates draft fields locally',
    validateCycleSettings: 'Pure utility: validates settings fields locally',
    isCycleSymptom: 'Pure utility: type guard',
    isCycleSupportKind: 'Pure utility: type guard',
    isValidCycleSupportMessage: 'Pure utility: validates message length',
    mapCycleEntryRow: 'Pure utility: maps DB row to domain type',
    mapCycleSupportSignalRow: 'Pure utility: maps DB row to domain type',
    buildCycleSupportPayload: 'Pure utility: constructs insert payload',
    activeCycleSupportSignal: 'Pure utility: filters in-memory array',
    isCycleFlow: 'Pure utility: type guard',
    isCyclePainLevel: 'Pure utility: type guard',
    isCycleMood: 'Pure utility: type guard',
    mapCyclePeriodRow: 'Pure utility: maps DB row to domain type',
    mapCycleDailyLogRow: 'Pure utility: maps DB row to domain type',
    fetchCyclePeriodsResultFromDB: 'Read-only: fetches cycle periods without mutation',
    fetchCyclePeriodsFromDB: 'Read-only: wrapper around fetchCyclePeriodsResultFromDB',
    fetchCycleDailyLogsResultFromDB: 'Read-only: fetches cycle daily logs without mutation',
    fetchCycleDailyLogsFromDB: 'Read-only: wrapper around fetchCycleDailyLogsResultFromDB',
    fetchCycleSharingPreferencesFromDB: 'Read-only: fetches cycle sharing preferences',
    fetchPartnerCycleProjectionFromDB:
      'Read-only compatibility boundary: returns no automatic partner projection and mutates nothing',
    isPartnerProjectionEmpty: 'Pure predicate over an in-memory projection, no server call',
    periodOccursOnDate: 'Pure utility: date range check over a CyclePeriod',
    periodRangesOnDate: 'Pure utility: filters periods by date',
    activePeriodOnDate: 'Pure utility: selects the active period in memory',
    isPeriodImplausiblyLong: 'Pure utility: compares an open period against a day limit',
    periodDayNumber: 'Pure utility: date arithmetic',
    dailyLogOnDate: 'Pure utility: finds one daily log in memory',
    dailyLogHasContent: 'Pure utility: checks whether a daily log carries any value',
  },
  'supabase.ts': {
    // Read-only
    fetchMyCoupleState: 'Read-only: reads couple lifecycle state, no mutation',
    fetchAuthProviderAvailability: 'Read-only: reads public Auth provider settings',
    fetchAuthProviderAvailabilityFrom:
      'Read-only testable boundary: reads public Auth provider settings without account data',
    // `loadState` / `saveState` were listed here for `SupabaseLogRepository`, a
    // dead exported placeholder that was never instantiated. It has been deleted, so the entries are gone
    // too -- an exemption for something that no longer exists is rot, and the
    // assertion below now proves the class is really absent.
    // Deletion operation itself
    deleteAccountFromDB: 'IS the deletion operation: cannot gate itself',
    // Pure utilities
    hashInvitationCode: 'Pure utility: crypto hash function',
    generateInvitationCode: 'Pure utility: generates random code string',
    parseAuthProviderAvailability: 'Pure utility: validates public Auth settings',
    // Test helper
    __resetInviteAttemptsForTest: 'Test helper: resets in-memory array for tests',
  },
  'tasks.ts': {
    validateTaskTitle: 'Pure utility: validates a task title locally',
    fetchTasks: 'Read-only: fetches tasks after verifying active couple membership',
  },
  'sensitiveConsent.ts': {
    hasPendingCycleConsentRevocation: 'Local-only privacy lock read',
    markCycleConsentRevocationPending: 'Local-only privacy lock write',
    clearPendingCycleConsentRevocation: 'Local-only privacy lock cleanup',
    hasCycleSensitiveConsent: 'Local-only consent cache read',
    grantCycleSensitiveConsent: 'Local-only UX cache write; server grant is separately gated',
    revokeCycleSensitiveConsent: 'Local-only privacy-reduction cache removal',
    syncCycleConsentWithDB: 'Read-only: fetches authoritative consent state',
    revokeCycleConsentInDB:
      'Privacy-reduction exception: revocation must remain available while deletion is pending; exact auth identity is rechecked',
  },
};

/**
 * Mutations that are gated at their `store.tsx` CALL SITE rather than inside
 * themselves.
 *
 * `records.ts` and `events.ts` are pure data-access modules: every one of their
 * writes is issued from a store action that has already run
 * `withOrdinaryServerMutation()`, which owns the shared lease. Gating them
 * internally without passing that lease would risk a non-reentrant nested lock.
 *
 * That reason is only TRUE while nothing else imports them. The import-boundary
 * assertion below enforces exactly that, so this category cannot quietly become a
 * false claim: a new importer fails the test and must either move behind the store
 * or gate itself.
 */
const STORE_GATED: Record<string, { functions: string[]; reason: string }> = {
  'records.ts': {
    functions: [
      'saveRecordToDB',
      'deleteRecordFromDB',
      'uploadRecordMedia',
      'beginRecordMediaMutation',
      'beginRecordPhotoMutation',
      'uploadRecordPhotoRendition',
      'abandonRecordMediaMutation',
    ],
    reason:
      'Gated at the store.tsx call site: addRecordWithMedia / updateRecord / '
      + 'deleteRecord / updateRecordMedia all call '
      + 'withOrdinaryServerMutation() for the full operation. Enforced by '
      + 'the import-boundary assertion.',
  },
  'events.ts': {
    functions: ['saveEventToDB', 'updateEventInDB', 'deleteEventFromDB'],
    reason:
      'Gated at the store.tsx call site: addEvent / updateEvent / deleteEvent all '
      + 'hold withOrdinaryServerMutation() for the full operation. Enforced '
      + 'by the import-boundary assertion.',
  },
  'highlights.ts': {
    functions: ['saveCoupleHighlightToDB', 'deleteCoupleHighlightFromDB'],
    reason:
      'Gated at the store.tsx call site: highlight mutations pass through the '
      + 'store pre-flight deletion gate. Read access is explicitly classified below.',
  },
  'partnerUsername.ts': {
    functions: ['setPartnerUsernameInDB'],
    reason:
      'Gated at the store.tsx call site: partner username mutation passes through '
      + 'the store pre-flight deletion gate.',
  },
};

/**
 * Read-only or pure exports of the store-gated modules. Listed so that a NEW
 * export cannot slip through unclassified.
 */
const STORE_GATED_EXEMPTIONS: Record<string, Record<string, string>> = {
  'records.ts': {
    fetchRecordsResultFromDB: 'Read-only: fetches records without mutation',
    fetchRecordsFromDB: 'Read-only: wrapper around fetchRecordsResultFromDB',
    getRecordMediaMutationStatus: 'Read-only: reconciles one opaque operation identity',
    getRecordPhotoRenditionCapability:
      'Read-only: probes get_record_photo_metadata with an empty ID list; no reservation or upload',
    resolveAttachmentUrls: 'Read-only: signs existing paths, creates nothing',
    downloadRecordPhotoForReuse:
      'Read-only: downloads one RLS-authorized canonical photo; the store owns any later write',
    isCanonicalRecordMediaPath: 'Pure utility: validates a storage path locally',
    classifyMediaFile: 'Pure utility: validates MIME type and size locally',
    buildMediaPath: 'Pure utility: builds a path string',
    isValidMediaObjectId: 'Pure utility: validates a durable media object id',
    setRecordCryptoEnvironment:
      'Wiring, not a mutation: installs the P5 key/floor environment. Writes no row '
      + 'and reaches no network. Called once during E2EE bootstrap.',
    getRecordCryptoEnvironment:
      'Read-only accessor for the installed environment, so a test can assert which '
      + 'one is active without reaching into module state.',
    encryptionRefusalReason:
      'Pure utility: maps a refusal to encrypt onto a ServerErrorKind. Deliberately '
      + 'exported so the store and its tests classify the refusal identically.',
  },
  'events.ts': {
    fetchEventsResultFromDB: 'Read-only: fetches events without mutation',
    fetchEventsFromDB: 'Read-only: wrapper around fetchEventsResultFromDB',
  },
  'highlights.ts': {
    fetchCoupleHighlightsResultFromDB: 'Read-only: fetches shared highlight metadata',
  },
  'partnerUsername.ts': {},
};

/**
 * The ONLY modules permitted to import the store-gated data modules.
 *
 * `sync.ts` is included because it performs read-only hydration. Test files are
 * excluded from the check: they mock these modules by design.
 */
const STORE_GATED_ALLOWED_IMPORTERS = ['src/lib/store.tsx', 'src/lib/sync.ts'];

/**
 * Gated mutation functions: these MUST contain the gate call.
 */
const GATED_MUTATIONS: Record<string, string[]> = {
  'profileAvatars.ts': ['saveProfileAvatar'],
  'trips.ts': [
    'saveTripToDB',
    'updateTripInDB',
    'deleteTripFromDB',
    'saveTripItemToDB',
    'updateTripItemInDB',
    'reorderTripItemsInDB',
    'deleteTripItemFromDB',
    'saveTripChecklistToDB',
    'toggleTripChecklistInDB',
    'deleteTripChecklistFromDB',
  ],
  'cycle.ts': [
    'saveCycleSettingsToDB',
    'saveCycleEntryToDB',
    'updateCycleEntryInDB',
    'deleteCycleEntryFromDB',
    'createCycleSupportSignalInDB',
    'revokeCycleSupportSignalFromDB',
    'saveCyclePeriodToDB',
    'updateCyclePeriodInDB',
    'deleteCyclePeriodFromDB',
    'saveCycleDailyLogToDB',
    'deleteCycleDailyLogFromDB',
    'saveCycleSharingPreferencesToDB',
  ],
  'supabase.ts': [
    'saveCoupleAnniversary',
    'createCoupleInvitation',
    'consumeCoupleInvitation',
    'regenerateCoupleInvitation',
    'disconnectCoupleFromDB',
  ],
  'tasks.ts': [
    'createTask',
    'updateTask',
    'deleteTask',
  ],
  'sensitiveConsent.ts': [
    'grantCycleConsentInDB',
  ],
};

/**
 * Extract the body of a named exported function from source text.
 * Handles both `export async function name(` and `export function name(` forms.
 * Correctly skips generic type parameters and return type annotations that
 * may contain `{` (e.g., `Promise<{ key: string }>`).
 * Returns the function body (brace-delimited) or null if not found.
 */
function extractFunctionBody(source: string, functionName: string): string | null {
  // Match through the function name, then scan to the parameter list. Stopping
  // before `(` also supports generic declarations such as `fn<T extends ...>(`.
  const pattern = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${functionName}\\b`,
  );
  const match = pattern.exec(source);
  if (!match) return null;

  // Find and skip past the parameter list by tracking parenthesis depth.
  let pos = match.index + match[0].length;
  while (pos < source.length && source[pos] !== '(') pos += 1;
  if (pos >= source.length) return null;
  pos += 1;
  let parenDepth = 1;
  while (pos < source.length && parenDepth > 0) {
    if (source[pos] === '(') parenDepth += 1;
    else if (source[pos] === ')') parenDepth -= 1;
    pos += 1;
  }

  // Now skip past the return type annotation (`: Promise<{ ... }>` etc.)
  // We need to track `<` and `>` for generic parameters and `{`/`}` inside
  // the type annotation. The function body starts at the first `{` that is
  // not inside angle brackets.
  let angleBracketDepth = 0;
  let typeBraceDepth = 0;
  while (pos < source.length) {
    const ch = source[pos];
    if (ch === '<') {
      angleBracketDepth += 1;
    } else if (ch === '>') {
      if (angleBracketDepth > 0) angleBracketDepth -= 1;
    } else if (ch === '{' && angleBracketDepth > 0) {
      typeBraceDepth += 1;
    } else if (ch === '}' && typeBraceDepth > 0) {
      typeBraceDepth -= 1;
    } else if (ch === '{' && angleBracketDepth === 0 && typeBraceDepth === 0) {
      // This is the opening brace of the function body
      break;
    }
    pos += 1;
  }
  if (pos >= source.length) return null;

  // Collect the body between braces
  const start = pos;
  let depth = 0;
  for (; pos < source.length; pos += 1) {
    if (source[pos] === '{') depth += 1;
    else if (source[pos] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, pos + 1);
    }
  }
  return null;
}

function extractExportedAliasTarget(source: string, exportName: string): string | null {
  const pattern = new RegExp(
    `export\\s+const\\s+${exportName}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*;`,
  );
  return pattern.exec(source)?.[1] || null;
}

/**
 * Extract all exported function names from source text.
 */
function extractExportedFunctionNames(source: string): string[] {
  const pattern = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function productionSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'testing') out.push(...productionSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

describe('Gate path coverage: every mutation holds the operation-lifetime deletion barrier', () => {
  const files = ['trips.ts', 'cycle.ts', 'supabase.ts', 'tasks.ts', 'sensitiveConsent.ts', 'profileAvatars.ts'] as const;
  const sources: Record<string, string> = {};

  for (const file of files) {
    sources[file] = readFileSync(resolve(process.cwd(), 'src', 'lib', file), 'utf8');
  }

  describe('all documented mutation functions contain the gate call', () => {
    for (const [file, mutations] of Object.entries(GATED_MUTATIONS)) {
      describe(file, () => {
        for (const fn of mutations) {
          it(`${fn} enters the operation-lifetime barrier`, () => {
            const body = extractFunctionBody(sources[file], fn);
            expect(body, `Function ${fn} not found in ${file}`).not.toBeNull();
            const pattern = file === 'cycle.ts'
              ? CYCLE_BARRIER_WRAPPER_PATTERN
              : DIRECT_BARRIER_PATTERN;
            expect(
              pattern.test(body!),
              `${fn} in ${file} must enter the operation-lifetime deletion barrier`,
            ).toBe(true);
          });
        }
      });
    }
  });

  it('the cycle wrapper itself enters the operation-lifetime barrier', () => {
    const source = sources['cycle.ts'];
    const start = source.indexOf('async function runCycleMutation');
    const end = source.indexOf('\nexport function toLocalDateString', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(DIRECT_BARRIER_PATTERN.test(source.slice(start, end))).toBe(true);
  });

  describe('no exported function is unaccounted for (neither gated nor exempted)', () => {
    for (const file of files) {
      it(`every export in ${file} is either gated or explicitly exempted`, () => {
        const allExports = extractExportedFunctionNames(sources[file]);
        const gated = new Set(GATED_MUTATIONS[file] || []);
        const exempted = new Set(Object.keys(EXEMPTIONS[file] || {}));
        const unaccounted = allExports.filter(
          (name) => !gated.has(name) && !exempted.has(name),
        );
        expect(
          unaccounted,
          `Unaccounted exports in ${file}: ${unaccounted.join(', ')}. ` +
          'Add them to GATED_MUTATIONS (if they are write operations) or ' +
          'EXEMPTIONS (with a reason) in gatePathCoverage.test.ts.',
        ).toEqual([]);
      });
    }
  });

  describe('exemptions are documented with reasons', () => {
    for (const file of files) {
      it(`all exemptions in ${file} have non-empty reasons`, () => {
        const exemptions = EXEMPTIONS[file] || {};
        for (const [fn, reason] of Object.entries(exemptions)) {
          expect(reason, `Exemption for ${fn} in ${file} must have a reason`).toBeTruthy();
        }
      });
    }
  });

  describe('exemptions cannot silently acquire a server mutation', () => {
    for (const file of files) {
      for (const fn of Object.keys(EXEMPTIONS[file] || {})) {
        it(`${file}:${fn} has only its exact reviewed transport surface`, () => {
          const body = extractFunctionBody(sources[file], fn);
          if (!body) {
            const aliasTarget = extractExportedAliasTarget(sources[file], fn);
            expect(aliasTarget, `Function or direct alias ${fn} not found in ${file}`).not.toBeNull();
            expect(EXEMPT_TRANSPORT_ALLOWLIST[file]?.[fn] || []).toEqual([]);
            return;
          }
          expect(extractExemptTransportTokens(body!)).toEqual(
            [...(EXEMPT_TRANSPORT_ALLOWLIST[file]?.[fn] || [])].sort(),
          );
        });
      }
    }
  });

  /**
   * L-2. `SupabaseLogRepository` was an exported `ILogRepository` implementation
   * whose `loadState()` returned null after logging "placeholder" and whose
   * `saveState()` only logged. Nothing instantiated it, so it never lost anyone's
   * data -- but it was importable, and wiring it up as the store's repository
   * would have silently discarded every write. It is deleted; this keeps it from
   * coming back, and keeps its now-meaningless gate exemptions from coming back
   * with it.
   */
  describe('L-2: the dead placeholder repository stays deleted', () => {
    it('supabase.ts exports no SupabaseLogRepository', () => {
      expect(sources['supabase.ts']).not.toContain('class SupabaseLogRepository');
      expect(sources['supabase.ts']).not.toMatch(/export\s+class\s+SupabaseLogRepository/);
    });

    it('no live code in src/ references it any more', () => {
      // Comments are stripped: the tombstone comment left where the class used to
      // be is documentation, not a reference that could be wired up.
      const stripComments = (source: string) =>
        source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!/\.tsx?$/.test(entry.name)) continue;
          // This file names it in prose, which is the documentation.
          if (entry.name === 'gatePathCoverage.test.ts') continue;
          if (stripComments(readFileSync(full, 'utf8')).includes('SupabaseLogRepository')) {
            offenders.push(relative(process.cwd(), full).split(sep).join('/'));
          }
        }
      };
      walk(resolve(process.cwd(), 'src'));
      expect(offenders).toEqual([]);
    });

    it('no stale exemption survives for its methods', () => {
      const supabaseExemptions = EXEMPTIONS['supabase.ts'];
      expect(supabaseExemptions).not.toHaveProperty('loadState');
      expect(supabaseExemptions).not.toHaveProperty('saveState');
    });

    it('PRESERVATION: the repository the store actually uses is untouched', () => {
      const store = readFileSync(
        resolve(process.cwd(), 'src', 'lib', 'store.tsx'),
        'utf8',
      );
      expect(store).toContain('class DevicePreferencesRepository');
      expect(store).toContain('new DevicePreferencesRepository()');
    });

    it('PRESERVATION: the auth repository selection still works', () => {
      expect(sources['supabase.ts']).toContain('new SupabaseAuthRepository()');
      expect(sources['supabase.ts']).toContain('new UnconfiguredAuthRepository()');
    });
  });
});

/**
 * Store-gated modules.
 *
 * These writes are NOT self-gating, and that is deliberate. What this suite
 * enforces is the precondition that makes it safe: they are reachable only through
 * `store.tsx` (plus read-only `sync.ts`), where the gate has already run.
 */
describe('Store-gated data modules: reachable only through the gated store', () => {
  const storeGatedFiles = Object.keys(STORE_GATED);
  const sources: Record<string, string> = {};
  for (const file of storeGatedFiles) {
    sources[file] = readFileSync(resolve(process.cwd(), 'src', 'lib', file), 'utf8');
  }

  describe('every documented store-gated mutation exists and is not self-gated', () => {
    for (const [file, { functions }] of Object.entries(STORE_GATED)) {
      describe(file, () => {
        for (const fn of functions) {
          it(`${fn} exists`, () => {
            const body = extractFunctionBody(sources[file], fn);
            expect(body, `Function ${fn} not found in ${file}`).not.toBeNull();
          });
        }
      });
    }
  });

  describe('the gate really does run at the store call site', () => {
    const storeSource = readFileSync(
      resolve(process.cwd(), 'src', 'lib', 'store.tsx'),
      'utf8',
    );

    // The store's mutation barrier holds the account lock across both the fresh
    // deletion pre-flight and every remote side effect.
    const STORE_MUTATION_BARRIER = /withOrdinaryServerMutation\s*(?:<[^>]+>)?\s*\(/;

    for (const action of [
      'updateProfile',
      'saveCoupleHighlight',
      'deleteCoupleHighlight',
      'setPartnerUsername',
      'addRecordWithMedia',
      'updateRecord',
      'deleteRecord',
      'updateRecordMedia',
      'addEvent',
      'updateEvent',
      'deleteEvent',
      'cancelPendingLink',
      'disconnect',
      'markTalkAbout',
      'unmarkTalkAbout',
      'resolveTalkAbout',
    ]) {
      it(`store action ${action} holds the operation-lifetime barrier`, () => {
        // These are `const x = async (...) => {}` arrow functions, so the
        // declaration form differs from the module-level `export function` form.
        const start = storeSource.indexOf(`const ${action} = async (`);
        expect(start, `store action ${action} not found`).toBeGreaterThanOrEqual(0);
        const openBrace = storeSource.indexOf('{', storeSource.indexOf('=>', start));
        let depth = 0;
        let end = openBrace;
        for (; end < storeSource.length; end += 1) {
          if (storeSource[end] === '{') depth += 1;
          else if (storeSource[end] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const body = storeSource.slice(openBrace, end + 1);
        expect(
          STORE_MUTATION_BARRIER.test(body),
          `${action} must run through withOrdinaryServerMutation() before writing`,
        ).toBe(true);
      });
    }
  });

  describe('import boundary: the documented reason cannot silently become false', () => {
    /** Every non-test source file in `src/`. */
    function sourceFiles(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...sourceFiles(full));
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        // Tests mock these modules by design.
        if (/\.test\.tsx?$/.test(entry.name)) continue;
        out.push(full);
      }
      return out;
    }

    /**
     * Named bindings imported from `module` by `source`.
     *
     * Only the import list is parsed, deliberately: a file may legitimately import
     * a PURE helper (`classifyMediaFile`, `MEDIA_ACCEPT`) from a store-gated module
     * — the composer and the record page both do. What must never happen is a
     * non-store file importing a WRITE function, because that write would bypass
     * the gate entirely.
     */
    function importedBindings(source: string, moduleName: string): string[] {
      const pattern = new RegExp(
        `import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]`
        + `(?:@/lib/${moduleName}|\\./${moduleName}|\\.\\./lib/${moduleName})['"]`,
        'g',
      );
      const bindings: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        match[1]
          .split(',')
          .map((entry) => entry.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim())
          .filter(Boolean)
          .forEach((name) => bindings.push(name));
      }
      return bindings;
    }

    for (const file of storeGatedFiles) {
      it(`no file outside the store imports a write function from ${file}`, () => {
        const moduleName = file.replace(/\.ts$/, '');
        const writeFunctions = new Set(STORE_GATED[file].functions);
        const root = resolve(process.cwd(), 'src');

        const offenders: string[] = [];
        for (const absolute of sourceFiles(root)) {
          const relativePath = relative(process.cwd(), absolute).split(sep).join('/');
          if (STORE_GATED_ALLOWED_IMPORTERS.includes(relativePath)) continue;
          const source = readFileSync(absolute, 'utf8');
          const leaked = importedBindings(source, moduleName)
            .filter((binding) => writeFunctions.has(binding));
          if (leaked.length > 0) {
            offenders.push(`${relativePath} imports ${leaked.join(', ')}`);
          }
        }

        expect(
          offenders,
          `${file} is store-gated (see STORE_GATED). Its WRITE functions `
          + `(${[...writeFunctions].join(', ')}) may only be called from `
          + `${STORE_GATED_ALLOWED_IMPORTERS.join(', ')}, where the operation-lifetime barrier has `
          + `already run. Offenders: ${offenders.join('; ')}. Either route the call `
          + 'through a store action, or make the function self-gating and move it into '
          + 'GATED_MUTATIONS.',
        ).toEqual([]);
      });
    }
  });

  describe('no export of a store-gated module is unaccounted for', () => {
    for (const file of storeGatedFiles) {
      it(`every export in ${file} is either store-gated or explicitly exempted`, () => {
        const allExports = extractExportedFunctionNames(sources[file]);
        const gated = new Set(STORE_GATED[file].functions);
        const exempted = new Set(Object.keys(STORE_GATED_EXEMPTIONS[file] || {}));
        const unaccounted = allExports.filter(
          (name) => !gated.has(name) && !exempted.has(name),
        );
        expect(
          unaccounted,
          `Unaccounted exports in ${file}: ${unaccounted.join(', ')}. `
          + 'Add them to STORE_GATED (if they are write operations reached through '
          + 'store.tsx) or STORE_GATED_EXEMPTIONS (with a reason).',
        ).toEqual([]);
      });
    }
  });

  describe('every store-gated category and exemption carries a reason', () => {
    for (const file of storeGatedFiles) {
      it(`${file} documents why it is gated at the call site`, () => {
        expect(STORE_GATED[file].reason.length).toBeGreaterThan(20);
      });

      it(`${file} exemptions all have reasons`, () => {
        for (const [fn, reason] of Object.entries(STORE_GATED_EXEMPTIONS[file] || {})) {
          expect(reason, `Exemption for ${fn} in ${file} must have a reason`).toBeTruthy();
        }
      });
    }
  });

  describe('store-gated read and pure exemptions cannot grow a hidden write', () => {
    for (const file of storeGatedFiles) {
      for (const fn of Object.keys(STORE_GATED_EXEMPTIONS[file] || {})) {
        it(`${file}:${fn} has only its exact reviewed transport surface`, () => {
          const body = extractFunctionBody(sources[file], fn);
          expect(body, `Function ${fn} not found in ${file}`).not.toBeNull();
          expect(extractExemptTransportTokens(body!)).toEqual(
            [...(EXEMPT_TRANSPORT_ALLOWLIST[file]?.[fn] || [])].sort(),
          );
        });
      }
    }
  });
});

/**
 * Whole-source tripwire.
 *
 * The fine-grained suites above prove the known mutation functions are gated.
 * This inventory solves the other half of the regression risk: a future module
 * must not start talking to a mutating Supabase surface while remaining absent
 * from every gate test. The expected lists are intentionally explicit; adding a
 * new transport surface forces the author to classify it in review.
 */
describe('Whole-source server mutation inventory', () => {
  const root = resolve(process.cwd(), 'src');
  const sources = productionSourceFiles(root).map((absolute) => ({
    absolute,
    relative: relative(process.cwd(), absolute).split(sep).join('/'),
    source: readFileSync(absolute, 'utf8'),
  }));

  const expectedDirectWriteFiles = [
    'src/data/e2ee/SupabaseE2eeRepository.ts',
    'src/lib/cycle.ts',
    'src/lib/events.ts',
    'src/lib/highlights.ts',
    'src/lib/productEvents.ts',
    'src/lib/records.ts',
    'src/lib/sensitiveConsent.ts',
    'src/lib/store.tsx',
    'src/lib/supabase.ts',
    'src/lib/talkAbout.ts',
    'src/lib/tasks.ts',
    'src/lib/trips.ts',
    'src/pages/OnboardingPage.tsx',
  ];

  const expectedRpcFiles = [
    'src/data/e2ee/SupabaseE2eeRepository.ts',
    'src/lib/events.ts',
    'src/lib/highlights.ts',
    'src/lib/partnerUsername.ts',
    'src/lib/profileAvatars.ts',
    'src/lib/pushTokens.ts',
    'src/lib/records.ts',
    'src/lib/relationshipSnapshot.ts',
    'src/lib/sensitiveConsent.ts',
    'src/lib/store.tsx',
    'src/lib/supabase.ts',
    'src/lib/sync.ts',
    'src/lib/tasks.ts',
    'src/lib/trips.ts',
    'src/pages/OnboardingPage.tsx',
    'src/pages/SettingsPage.tsx',
  ];

  const expectedEdgeFunctionFiles = [
    'src/data/e2ee/SupabaseE2eeRepository.ts',
    'src/lib/iap/runtime.ts',
    'src/lib/supabase.ts',
  ];

  const expectedTransportCounts: Record<TransportKind, Record<string, number>> = {
    direct: {
      'src/data/e2ee/SupabaseE2eeRepository.ts': 10,
      'src/lib/cycle.ts': 12,
      'src/lib/events.ts': 3,
      'src/lib/highlights.ts': 1,
      'src/lib/productEvents.ts': 1,
      'src/lib/records.ts': 6, // Adds the Store-gated prepared-rendition Storage upload.
      'src/lib/sensitiveConsent.ts': 1,
      'src/lib/store.tsx': 2,
      'src/lib/supabase.ts': 1,
      'src/lib/talkAbout.ts': 4,
      'src/lib/tasks.ts': 3,
      'src/lib/trips.ts': 9,
      'src/pages/OnboardingPage.tsx': 2,
    },
    rpc: {
      'src/data/e2ee/SupabaseE2eeRepository.ts': 15,
      'src/lib/events.ts': 1,
      'src/lib/highlights.ts': 1,
      'src/lib/partnerUsername.ts': 1,
      'src/lib/profileAvatars.ts': 1,
      'src/lib/pushTokens.ts': 3,
      'src/lib/records.ts': 7, // Includes the separately classified authoritative metadata read below.
      'src/lib/relationshipSnapshot.ts': 1,
      'src/lib/sensitiveConsent.ts': 2,
      'src/lib/store.tsx': 3,
      'src/lib/supabase.ts': 5,
      'src/lib/sync.ts': 3,
      'src/lib/tasks.ts': 1,
      'src/lib/trips.ts': 2,
      'src/pages/OnboardingPage.tsx': 1,
      'src/pages/SettingsPage.tsx': 1,
    },
    edge: {
      'src/data/e2ee/SupabaseE2eeRepository.ts': 3,
      'src/lib/iap/runtime.ts': 1,
      'src/lib/supabase.ts': 1,
    },
  };

  it('classifies all seven records RPC paths, including authoritative metadata hydration', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/records.ts'), 'utf8');
    const functionDeclarations = Array.from(
      source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\b/gm),
      (match) => ({ owner: match[1], index: match.index }),
    );
    const classifications = new Map<string, string>([
      ['fetchRecordPhotoMetadata:get_record_photo_metadata', 'read-only authoritative metadata'],
      ['getRecordPhotoRenditionCapability:get_record_photo_metadata', 'read-only capability probe'],
      ['beginRecordMediaMutation:begin_record_media_mutation', 'store-gated write'],
      ['beginRecordPhotoMutation:begin_record_photo_mutation', 'store-gated write'],
      ['getRecordMediaMutationStatus:record_media_mutation_status', 'read-only status'],
      ['abandonRecordMediaMutation:abandon_record_media_mutation', 'store-gated write'],
      ['deleteRecordFromDB:delete_my_record', 'store-gated write'],
    ]);
    const discovered = Array.from(
      source.matchAll(/\.rpc\s*\(\s*(['"])([^'"]+)\1/g),
      (match) => {
        const owner = functionDeclarations
          .filter((declaration) => declaration.index <= match.index)
          .at(-1)?.owner;
        const target = match[2];
        return {
          owner,
          target,
          classification: classifications.get(`${owner}:${target}`),
        };
      },
    );

    expect(discovered).toEqual([
      {
        owner: 'fetchRecordPhotoMetadata',
        target: 'get_record_photo_metadata',
        classification: 'read-only authoritative metadata',
      },
      {
        owner: 'getRecordPhotoRenditionCapability',
        target: 'get_record_photo_metadata',
        classification: 'read-only capability probe',
      },
      {
        owner: 'beginRecordMediaMutation',
        target: 'begin_record_media_mutation',
        classification: 'store-gated write',
      },
      {
        owner: 'beginRecordPhotoMutation',
        target: 'begin_record_photo_mutation',
        classification: 'store-gated write',
      },
      {
        owner: 'getRecordMediaMutationStatus',
        target: 'record_media_mutation_status',
        classification: 'read-only status',
      },
      {
        owner: 'abandonRecordMediaMutation',
        target: 'abandon_record_media_mutation',
        classification: 'store-gated write',
      },
      {
        owner: 'deleteRecordFromDB',
        target: 'delete_my_record',
        classification: 'store-gated write',
      },
    ]);

    const fetchBody = extractFunctionBody(source, 'fetchRecordsResultFromDB');
    expect(fetchBody).not.toBeNull();
    expect(fetchBody).toContain('await fetchRecordPhotoMetadata(eligibleRecordIds)');
  });

  it.each(Object.keys(SERVER_TRANSPORT_PATTERNS) as TransportKind[])(
    '%s transport occurrence counts remain explicitly reviewed',
    (kind) => {
      const pattern = SERVER_TRANSPORT_PATTERNS[kind];
      const discovered = Object.fromEntries(
        sources
          .map(({ relative: path, source }) => [
            path,
            source.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0,
          ] as const)
          .filter(([, count]) => count > 0),
      );
      expect(discovered).toEqual(expectedTransportCounts[kind]);
    },
  );

  it('no new direct table/storage write surface bypasses classification', () => {
    const pattern = /\.(?:insert|upsert|update)\s*\(|\.delete\s*\(\s*\)|\.storage\s*\.\s*from\s*\(/;
    const discovered = sources
      .filter(({ source }) => pattern.test(source))
      .map(({ relative: path }) => path)
      .sort();
    expect(discovered).toEqual([...expectedDirectWriteFiles].sort());
  });

  it('no new RPC surface bypasses read/write classification', () => {
    const discovered = sources
      .filter(({ source }) => /\.rpc\s*\(/.test(source))
      .map(({ relative: path }) => path)
      .sort();
    expect(discovered).toEqual([...expectedRpcFiles].sort());
  });

  it('no new Edge Function invocation bypasses lifecycle review', () => {
    const discovered = sources
      .filter(({ source }) => /\.functions\s*\.\s*invoke\s*\(|functions\s*\.\s*invoke\s*\(/.test(source))
      .map(({ relative: path }) => path)
      .sort();
    expect(discovered).toEqual([...expectedEdgeFunctionFiles].sort());
  });

  it.each([
    ['productEvents.ts', 'recordProductEvent'],
    ['pushTokens.ts', 'registerPushToken'],
    ['pushTokens.ts', 'clearOwnUnseen'],
  ])('%s:%s holds the operation-lifetime barrier', (file, functionName) => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib', file), 'utf8');
    const body = extractFunctionBody(source, functionName);
    expect(body, `Function ${functionName} not found in ${file}`).not.toBeNull();
    expect(DIRECT_BARRIER_PATTERN.test(body!)).toBe(true);
  });

  it('push-token revocation is the narrow privacy-reduction exception', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/pushTokens.ts'), 'utf8');
    const body = extractFunctionBody(source, 'revokeOwnPushTokens');
    expect(body).not.toBeNull();
    expect(body).toContain("rpc('revoke_my_push_tokens')");
    expect(body).not.toMatch(/register_push_token|clear_my_unseen/);
    expect(body).not.toMatch(DIRECT_BARRIER_PATTERN);
  });

  it('read-only RPC modules contain no direct table or Storage write', () => {
    for (const file of [
      'src/lib/relationshipSnapshot.ts',
      'src/lib/sync.ts',
      'src/pages/SettingsPage.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/\.(?:insert|upsert|update)\s*\(/);
      expect(source, file).not.toMatch(/\.storage\s*\.\s*from\s*\(/);
    }
  });

  it('store direct profile writes stay inside its gated updateProfile action', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/store.tsx'), 'utf8');
    const start = source.indexOf('const updateProfile = async (');
    const nextAction = source.indexOf('\n  const saveCoupleHighlight = async (', start);
    expect(start).toBeGreaterThan(-1);
    expect(nextAction).toBeGreaterThan(start);
    const body = source.slice(start, nextAction);
    expect(body).toContain('withOrdinaryServerMutation(');
    expect(body).toContain("from('profiles')");
    expect(body).toContain("from('contact_preferences')");
    expect(source.match(/\.(?:insert|upsert|update)\s*\(/g)?.length).toBe(2);
  });

  it('outbox replay consults the server fence before decrypting or persisting a media plan', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/store.tsx'), 'utf8');
    const flushAt = source.indexOf('const flushOutbox = async (');
    const nextAction = source.indexOf('\n  const retryBlockedRecords = async (', flushAt);
    const body = source.slice(flushAt, nextAction);
    const lockAt = body.indexOf('withAccountDeletionLock(identity.userId');
    const admissionAt = body.indexOf('ensureNotPendingBeforeServerCall(deletionLease, identity)');
    const decryptAt = body.indexOf('readQueuedRecord(deliveryEntry)');
    const planAt = body.indexOf('ensureQueuedMediaPlan(');
    expect(lockAt).toBeGreaterThan(-1);
    expect(admissionAt).toBeGreaterThan(lockAt);
    expect(decryptAt).toBeGreaterThan(admissionAt);
    expect(planAt).toBeGreaterThan(decryptAt);
    expect(body).toContain('{ ifAvailable: true }');
    const accountDeletion = readFileSync(
      resolve(process.cwd(), 'src/lib/accountDeletion.ts'),
      'utf8',
    );
    expect(accountDeletion).toContain("mode: options.mode ?? 'exclusive'");
  });

  it('E2EE authority writes remain blocked from production/release activation', () => {
    const buildEnv = readFileSync(resolve(process.cwd(), 'build/buildEnv.ts'), 'utf8');
    const buildPlugin = readFileSync(
      resolve(process.cwd(), 'build/viteBuildEnvironmentPlugin.ts'),
      'utf8',
    );
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(buildEnv).toContain('E2EE_DEVICE_PROTECTION_RELEASE_HOLD');
    expect(buildEnv).toContain("env.VITE_E2EE_DEVICE_PROTECTION_ENABLED === 'true'");
    expect(buildPlugin).toContain('VITE_E2EE_DEVICE_PROTECTION_ENABLED:');
    expect(viteConfig).toContain('createBuildEnvironmentValidationPlugin');
  });

  it('Apple IAP sales remain blocked from production/release activation', () => {
    const buildEnv = readFileSync(resolve(process.cwd(), 'build/buildEnv.ts'), 'utf8');
    const buildPlugin = readFileSync(
      resolve(process.cwd(), 'build/viteBuildEnvironmentPlugin.ts'),
      'utf8',
    );
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(buildEnv).toContain('APPLE_IAP_SALE_RELEASE_HOLD');
    expect(buildEnv).toContain("env.VITE_APPLE_IAP_SALE_ENABLED === 'true'");
    expect(buildPlugin).toContain('VITE_APPLE_IAP_SALE_ENABLED:');
    expect(viteConfig).toContain('createBuildEnvironmentValidationPlugin');
  });
});
