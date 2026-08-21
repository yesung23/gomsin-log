import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Gate path coverage regression test.
 *
 * Every Supabase mutation function (write operation) must call the tri-state
 * pre-flight gate `serverCallBlockedByPendingDeletion()` before issuing any
 * server request. This test reads the actual source files and verifies that
 * each mutation function body contains the gate call.
 *
 * If this test fails, a new mutation was added without the deletion gate.
 * Either add the gate call or document the function as an explicit exemption
 * with a justification below.
 */

const GATE_CALL_PATTERN = /serverCallBlockedByPendingDeletion\s*\(/;

/**
 * Explicit exemptions: functions that do NOT require the deletion gate.
 * Each exemption must have a documented reason.
 */
const EXEMPTIONS: Record<string, Record<string, string>> = {
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
      'Read-only: calls get_partner_cycle_projection(), which is STABLE and mutates nothing',
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
    // Auth operations (sign-in/out must work regardless of deletion state)
    signInWithGoogle: 'Auth operation: must work during any state',
    signInWithApple: 'Auth operation: must work during any state',
    signInWithEmail: 'Auth operation: must work during any state',
    signOut: 'Auth operation: must work during any state',
    getCurrentUser: 'Auth operation: read-only session check',
    // Read-only
    fetchMyCoupleState: 'Read-only: reads couple lifecycle state, no mutation',
    fetchAuthProviderAvailability: 'Read-only: reads public Auth provider settings',
    isConfigured: 'Read-only: returns boolean configuration check',
    // `loadState` / `saveState` were listed here for `SupabaseLogRepository`, a
    // dead exported placeholder that was never instantiated. It has been deleted, so the entries are gone
    // too -- an exemption for something that no longer exists is rot, and the
    // assertion below now proves the class is really absent.
    // Recovery path
    disconnectCoupleFromDB: 'Recovery path: must work during deletion to unlink couple',
    // Deletion operation itself
    deleteAccountFromDB: 'IS the deletion operation: cannot gate itself',
    // Couple-level shared write
    saveCoupleAnniversary: 'Shared couple-level write: not user data mutation',
    // Pure utilities
    hashInvitationCode: 'Pure utility: crypto hash function',
    generateInvitationCode: 'Pure utility: generates random code string',
    parseAuthProviderAvailability: 'Pure utility: validates public Auth settings',
    // Test helper
    __resetInviteAttemptsForTest: 'Test helper: resets in-memory array for tests',
  },
};

/**
 * Mutations that are gated at their `store.tsx` CALL SITE rather than inside
 * themselves.
 *
 * `records.ts` and `events.ts` are pure data-access modules: every one of their
 * writes is issued from a store action that has already run
 * `ensureNotPendingBeforeServerCall()`. Gating them internally as well would
 * double the authoritative round-trip on every write.
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
      'removeRecordMedia',
    ],
    reason:
      'Gated at the store.tsx call site: addRecordWithMedia / updateRecord / '
      + 'deleteRecord / updateRecordMedia all call '
      + 'ensureNotPendingBeforeServerCall() before the first request. Enforced by '
      + 'the import-boundary assertion.',
  },
  'events.ts': {
    functions: ['saveEventToDB', 'updateEventInDB', 'deleteEventFromDB'],
    reason:
      'Gated at the store.tsx call site: addEvent / updateEvent / deleteEvent all '
      + 'call ensureNotPendingBeforeServerCall() before the first request. Enforced '
      + 'by the import-boundary assertion.',
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
    resolveAttachmentUrls: 'Read-only: signs existing paths, creates nothing',
    isCanonicalRecordMediaPath: 'Pure utility: validates a storage path locally',
    classifyMediaFile: 'Pure utility: validates MIME type and size locally',
    buildMediaPath: 'Pure utility: builds a path string',
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
    'createCoupleInvitation',
    'consumeCoupleInvitation',
    'regenerateCoupleInvitation',
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
  // Match the function declaration start
  const pattern = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${functionName}\\s*\\(`,
  );
  const match = pattern.exec(source);
  if (!match) return null;

  // Skip past the parameter list by tracking parenthesis depth
  let pos = match.index + match[0].length;
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

describe('Gate path coverage: every mutation calls serverCallBlockedByPendingDeletion', () => {
  const files = ['trips.ts', 'cycle.ts', 'supabase.ts'] as const;
  const sources: Record<string, string> = {};

  for (const file of files) {
    sources[file] = readFileSync(resolve(process.cwd(), 'src', 'lib', file), 'utf8');
  }

  describe('all documented mutation functions contain the gate call', () => {
    for (const [file, mutations] of Object.entries(GATED_MUTATIONS)) {
      describe(file, () => {
        for (const fn of mutations) {
          it(`${fn} calls serverCallBlockedByPendingDeletion`, () => {
            const body = extractFunctionBody(sources[file], fn);
            expect(body, `Function ${fn} not found in ${file}`).not.toBeNull();
            expect(
              GATE_CALL_PATTERN.test(body!),
              `${fn} in ${file} must call serverCallBlockedByPendingDeletion()`,
            ).toBe(true);
          });
        }
      });
    }
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

    // The store's own gate helper, which wraps `serverCallBlockedByPendingDeletion`.
    const STORE_GATE = /ensureNotPendingBeforeServerCall\s*\(/;

    for (const action of [
      'addRecordWithMedia',
      'updateRecord',
      'deleteRecord',
      'updateRecordMedia',
      'addEvent',
      'updateEvent',
      'deleteEvent',
    ]) {
      it(`store action ${action} calls the pre-flight gate`, () => {
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
          STORE_GATE.test(body),
          `${action} must call ensureNotPendingBeforeServerCall() before writing`,
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
          + `${STORE_GATED_ALLOWED_IMPORTERS.join(', ')}, where the pre-flight gate has `
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
});
