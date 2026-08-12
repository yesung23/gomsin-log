import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/028_restore_couple_media_authorization.sql'),
  'utf8',
);

function policyBody(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `CREATE POLICY "${escaped}"([\\s\\S]*?)(?=\\nCREATE POLICY|\\n-- Deliberately no UPDATE policy)`,
  ).exec(sql);
  expect(match, `missing policy: ${name}`).not.toBeNull();
  return match![1];
}

describe('028 couple-media authorization contract', () => {
  const insert = policyBody('Active members can insert into couple-media');
  const read = policyBody('Active members can read couple-media');
  const remove = policyBody('Active members can delete from couple-media');

  it('keeps the bucket private and scopes every policy to authenticated', () => {
    expect(sql).toContain("VALUES ('couple-media', 'couple-media', false)");
    expect(sql).toContain('ON CONFLICT (id) DO UPDATE SET public = false');
    for (const policy of [insert, read, remove]) {
      expect(policy).toContain('TO authenticated');
      expect(policy).toContain("bucket_id = 'couple-media'");
      expect(policy).toContain('auth.uid() IS NOT NULL');
    }
  });

  it('requires the canonical three-segment path plus an authorized record row', () => {
    for (const policy of [insert, read, remove]) {
      expect(policy).toContain('array_length(storage.foldername(name), 1) = 2');
      expect(policy).toContain("name !~ '(^|/)\\.'");
      expect(policy).toContain("name !~ '//'");
      // A trailing slash yields a two-element foldername with an empty filename,
      // which satisfies every other guard. See the 028 header comment.
      expect(policy).toContain("name !~ '/$'");
      expect(policy).toContain(
        '(storage.foldername(name))[1] = public.get_my_active_couple_id()::TEXT',
      );
      expect(policy).toContain('FROM public.daily_records AS record');
      expect(policy).toContain('record.id::TEXT = (storage.foldername(name))[2]');
      expect(policy).toContain('record.couple_id::TEXT = (storage.foldername(name))[1]');
      expect(policy).toContain('record.couple_id = public.get_my_active_couple_id()');
    }
  });

  it('allows upload only for the record owner and blocks deletion-pending writes', () => {
    expect(insert).toContain('FOR INSERT');
    expect(insert).toContain('NOT public.is_my_account_deletion_pending()');
    expect(insert).toContain('record.user_id = auth.uid()');
  });

  it('allows owner reads and active-partner reads only for shared records', () => {
    expect(read).toContain('FOR SELECT');
    expect(read).toContain('record.user_id = auth.uid()');
    expect(read).toContain('record.user_id <> auth.uid() AND record.is_private = false');
  });

  it('allows deletion only for the record owner', () => {
    expect(remove).toContain('FOR DELETE');
    expect(remove).toContain('record.user_id = auth.uid()');
    expect(remove).not.toContain('record.is_private = false');
  });

  it('defines no UPDATE policy, so object replacement remains denied by RLS', () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]+FOR UPDATE/is);
  });
});
