import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/014_feature_privacy_and_collaboration.sql'),
  'utf8',
);

describe('migration 014 security contracts', () => {
  it('publishes membership and non-sensitive invalidations but never raw cycle data', () => {
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_members');
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.collaboration_invalidations');
    expect(migration).toContain("emit_collaboration_invalidation('events')");
    expect(migration).toContain("emit_collaboration_invalidation('cycle_support')");
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime DROP TABLE public.cycle_entries');
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime DROP TABLE public.cycle_settings');
  });

  it('enforces the Korea-day support signal lifecycle in the database', () => {
    expect(migration).toContain('enforce_cycle_support_signal_contract');
    expect(migration).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(migration).toContain("NEW.expires_at > v_now + INTERVAL '24 hours'");
    expect(migration).toContain('Support signal fields are immutable except one-way revoke');
    expect(migration).toContain('idx_cycle_support_signals_one_active_owner_date');
    expect(migration).toContain('ON public.cycle_support_signals (owner_id, couple_id, shared_for_date)');
    expect(migration).toContain('user-entered text shown verbatim to the partner');
  });

  it('provides atomic authorized reorder and parent-child date guards', () => {
    expect(migration).toContain('FUNCTION public.reorder_trip_items');
    expect(migration).toContain('FROM unnest(p_item_ids, p_sort_orders)');
    expect(migration).toContain('couple_id = public.get_my_active_couple_id()');
    expect(migration).toContain('enforce_trip_item_date_range');
    expect(migration).toMatch(/FROM public\.trips\s+WHERE id = NEW\.trip_id\s+FOR UPDATE/);
    expect(migration).toContain('prevent_trip_range_excluding_items');
  });
});
