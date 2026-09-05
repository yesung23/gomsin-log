import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPartnerProjectionEmpty } from '@/lib/cycle';
import type { CyclePartnerProjection } from '@/types';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('automatic cycle projection is disabled', () => {
  it('has no partner card or automatic-sharing settings surface', () => {
    expect(existsSync(resolve(process.cwd(), 'src/components/cycle/CyclePartnerCard.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/components/cycle/CycleSharingSettings.tsx'))).toBe(false);

    const me = source('src/features/me/MePage.tsx');
    const settings = source('src/components/cycle/CycleSettingsSheet.tsx');
    expect(me).not.toContain('CyclePartnerCard');
    expect(settings).not.toContain('파트너 배려 공유');
    expect(settings).not.toContain('sharePredictionWindow');
    expect(settings).not.toContain('shareFertilityWindow');
  });

  it('does not call the legacy partner projection RPC from the client', () => {
    const cycle = source('src/lib/cycle.ts');
    const compatibilityPath = cycle.slice(
      cycle.indexOf('export async function fetchPartnerCycleProjectionFromDB'),
      cycle.indexOf('export function isPartnerProjectionEmpty'),
    );
    expect(compatibilityPath).not.toContain("supabase.rpc('get_partner_cycle_projection')");
    expect(compatibilityPath).toContain('projection: null');
  });

  it('normalizes every legacy preference write to all-false', () => {
    const cycle = source('src/lib/cycle.ts');
    const writer = cycle.slice(
      cycle.indexOf('export async function saveCycleSharingPreferencesToDB'),
      cycle.indexOf('// PARTNER-FACING PROJECTION'),
    );
    for (const column of [
      'share_current_period',
      'share_prediction_window',
      'share_fertility_window',
    ]) {
      expect(writer).toContain(`${column}: false`);
    }
    expect(writer).not.toMatch(/share_(current_period|prediction_window|fertility_window):\s*true/);
  });

  it('treats even a malicious legacy payload as empty', () => {
    const legacyPayload: CyclePartnerProjection = {
      isCurrentPeriodShared: true,
      isPeriodActive: true,
      isPredictionShared: true,
      predictedWindowStart: '2026-09-01',
      predictedWindowEnd: '2026-09-05',
      isFertilityShared: true,
      fertilityWindowStart: '2026-08-15',
      fertilityWindowEnd: '2026-08-20',
    };

    expect(isPartnerProjectionEmpty(legacyPayload)).toBe(true);
  });

  it('keeps the separate deliberate care-signal path', () => {
    const me = source('src/features/me/MePage.tsx');
    const support = source('src/components/CycleSupportSection.tsx');
    expect(me).toContain('CycleSupportSection');
    expect(support).toContain('createCycleSupportSignalInDB');
  });
});
