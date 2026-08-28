import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoupleInfo, MilitaryInfo, PartnerMilitaryInfo, PartnerServiceInfo } from '@/types';
import {
  canExecute,
  executePrivileges,
  parseFunctionDefinitions,
  parseNotifies,
} from '@/test/sqlModel';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/063_partner_service_projection.sql'),
  'utf8',
);
const signature = 'public.get_partner_service_info()';
const [definition] = parseFunctionDefinitions(migration);

describe('migration 063 partner service projection', () => {
  it('returns only the allowlisted service timeline and never the free-form memo', () => {
    expect(definition.signature).toBe(signature);
    expect(definition.returnColumns).toEqual([
      'branch',
      'military_status',
      'enlistment_date',
      'expected_discharge_date',
      'discharge_date',
      'discharge_date_source',
    ]);
    expect(definition.body).not.toMatch(/->>\s*'memo'/);
    expect(definition.body).not.toMatch(/SELECT\s+p\.military_info\s+FROM\b/i);
  });

  it('requires an authenticated gomsin and an active soldier in the same couple', () => {
    expect(definition.security).toBe('DEFINER');
    expect(definition.searchPath).toEqual(['public', 'pg_temp']);
    expect(definition.body).toMatch(/IF v_uid IS NULL THEN[\s\S]*ERRCODE = '42501'/);
    expect(definition.body).toContain("caller_cm.status = 'active'");
    expect(definition.body).toContain("caller_cm.role = 'gomsin'");
    expect(definition.body).toContain("partner_cm.status = 'active'");
    expect(definition.body).toContain("partner_cm.role = 'soldier'");
    expect(definition.body).toContain('partner_cm.couple_id = caller_cm.couple_id');
    expect(definition.body).toMatch(/active_cm\.status = 'active'[\s\S]*\) = 2/);
  });

  it('structurally excludes memo from the client partner service type contract while preserving owner MilitaryInfo', () => {
    type PartnerServiceHasMemo = 'memo' extends keyof PartnerServiceInfo ? true : false;
    const partnerServiceHasMemo: PartnerServiceHasMemo = false;
    expect(partnerServiceHasMemo).toBe(false);

    type PartnerMilitaryAliasHasMemo = 'memo' extends keyof PartnerMilitaryInfo ? true : false;
    const partnerMilitaryAliasHasMemo: PartnerMilitaryAliasHasMemo = false;
    expect(partnerMilitaryAliasHasMemo).toBe(false);

    type CouplePartnerHasMemo = 'memo' extends keyof NonNullable<CoupleInfo['partnerMilitary']> ? true : false;
    const couplePartnerHasMemo: CouplePartnerHasMemo = false;
    expect(couplePartnerHasMemo).toBe(false);

    type OwnerHasMemo = 'memo' extends keyof MilitaryInfo ? true : false;
    const ownerHasMemo: OwnerHasMemo = true;
    expect(ownerHasMemo).toBe(true);

    const samplePartnerService: PartnerServiceInfo = {
      branch: 'army',
      militaryStatus: 'serving',
      dischargeDateSource: 'calculated',
    };
    expect('memo' in samplePartnerService).toBe(false);
  });

  it('grants execute only to authenticated and reloads PostgREST', () => {
    const privileges = executePrivileges(migration, signature);
    expect(canExecute(privileges, 'authenticated')).toBe(true);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(canExecute(privileges, 'service_role')).toBe(false);
    expect(privileges.publicHolds).toBe(false);
    expect(parseNotifies(migration)).toEqual([{ channel: 'pgrst', payload: 'reload schema' }]);
  });
});
