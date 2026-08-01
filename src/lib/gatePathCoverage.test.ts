import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  },
  'supabase.ts': {
    // Auth operations (sign-in/out must work regardless of deletion state)
    signInWithGoogle: 'Auth operation: must work during any state',
    signInWithApple: 'Auth operation: must work during any state',
    signInWithEmail: 'Auth operation: must work during any state',
    signOut: 'Auth operation: must work during any state',
    getCurrentUser: 'Auth operation: read-only session check',
    // Read-only
    isConfigured: 'Read-only: returns boolean configuration check',
    loadState: 'Read-only: loads app state',
    saveState: 'Read-only: placeholder (logs only)',
    // Recovery path
    disconnectCoupleFromDB: 'Recovery path: must work during deletion to unlink couple',
    // Deletion operation itself
    deleteAccountFromDB: 'IS the deletion operation: cannot gate itself',
    // Couple-level shared write
    saveCoupleAnniversary: 'Shared couple-level write: not user data mutation',
    // Pure utilities
    hashInvitationCode: 'Pure utility: crypto hash function',
    generateInvitationCode: 'Pure utility: generates random code string',
    // Test helper
    __resetInviteAttemptsForTest: 'Test helper: resets in-memory array for tests',
  },
};

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
});
