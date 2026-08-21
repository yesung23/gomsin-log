import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  isCycleSupportKind,
  isCycleSymptom,
  isValidCycleSupportMessage,
  mapCycleEntryRow,
} from '@/lib/cycle';
import { CYCLE_SUPPORT_KINDS, CYCLE_SYMPTOMS } from '@/types';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/014_feature_privacy_and_collaboration.sql',
);
const migration = readFileSync(migrationPath, 'utf8');

describe('cycle validation and mapping', () => {
  it('keeps the TypeScript vocabularies fixed and rejects unknown values', () => {
    expect(CYCLE_SYMPTOMS).toEqual([
      'cramps',
      'headache',
      'fatigue',
      'bloating',
      'mood_changes',
      'backache',
      // Added 2026-08-20. No migration: `cycle_daily_logs.symptoms` is an
      // unconstrained TEXT[] (migration 022).
      'nausea',
      'breast_tenderness',
    ]);
    expect(CYCLE_SUPPORT_KINDS).toEqual([
      'resting',
      'need_space',
      'would_like_support',
      'check_in_later',
      // Added 2026-08-21 (migration 047): the one ungraded body-state kind the
      // independent review approved. No pain_* grade may ever join this list.
      'feeling_unwell',
    ]);
    expect(CYCLE_SYMPTOMS.every(isCycleSymptom)).toBe(true);
    expect(CYCLE_SUPPORT_KINDS.every(isCycleSupportKind)).toBe(true);
    expect(isCycleSymptom('prediction')).toBe(false);
    expect(isCycleSupportKind('cramps')).toBe(false);
  });

  it('the two vocabularies stay disjoint, so a symptom can never be sent as a signal', () => {
    /*
     * This matters more at eight symptoms than it did at six. Symptoms are
     * PERSONAL; support kinds are PARTNER-VISIBLE. They are the private and the
     * public halves of one screen, and the only thing stopping a new symptom from
     * being accepted as a partner-facing kind is that the two lists share no
     * member. Adding a name to both would publish it without anyone deciding to.
     */
    for (const symptom of CYCLE_SYMPTOMS) {
      expect(isCycleSupportKind(symptom), symptom).toBe(false);
    }
    for (const kind of CYCLE_SUPPORT_KINDS) {
      expect(isCycleSymptom(kind), kind).toBe(false);
    }
  });

  it('maps only allowed symptoms and supports legacy rows', () => {
    expect(mapCycleEntryRow({
      id: 'entry-1',
      user_id: 'user-1',
      start_date: '2026-07-31',
      symptoms: ['fatigue', 'not_allowed'],
    }).symptoms).toEqual(['fatigue']);

    expect(mapCycleEntryRow({
      id: 'entry-2',
      user_id: 'user-1',
      start_date: '2026-07-30',
    }).symptoms).toEqual([]);
  });

  it('enforces the support message limit', () => {
    expect(isValidCycleSupportMessage('a'.repeat(80))).toBe(true);
    expect(isValidCycleSupportMessage('a'.repeat(81))).toBe(false);
  });
});

describe('feature privacy migration contract', () => {
  it('is transaction wrapped and adds the date event type', () => {
    expect(migration).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(migration).toContain("'anniversary', 'date', 'trip'");
  });

  it('uses operation-specific event policies with disconnect-safe sharing', () => {
    expect(migration).toContain('CREATE POLICY "Event visibility is privacy scoped"');
    expect(migration).toContain('CREATE POLICY "Creators can insert events"');
    expect(migration).toContain('CREATE POLICY "Creators can update eligible events"');
    expect(migration).toContain('CREATE POLICY "Creators can delete eligible events"');
    expect(migration).toContain('enforce_event_identity_immutable');
    expect(migration).toContain('Event identity fields are immutable');
    expect(migration).toMatch(/is_private = true AND created_by = auth\.uid\(\)/);
    expect(migration).toMatch(/is_private = false\s+AND couple_id = public\.get_my_active_couple_id\(\)/);
  });

  it('keeps support signals sanitized and raw cycle tables out of realtime', () => {
    const supportTable = migration.match(
      /CREATE TABLE IF NOT EXISTS public\.cycle_support_signals \([\s\S]*?\n\);/,
    )?.[0];

    expect(supportTable).toBeTruthy();
    expect(supportTable).not.toMatch(/cycle_entry|start_date|end_date|symptom|prediction/i);
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.collaboration_invalidations');
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_items');
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_checklists');
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.cycle_support_signals');
    expect(migration).not.toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.cycle_(entries|settings)/,
    );
  });

  it('requires current active membership for shared trip and support access', () => {
    expect(migration).toContain('CREATE POLICY "Active members can update trips"');
    expect(migration).toContain('CREATE POLICY "Active members can update trip items"');
    expect(migration).toContain('CREATE POLICY "Active members can update trip checklists"');
    expect(migration).toContain('CREATE POLICY "Active partners can select current support signals"');
    expect(migration).toMatch(/shared_for_date = \(now\(\) AT TIME ZONE 'Asia\/Seoul'\)::DATE[\s\S]*revoked_at IS NULL[\s\S]*expires_at > now\(\)/);
  });
});
