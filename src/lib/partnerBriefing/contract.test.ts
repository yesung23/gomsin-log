import { describe, expect, it } from 'vitest';
import type {
  BriefingGeneration,
  BriefingMediaKind,
  BriefingModelSafeEvent,
  BriefingPeriod,
  BriefingSourceMapping,
  PartnerBriefing,
  PartnerBriefingDay,
  PartnerBriefingOverview,
  PartnerBriefingSection,
  UntrustedBriefingGeneratedSection,
  UntrustedBriefingProviderOutput,
} from './contract';
import { PARTNER_BRIEFING_VERSION } from './contract';

describe('Partner Briefing Contract (Phase A1)', () => {
  describe('BriefingGeneration union', () => {
    it('pins the generation union exactly to on_device | hybrid | deterministic', () => {
      type ExpectedGeneration = 'on_device' | 'hybrid' | 'deterministic';
      type GenerationCoversExpected = [ExpectedGeneration] extends [BriefingGeneration] ? true : false;
      type GenerationHasNoExtra = [BriefingGeneration] extends [ExpectedGeneration] ? true : false;
      type GenerationExact = GenerationCoversExpected extends true
        ? GenerationHasNoExtra extends true
          ? true
          : false
        : false;

      const isGenerationExact: GenerationExact = true;
      expect(isGenerationExact).toBe(true);

      const onDevice: BriefingGeneration = 'on_device';
      const hybrid: BriefingGeneration = 'hybrid';
      const deterministic: BriefingGeneration = 'deterministic';
      expect([onDevice, hybrid, deterministic]).toEqual(['on_device', 'hybrid', 'deterministic']);
    });
  });

  describe('BriefingPeriod union', () => {
    it('pins the period union exactly to morning | afternoon | evening | night', () => {
      type ExpectedPeriod = 'morning' | 'afternoon' | 'evening' | 'night';
      type PeriodCoversExpected = [ExpectedPeriod] extends [BriefingPeriod] ? true : false;
      type PeriodHasNoExtra = [BriefingPeriod] extends [ExpectedPeriod] ? true : false;
      type PeriodExact = PeriodCoversExpected extends true
        ? PeriodHasNoExtra extends true
          ? true
          : false
        : false;

      const isPeriodExact: PeriodExact = true;
      expect(isPeriodExact).toBe(true);
    });
  });

  describe('BriefingMediaKind union', () => {
    it('pins the media kind union to photo | video | voice', () => {
      type ExpectedMediaKind = 'photo' | 'video' | 'voice';
      type MediaKindCoversExpected = [ExpectedMediaKind] extends [BriefingMediaKind] ? true : false;
      type MediaKindHasNoExtra = [BriefingMediaKind] extends [ExpectedMediaKind] ? true : false;
      type MediaKindExact = MediaKindCoversExpected extends true
        ? MediaKindHasNoExtra extends true
          ? true
          : false
        : false;

      const isMediaKindExact: MediaKindExact = true;
      expect(isMediaKindExact).toBe(true);
    });
  });

  describe('BriefingModelSafeEvent allowlist and forbidden fields', () => {
    it('pins the model-safe event keys at compile-time to exactly the allowlist', () => {
      type ModelSafeKeys = keyof BriefingModelSafeEvent;
      type ExpectedKeys = 'ordinal' | 'dayOrdinal' | 'period' | 'text' | 'mediaKinds';

      type HasAllExpected = [ExpectedKeys] extends [ModelSafeKeys] ? true : false;
      type HasNoExtra = [ModelSafeKeys] extends [ExpectedKeys] ? true : false;
      type KeysExact = HasAllExpected extends true
        ? HasNoExtra extends true
          ? true
          : false
        : false;

      const isKeysExact: KeysExact = true;
      expect(isKeysExact).toBe(true);
    });

    it('proves forbidden identity, timestamp, path, URL, and cryptographic fields are not part of the model-safe type', () => {
      type ForbiddenKeys =
        | 'id'
        | 'recordId'
        | 'userId'
        | 'coupleId'
        | 'partnerUserId'
        | 'date'
        | 'time'
        | 'createdAt'
        | 'updatedAt'
        | 'url'
        | 'path'
        | 'storagePath'
        | 'key'
        | 'secret'
        | 'keyMaterial'
        | 'attachments'
        | 'attachment'
        | 'emotionFlow'
        | 'emotionAnalysis'
        | 'isPrivate'
        | 'authorRole'
        | 'contentUnavailable';

      type HasForbiddenKey = [ForbiddenKeys & keyof BriefingModelSafeEvent] extends [never] ? false : true;
      const hasForbiddenKey: HasForbiddenKey = false;
      expect(hasForbiddenKey).toBe(false);

      type HasRecordId = 'recordId' extends keyof BriefingModelSafeEvent ? true : false;
      const hasRecordId: HasRecordId = false;
      expect(hasRecordId).toBe(false);

      type HasUserId = 'userId' extends keyof BriefingModelSafeEvent ? true : false;
      const hasUserId: HasUserId = false;
      expect(hasUserId).toBe(false);

      type HasCoupleId = 'coupleId' extends keyof BriefingModelSafeEvent ? true : false;
      const hasCoupleId: HasCoupleId = false;
      expect(hasCoupleId).toBe(false);

      type HasDate = 'date' extends keyof BriefingModelSafeEvent ? true : false;
      const hasDate: HasDate = false;
      expect(hasDate).toBe(false);

      type HasTime = 'time' extends keyof BriefingModelSafeEvent ? true : false;
      const hasTime: HasTime = false;
      expect(hasTime).toBe(false);

      type HasStoragePath = 'storagePath' extends keyof BriefingModelSafeEvent ? true : false;
      const hasStoragePath: HasStoragePath = false;
      expect(hasStoragePath).toBe(false);

      type HasUrl = 'url' extends keyof BriefingModelSafeEvent ? true : false;
      const hasUrl: HasUrl = false;
      expect(hasUrl).toBe(false);

      type HasKeyMaterial = 'keyMaterial' extends keyof BriefingModelSafeEvent ? true : false;
      const hasKeyMaterial: HasKeyMaterial = false;
      expect(hasKeyMaterial).toBe(false);
    });

    it('runtime fixture matches allowlisted key set and contains no forbidden data on serialization', () => {
      const sampleEvent: BriefingModelSafeEvent = {
        ordinal: 0,
        dayOrdinal: 0,
        period: 'morning',
        text: '오전 훈련 시작',
        mediaKinds: ['photo', 'voice'],
      };

      expect(Object.keys(sampleEvent).sort()).toEqual([
        'dayOrdinal',
        'mediaKinds',
        'ordinal',
        'period',
        'text',
      ]);

      const json = JSON.stringify(sampleEvent);
      expect(json).not.toContain('recordId');
      expect(json).not.toContain('userId');
      expect(json).not.toContain('coupleId');
      expect(json).not.toContain('http');
      expect(json).not.toContain('2026-');
    });
  });

  describe('JS-only source mapping', () => {
    it('holds synthetic ordinal to concrete recordId mapping strictly on the JS side', () => {
      const mapping: BriefingSourceMapping = {
        ordinal: 0,
        recordId: 'rec-uuid-1234',
      };

      expect(mapping.ordinal).toBe(0);
      expect(mapping.recordId).toBe('rec-uuid-1234');
    });
  });

  describe('Untrusted provider output vs Verified domain types', () => {
    it('untrusted generated section expresses only text and sourceOrdinals without sourceRecordIds', () => {
      type UntrustedHasSourceRecordIds = 'sourceRecordIds' extends keyof UntrustedBriefingGeneratedSection
        ? true
        : false;
      const untrustedHasSourceRecordIds: UntrustedHasSourceRecordIds = false;
      expect(untrustedHasSourceRecordIds).toBe(false);

      type UntrustedHasSourceOrdinals = 'sourceOrdinals' extends keyof UntrustedBriefingGeneratedSection
        ? true
        : false;
      const untrustedHasSourceOrdinals: UntrustedHasSourceOrdinals = true;
      expect(untrustedHasSourceOrdinals).toBe(true);

      const rawOutput: UntrustedBriefingProviderOutput = {
        sections: [
          {
            text: '사격 훈련을 마치고 점심을 먹었습니다.',
            sourceOrdinals: [0, 1],
          },
        ],
      };
      expect(rawOutput.sections[0].sourceOrdinals).toEqual([0, 1]);
      expect('sourceRecordIds' in rawOutput.sections[0]).toBe(false);
    });

    it('verified domain overview and sections carry exact sourceRecordIds bound by TypeScript', () => {
      type SectionHasSourceRecordIds = 'sourceRecordIds' extends keyof PartnerBriefingSection ? true : false;
      const sectionHasSourceRecordIds: SectionHasSourceRecordIds = true;
      expect(sectionHasSourceRecordIds).toBe(true);

      type OverviewHasSourceRecordIds = 'sourceRecordIds' extends keyof PartnerBriefingOverview ? true : false;
      const overviewHasSourceRecordIds: OverviewHasSourceRecordIds = true;
      expect(overviewHasSourceRecordIds).toBe(true);

      const overview: PartnerBriefingOverview = {
        text: '주요 훈련 일정을 소화했습니다.',
        sourceRecordIds: ['rec-001', 'rec-002'],
      };
      expect(overview.sourceRecordIds).toEqual(['rec-001', 'rec-002']);

      const section: PartnerBriefingSection = {
        period: 'morning',
        text: '사격 훈련을 진행했습니다.',
        sourceRecordIds: ['rec-001'],
      };
      expect(section.period).toBe('morning');
      expect(section.sourceRecordIds).toEqual(['rec-001']);
    });
  });

  describe('Final PartnerBriefing domain structure', () => {
    it('represents multi-day results with exact sourceRecordIds and rangeLabel', () => {
      const multiDayBriefing: PartnerBriefing = {
        version: PARTNER_BRIEFING_VERSION,
        sourceCount: 3,
        generation: 'on_device',
        rangeLabel: '8월 26일 ~ 8월 27일',
        overview: {
          text: '이틀간 훈련과 휴식을 기록했습니다.',
          sourceRecordIds: ['rec-001', 'rec-002', 'rec-003'],
        },
        days: [
          {
            date: '2026-08-26',
            sections: [
              {
                period: 'morning',
                text: '오전 훈련을 진행했습니다.',
                sourceRecordIds: ['rec-001'],
              },
              {
                period: 'evening',
                text: '체력단련을 마쳤습니다.',
                sourceRecordIds: ['rec-002'],
              },
            ],
          },
          {
            date: '2026-08-27',
            sections: [
              {
                period: 'afternoon',
                text: '휴식을 취했습니다.',
                sourceRecordIds: ['rec-003'],
              },
            ],
          },
        ],
      };

      expect(multiDayBriefing.version).toBe(1);
      expect(multiDayBriefing.sourceCount).toBe(3);
      expect(multiDayBriefing.generation).toBe('on_device');
      expect(multiDayBriefing.rangeLabel).toBe('8월 26일 ~ 8월 27일');
      expect(multiDayBriefing.days).toHaveLength(2);
      expect(multiDayBriefing.days[0].date).toBe('2026-08-26');
      expect(multiDayBriefing.days[0].sections).toHaveLength(2);
      expect(multiDayBriefing.days[1].date).toBe('2026-08-27');
      expect(multiDayBriefing.days[1].sections).toHaveLength(1);
    });
  });
});
