import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canExecute,
  executableStatements,
  executePrivileges,
  jsonbObjectKeys,
  parseFunctionDefinitions,
  parseNotifies,
  stripSqlComments,
} from '@/test/sqlModel';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/073_authoritative_relationship_snapshot.sql',
);
let migration = '';
try {
  migration = readFileSync(migrationPath, 'utf8');
} catch {
  // Keep RED observable as failed assertions when the migration does not exist.
}

const signature = 'public.get_my_relationship_snapshot_v2()';

function definition() {
  const found = parseFunctionDefinitions(migration)
    .find((candidate) => candidate.signature === signature);
  expect(found, `${signature} must be defined`).toBeDefined();
  return found!;
}

function expectTopologyGuards(body: string) {
  expect(body).toMatch(/owner_active_count\s*>\s*1/i);
  expect(body).toMatch(/owner_pending_count\s*>\s*0/i);
  expect(body).toMatch(/active_member_count\s*=\s*1[\s\S]*self_active_count\s*=\s*1[\s\S]*partner_active_count\s*=\s*0/i);
  expect(body).toMatch(/active_member_count\s*=\s*2[\s\S]*self_active_count\s*=\s*1[\s\S]*partner_active_count\s*=\s*1/i);
  expect(body).toMatch(/partner_row_count\s*<>\s*1/i);
  expect(body).toMatch(/invitation_row_count\s*>\s*1/i);
  expect(body).toMatch(/lifecycle\s*=\s*'disconnected'[\s\S]*active_member_count\s*<>\s*0/i);
  expect(body).toMatch(/RAISE EXCEPTION 'relationship_topology_invalid'[\s\S]*ERRCODE = 'P0001'/i);
}

describe('migration 073 authoritative relationship snapshot', () => {
  it('defines the no-argument v2 RPC as one stable, fixed-search-path security boundary', () => {
    const rpc = definition();
    expect(rpc.args).toEqual([]);
    expect(rpc.returns).toBe('JSONB');
    expect(rpc.language).toBe('plpgsql');
    expect(rpc.volatility).toBe('STABLE');
    expect(rpc.security).toBe('DEFINER');
    expect(rpc.searchPath).toEqual(['public', 'pg_temp']);
    expect(rpc.body).toMatch(/v_uid UUID := auth\.uid\(\)/i);
    expect(rpc.body).toMatch(/IF v_uid IS NULL THEN[\s\S]*ERRCODE = '42501'/i);
  });

  it('reads relationship, profile, service, and invitation facts in one PostgreSQL statement snapshot', () => {
    const dataStatements = stripSqlComments(definition().body)
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => /\b(?:FROM|JOIN)\s+public\.(?:couple_members|couples|profiles|invitation_codes)\b/i.test(statement));

    expect(dataStatements).toHaveLength(1);
    expect(dataStatements[0]).toMatch(/\bWITH\b[\s\S]*owner_memberships\s+AS\s+MATERIALIZED/i);
    expect(dataStatements[0]).toMatch(/JOIN\s+public\.profiles\s+AS\s+partner_profile\s+ON\s+partner_profile\.id\s*=\s*partner_member\.user_id/i);
    expect(dataStatements[0]).toMatch(/selected_couple\.membership_revision::text/i);
    expect(dataStatements[0]).not.toMatch(/\b(?:FROM|JOIN)\s+(?:couple_members|couples|profiles|invitation_codes)\b/i);
  });

  it('derives only personal, pending, active, or disconnected and fails malformed topology closed', () => {
    const body = definition().body;
    expect(body).toContain("'personal'");
    expect(body).toContain("'pending'");
    expect(body).toContain("'active'");
    expect(body).toContain("'disconnected'");
    expectTopologyGuards(body);
  });

  it('mutation-fails if any active-membership or ambiguity guard is removed', () => {
    const body = definition().body;
    const mutations = [
      body.replace(/owner_active_count\s*>\s*1/i, 'FALSE'),
      body.replace(/owner_pending_count\s*>\s*0/i, 'FALSE'),
      body.replace(/active_member_count\s*=\s*1/i, 'FALSE'),
      body.replace(/active_member_count\s*=\s*2/i, 'FALSE'),
      body.replace(/partner_row_count\s*<>\s*1/i, 'FALSE'),
      body.replace(/invitation_row_count\s*>\s*1/i, 'FALSE'),
      body.replace(/active_member_count\s*<>\s*0/i, 'FALSE'),
      body.replace("RAISE EXCEPTION 'relationship_topology_invalid'", 'RETURN NULL'),
    ];

    for (const mutation of mutations) {
      expect(() => expectTopologyGuards(mutation)).toThrow();
    }
    expectTopologyGuards(body);
  });

  it('emits contract version 2, revision text, and exact allowlisted JSON keys only', () => {
    const rpc = definition();
    const payloadKeys = jsonbObjectKeys(rpc.body);

    expect(payloadKeys).toEqual([
      [
        'branch',
        'military_status',
        'enlistment_date',
        'expected_discharge_date',
        'discharge_date',
        'discharge_date_source',
      ],
      [
        'user_id',
        'joined_at',
        'display_name',
        'role',
        'avatar_path',
        'username',
        'service',
      ],
      [
        'contract_version',
        'owner_user_id',
        'lifecycle',
        'couple_id',
        'relation_revision',
        'partner',
        'invitation_active',
        'invitation_expires_at',
      ],
    ]);
    expect(rpc.body).toMatch(/'contract_version'\s*,\s*2/i);
    expect(rpc.body).toMatch(/'relation_revision'\s*,\s*selected_couple\.membership_revision::text/i);
  });

  it('selects only the exact active partner presentation and approved service keys', () => {
    const body = definition().body;
    expect(body).toMatch(/partner_member\.user_id\s*<>\s*v_uid/i);
    expect(body).toMatch(/partner_member\.status\s*=\s*'active'/i);
    expect(body).toMatch(/partner_profile\.display_name/i);
    expect(body).toMatch(/partner_profile\.role/i);
    expect(body).toMatch(/partner_profile\.avatar_path/i);
    expect(body).toMatch(/partner_profile\.username/i);
    for (const key of [
      'branch',
      'militaryStatus',
      'enlistmentDate',
      'expectedDischargeDate',
      'dischargeDate',
      'dischargeDateSource',
    ]) {
      expect(body).toContain(`partner_profile.military_info ->> '${key}'`);
    }
    expect(body).not.toMatch(/partner_profile\.military_info\s*(?:,|AS|FROM)/i);
  });

  it('never exposes invitation code/hash, free-form memo, or raw health data', () => {
    const rpc = definition();
    const keys = jsonbObjectKeys(rpc.body).flat();
    for (const forbiddenKey of [
      'code',
      'code_hash',
      'memo',
      'military_info',
      'cycle',
      'period',
      'symptoms',
      'health_notes',
    ]) {
      expect(keys).not.toContain(forbiddenKey);
    }
    expect(rpc.body).not.toMatch(/code_hash|->>\s*'memo'|cycle_|period_|symptom|health_note/i);
    expect(rpc.body).toMatch(/invitation\.used\s*=\s*false/i);
    expect(rpc.body).toMatch(/invitation\.expires_at\s*>\s*CURRENT_TIMESTAMP/i);
  });

  it('leaves EXECUTE with authenticated only', () => {
    const privileges = executePrivileges(migration, signature);
    expect(privileges.statementsApplied).toBeGreaterThanOrEqual(3);
    expect(canExecute(privileges, 'authenticated')).toBe(true);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(canExecute(privileges, 'service_role')).toBe(false);
    expect(privileges.publicHolds).toBe(false);
  });

  it('is additive, transactional, and reloads the PostgREST schema cache', () => {
    const statements = executableStatements(migration);
    expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1);
    expect(stripSqlComments(migration)).not.toMatch(/\b(?:ALTER|TRUNCATE|DELETE)\s+(?:TABLE|FROM)?/i);
    expect(parseNotifies(migration)).toEqual([
      { channel: 'pgrst', payload: 'reload schema' },
    ]);
  });
});
