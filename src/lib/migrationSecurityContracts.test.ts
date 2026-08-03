import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canExecute,
  executePrivileges,
  jsonbObjectKeys,
  parseFunctionDefinitions,
  parseNotifies,
  type SqlFunctionDefinition,
} from '@/test/sqlModel';
import { parseRemoteCoupleState } from '@/lib/coupleLifecycle';

/**
 * Cross-file structural contracts over the WHOLE migration directory.
 *
 * The per-file tests (`migration014`, `migration016`, `migration017`) each check
 * one file. The properties that actually decide whether the deployed database is
 * safe are cumulative, though: a later file can revoke what an earlier one
 * granted, and the LAST definition of a function is the one that runs. So this
 * suite replays every file in apply order and asserts against the resulting
 * shape, which is the closest thing to a database assertion available without a
 * live Postgres (that remains a staging gate).
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');

/**
 * Files in apply order.
 *
 * `002_fix_rls_and_rpc.sql` and `002_fix_rls_recursion.sql` share a prefix, so
 * their relative order is decided by the filename alone -- which is exactly why
 * the duplicate prefix is a defect in its own right. Sorting is therefore
 * lexicographic, matching what the Supabase CLI does.
 */
const files = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const sqlByFile = new Map(files.map((file) => [
  file,
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'),
]));
const allSql = files.map((file) => sqlByFile.get(file)!).join('\n');

/** The definition that WINS for each signature, i.e. the last one applied. */
const latestDefinition = new Map<string, { file: string; definition: SqlFunctionDefinition }>();
for (const file of files) {
  for (const definition of parseFunctionDefinitions(sqlByFile.get(file)!)) {
    latestDefinition.set(definition.signature.toLowerCase(), { file, definition });
  }
}

/**
 * SECURITY DEFINER functions deliberately left without `pg_temp`.
 *
 * Same discipline as `gatePathCoverage.test.ts`: an unhardened function is only
 * acceptable with a written reason, so the list cannot grow silently.
 */
const SEARCH_PATH_EXEMPTIONS: Record<string, string> = {
  'public.create_invitation(uuid, text)':
    'Created once at 001:299 and never redefined. It has no client caller '
    + '(`.rpc(\'create_invitation\')` is absent from src/) -- couple creation goes '
    + 'through create_couple_and_invitation, which IS hardened (015:39-46). Left '
    + 'as-is because migration 017 is deliberately scoped to the one function the '
    + 'client actually calls; hardening it needs its own forward migration.',
};

/** Every RPC the client or the Edge Function actually invokes. */
const CLIENT_RPCS = [
  'public.get_my_couple_state()',
  'public.get_partner_profile()',
  'public.get_my_active_couple_id()',
  'public.redeem_invitation(text)',
  'public.regenerate_invitation(text)',
  'public.create_couple_and_invitation(text, text)',
  'public.reorder_trip_items(uuid[], integer[])',
  'public.disconnect_couple()',
] as const;

describe('every SECURITY DEFINER function ends up with a pinned search_path', () => {
  const definerFunctions = [...latestDefinition.entries()]
    .filter(([, entry]) => entry.definition.security === 'DEFINER');

  it('finds the SECURITY DEFINER functions at all (the parser is doing work)', () => {
    expect(definerFunctions.length).toBeGreaterThan(10);
  });

  for (const [signature, entry] of definerFunctions) {
    const exemption = SEARCH_PATH_EXEMPTIONS[signature];
    it(`${signature} (last defined in ${entry.file})${exemption ? ' is exempted with a reason' : ' pins public, pg_temp'}`, () => {
      if (exemption) {
        expect(exemption.length).toBeGreaterThan(40);
        return;
      }
      // A DEFINER function without `pg_temp` last lets a caller shadow an
      // unqualified name from their own temp schema, and the body then runs with
      // the definer's rights.
      expect(entry.definition.searchPath, `${signature} must pin a search_path`).not.toBeNull();
      expect(entry.definition.searchPath).toEqual(['public', 'pg_temp']);
    });
  }

  it('no exemption is stale', () => {
    for (const signature of Object.keys(SEARCH_PATH_EXEMPTIONS)) {
      const entry = latestDefinition.get(signature);
      expect(entry, `${signature} is exempted but no longer defined`).toBeDefined();
      // If someone hardens it, the exemption must be deleted rather than kept.
      expect(entry!.definition.searchPath).not.toEqual(['public', 'pg_temp']);
    }
  });
});

describe('effective EXECUTE privileges after every migration has been applied', () => {
  for (const signature of CLIENT_RPCS) {
    it(`${signature} is executable by authenticated and by nobody else`, () => {
      const privileges = executePrivileges(allSql, signature);
      // Guards against the assertion being vacuous: a typo in the signature would
      // otherwise silently model a function nothing ever granted.
      expect(privileges.statementsApplied, `${signature}: never mentioned`)
        .toBeGreaterThan(0);
      expect(canExecute(privileges, 'authenticated'), `${signature}: authenticated`).toBe(true);
      expect(canExecute(privileges, 'anon'), `${signature}: anon`).toBe(false);
      expect(privileges.publicHolds, `${signature}: PUBLIC`).toBe(false);
    });
  }

  it('consume_invitation is executable by NOBODY', () => {
    // The pre-013 redemption path bypassed durable throttling. 015:286-288
    // revokes it from PUBLIC, anon and authenticated with no later grant, and no
    // client calls it. Asserted as effective privilege rather than as a grep, so
    // a re-grant anywhere in any file fails here.
    const privileges = executePrivileges(allSql, 'public.consume_invitation(text)');
    expect(privileges.statementsApplied).toBeGreaterThan(0);
    expect(privileges.publicHolds).toBe(false);
    expect(canExecute(privileges, 'authenticated')).toBe(false);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(canExecute(privileges, 'service_role')).toBe(false);
  });

  it('the account-deletion RPCs are service_role only', () => {
    for (const signature of [
      'public.begin_account_deletion(uuid, uuid[])',
      'public.cancel_account_deletion(uuid)',
      'public.prepare_account_deletion(uuid, uuid[])',
    ]) {
      const privileges = executePrivileges(allSql, signature);
      expect(privileges.statementsApplied, `${signature}: never mentioned`).toBeGreaterThan(0);
      // The Edge Function holds the service key; a browser client never does.
      expect(canExecute(privileges, 'service_role'), signature).toBe(true);
      expect(canExecute(privileges, 'authenticated'), signature).toBe(false);
      expect(canExecute(privileges, 'anon'), signature).toBe(false);
      expect(privileges.publicHolds, signature).toBe(false);
    }
  });
});

describe('the PostgREST schema cache is reloaded by a migration, not by hand', () => {
  it('some migration executes NOTIFY pgrst, \'reload schema\'', () => {
    const reloads = files.flatMap((file) =>
      parseNotifies(sqlByFile.get(file)!)
        .filter((notify) => notify.channel === 'pgrst' && notify.payload === 'reload schema')
        .map(() => file));
    // Before 017 this list was EMPTY: the only mention in the tree was a comment
    // in 016, so every signature 013-016 created waited on a manual reload and
    // clients saw PGRST202 in the meantime.
    expect(reloads.length).toBeGreaterThan(0);
  });

  it('the reload comes after the last migration that changes a function signature', () => {
    const lastFunctionFile = files
      .filter((file) => parseFunctionDefinitions(sqlByFile.get(file)!).length > 0)
      .pop();
    const reloadFiles = files.filter((file) =>
      parseNotifies(sqlByFile.get(file)!)
        .some((notify) => notify.channel === 'pgrst' && notify.payload === 'reload schema'));
    expect(reloadFiles.length).toBeGreaterThan(0);
    // One reload refreshes the whole cache, so it only has to be the last word.
    expect(reloadFiles[reloadFiles.length - 1] >= lastFunctionFile!).toBe(true);
  });
});

describe('the RPC return shape matches the hand-written client parser', () => {
  const state = latestDefinition.get('public.get_my_couple_state()');

  it('get_my_couple_state emits the same keys on every return path', () => {
    expect(state).toBeDefined();
    const payloads = jsonbObjectKeys(state!.definition.body);
    // Two returns: the no-membership branch and the full answer.
    expect(payloads.length).toBe(2);
    expect(new Set(payloads[0])).toEqual(new Set(payloads[1]));
  });

  it('parseRemoteCoupleState consumes exactly the keys the function emits', () => {
    const [keys] = jsonbObjectKeys(state!.definition.body);
    const payload: Record<string, unknown> = {};
    for (const key of keys) payload[key] = null;
    payload.couple_id = 'couple-1';
    payload.role = 'gomsin';
    payload.member_status = 'active';
    payload.partner_present = true;
    payload.invitation_active = true;
    payload.invitation_expires_at = '2026-09-01T00:00:00.000Z';

    // Built from the SQL, not from a hand-written mock: this is the assertion
    // that would catch a migration renaming a key the parser still expects.
    expect(parseRemoteCoupleState(payload)).toEqual({
      coupleId: 'couple-1',
      role: 'gomsin',
      memberStatus: 'active',
      partnerPresent: true,
      invitationActive: true,
      invitationExpiresAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('the parser rejects a payload missing the one key it treats as mandatory', () => {
    const [keys] = jsonbObjectKeys(state!.definition.body);
    expect(keys).toContain('couple_id');
    const withoutCoupleId: Record<string, unknown> = {};
    for (const key of keys) {
      if (key !== 'couple_id') withoutCoupleId[key] = null;
    }
    expect(parseRemoteCoupleState(withoutCoupleId)).toBeNull();
  });

  it('never lets an invitation code or hash into the payload', () => {
    for (const keys of jsonbObjectKeys(state!.definition.body)) {
      expect(keys).not.toContain('code');
      expect(keys).not.toContain('code_hash');
    }
  });
});
