import { describe, expect, it } from 'vitest';
import type {
  BriefingExtractCandidate,
  BriefingExtractRequestItem,
  BriefingGeneration,
  BriefingLocale,
  BriefingMediaKind,
  BriefingModelSafeEvent,
  BriefingPeriod,
  BriefingSourceMapping,
  PartnerBriefing,
  PartnerBriefingDay,
  PartnerBriefingItem,
  PartnerBriefingItemPart,
  PartnerBriefingOverview,
  PartnerBriefingSection,
  UntrustedBriefingChoice,
  UntrustedBriefingGroup,
  UntrustedBriefingGroupPlan,
  UntrustedBriefingExtractPlan,
} from './contract';
import { DEFAULT_BRIEFING_LOCALE, PARTNER_BRIEFING_PLAN_VERSION, PARTNER_BRIEFING_VERSION } from './contract';

describe('Partner Briefing Contract (Phase A1 Amendment)', () => {
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

  describe('BriefingLocale union and default', () => {
    it('pins the locale union exactly to ko | en', () => {
      type ExpectedLocale = 'ko' | 'en';
      type LocaleCoversExpected = [ExpectedLocale] extends [BriefingLocale] ? true : false;
      type LocaleHasNoExtra = [BriefingLocale] extends [ExpectedLocale] ? true : false;
      type LocaleExact = LocaleCoversExpected extends true
        ? LocaleHasNoExtra extends true
          ? true
          : false
        : false;

      const isLocaleExact: LocaleExact = true;
      expect(isLocaleExact).toBe(true);

      const ko: BriefingLocale = 'ko';
      const en: BriefingLocale = 'en';
      expect([ko, en]).toEqual(['ko', 'en']);
    });

    it('exports DEFAULT_BRIEFING_LOCALE as ko', () => {
      expect(DEFAULT_BRIEFING_LOCALE).toBe('ko');
      const defaultLocale: BriefingLocale = DEFAULT_BRIEFING_LOCALE;
      expect(defaultLocale).toBe('ko');
    });
  });

  describe('Provider-safe extract request structures and forbidden fields', () => {
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
      | 'contentUnavailable'
      | 'locale';

    describe('BriefingExtractCandidate', () => {
      it('pins candidate keys to exactly candidateOrdinal and text', () => {
        type CandidateKeys = keyof BriefingExtractCandidate;
        type ExpectedKeys = 'candidateOrdinal' | 'text';

        type HasAllExpected = [ExpectedKeys] extends [CandidateKeys] ? true : false;
        type HasNoExtra = [CandidateKeys] extends [ExpectedKeys] ? true : false;
        type KeysExact = HasAllExpected extends true
          ? HasNoExtra extends true
            ? true
            : false
          : false;

        const isKeysExact: KeysExact = true;
        expect(isKeysExact).toBe(true);
      });

      it('proves forbidden identity, timestamp, path, URL, and key fields are absent from candidate', () => {
        type HasForbiddenKey = [ForbiddenKeys & keyof BriefingExtractCandidate] extends [never] ? false : true;
        const hasForbiddenKey: HasForbiddenKey = false;
        expect(hasForbiddenKey).toBe(false);
      });

      it('runtime candidate fixture matches allowlisted key set and contains no forbidden data on serialization', () => {
        const candidate: BriefingExtractCandidate = {
          candidateOrdinal: 0,
          text: '사격 훈련을 마치고 복귀했습니다.',
        };

        expect(Object.keys(candidate).sort()).toEqual(['candidateOrdinal', 'text']);

        const json = JSON.stringify(candidate);
        expect(json).not.toContain('recordId');
        expect(json).not.toContain('userId');
        expect(json).not.toContain('coupleId');
        expect(json).not.toContain('http');
        expect(json).not.toContain('2026-');
      });
    });

    describe('BriefingExtractRequestItem', () => {
      it('pins request item keys to exactly itemOrdinal and candidates', () => {
        type ItemKeys = keyof BriefingExtractRequestItem;
        type ExpectedKeys = 'itemOrdinal' | 'candidates';

        type HasAllExpected = [ExpectedKeys] extends [ItemKeys] ? true : false;
        type HasNoExtra = [ItemKeys] extends [ExpectedKeys] ? true : false;
        type KeysExact = HasAllExpected extends true
          ? HasNoExtra extends true
            ? true
            : false
          : false;

        const isKeysExact: KeysExact = true;
        expect(isKeysExact).toBe(true);
      });

      it('proves forbidden identity, timestamp, path, URL, and key fields are absent from request item', () => {
        type HasForbiddenKey = [ForbiddenKeys & keyof BriefingExtractRequestItem] extends [never] ? false : true;
        const hasForbiddenKey: HasForbiddenKey = false;
        expect(hasForbiddenKey).toBe(false);
      });

      it('runtime request item fixture matches allowlisted key set and contains no forbidden data on serialization', () => {
        const requestItem: BriefingExtractRequestItem = {
          itemOrdinal: 0,
          candidates: [
            { candidateOrdinal: 0, text: '오전 훈련 시작' },
            { candidateOrdinal: 1, text: '오전 훈련' },
          ],
        };

        expect(Object.keys(requestItem).sort()).toEqual(['candidates', 'itemOrdinal']);
        expect(Object.keys(requestItem.candidates[0]).sort()).toEqual(['candidateOrdinal', 'text']);

        const json = JSON.stringify(requestItem);
        expect(json).not.toContain('recordId');
        expect(json).not.toContain('userId');
        expect(json).not.toContain('coupleId');
        expect(json).not.toContain('http');
        expect(json).not.toContain('2026-');
      });
    });
  });

  describe('Untrusted provider extract plan and choice', () => {
   describe('UntrustedBriefingChoice', () => {
     it('pins choice keys to exactly itemOrdinal and candidateOrdinal', () => {
       type ChoiceKeys = keyof UntrustedBriefingChoice;
       type ExpectedKeys = 'itemOrdinal' | 'candidateOrdinal';

       type HasAllExpected = [ExpectedKeys] extends [ChoiceKeys] ? true : false;
       type HasNoExtra = [ChoiceKeys] extends [ExpectedKeys] ? true : false;
       type KeysExact = HasAllExpected extends true
         ? HasNoExtra extends true
           ? true
           : false
         : false;

       const isKeysExact: KeysExact = true;
       expect(isKeysExact).toBe(true);
     });

     it('proves choice contains NO generated, free-form, or displayable text fields', () => {
       type DisplayTextKeys = 'text' | 'claim' | 'title' | 'label' | 'summary' | 'description' | 'content';
       type HasDisplayTextKey = [DisplayTextKeys & keyof UntrustedBriefingChoice] extends [never] ? false : true;
       const hasDisplayTextKey: HasDisplayTextKey = false;
       expect(hasDisplayTextKey).toBe(false);
     });

     it('runtime choice fixture contains only numeric ordinals and exact allowlisted keys', () => {
       const choice: UntrustedBriefingChoice = {
         itemOrdinal: 0,
         candidateOrdinal: 1,
       };

       expect(Object.keys(choice).sort()).toEqual(['candidateOrdinal', 'itemOrdinal']);
       expect(typeof choice.itemOrdinal).toBe('number');
       expect(typeof choice.candidateOrdinal).toBe('number');
     });
   });

    describe('UntrustedBriefingGroup', () => {
      it('pins group keys to exactly groupOrdinal and choices', () => {
        type GroupKeys = keyof UntrustedBriefingGroup;
        type ExpectedKeys = 'groupOrdinal' | 'choices';

        type HasAllExpected = [ExpectedKeys] extends [GroupKeys] ? true : false;
        type HasNoExtra = [GroupKeys] extends [ExpectedKeys] ? true : false;
        type KeysExact = HasAllExpected extends true
          ? HasNoExtra extends true
            ? true
            : false
          : false;

        const isKeysExact: KeysExact = true;
        expect(isKeysExact).toBe(true);
      });

      it('proves group contains NO generated, free-form, or displayable text fields', () => {
        type DisplayTextKeys = 'text' | 'claim' | 'title' | 'label' | 'summary' | 'description' | 'content';
        type HasDisplayTextKey = [DisplayTextKeys & keyof UntrustedBriefingGroup] extends [never] ? false : true;
        const hasDisplayTextKey: HasDisplayTextKey = false;
        expect(hasDisplayTextKey).toBe(false);
      });

      it('runtime group fixture contains only numeric ordinals, choices, and exact allowlisted keys', () => {
        const group: UntrustedBriefingGroup = {
          groupOrdinal: 0,
          choices: [{ itemOrdinal: 0, candidateOrdinal: 1 }],
        };

        expect(Object.keys(group).sort()).toEqual(['choices', 'groupOrdinal']);
        expect(typeof group.groupOrdinal).toBe('number');
      });
    });

    describe('UntrustedBriefingGroupPlan (v2)', () => {
      it('pins group plan keys to exactly version and groups', () => {
        type PlanKeys = keyof UntrustedBriefingGroupPlan;
        type ExpectedKeys = 'version' | 'groups';

        type HasAllExpected = [ExpectedKeys] extends [PlanKeys] ? true : false;
        type HasNoExtra = [PlanKeys] extends [ExpectedKeys] ? true : false;
        type KeysExact = HasAllExpected extends true
          ? HasNoExtra extends true
            ? true
            : false
          : false;

        const isKeysExact: KeysExact = true;
        expect(isKeysExact).toBe(true);
      });

      it('proves version is strictly 2 and PARTNER_BRIEFING_PLAN_VERSION is 2', () => {
        type PlanVersion = UntrustedBriefingGroupPlan['version'];
        type IsVersionTwo = [PlanVersion] extends [2] ? ([2] extends [PlanVersion] ? true : false) : false;
        const isVersionTwo: IsVersionTwo = true;
        expect(isVersionTwo).toBe(true);
        expect(PARTNER_BRIEFING_PLAN_VERSION).toBe(2);
      });

      it('proves extract plan contains NO generated, free-form, or displayable text/claim fields', () => {
        type DisplayTextKeys = 'text' | 'claim' | 'title' | 'label' | 'summary' | 'description' | 'sections' | 'items' | 'choices';
        type HasDisplayTextKey = [DisplayTextKeys & keyof UntrustedBriefingGroupPlan] extends [never] ? false : true;
        const hasDisplayTextKey: HasDisplayTextKey = false;
        expect(hasDisplayTextKey).toBe(false);
      });

      it('runtime extract plan fixture matches allowlisted key set and has no string claim fields', () => {
        const plan: UntrustedBriefingGroupPlan = {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 1 },
                { itemOrdinal: 1, candidateOrdinal: 0 },
              ],
            },
          ],
        };

        expect(Object.keys(plan).sort()).toEqual(['groups', 'version']);
        expect(plan.version).toBe(2);
        expect(plan.groups).toHaveLength(1);
        expect(plan.groups[0].choices).toHaveLength(2);

        // Prove all choices have only numeric values
        for (const c of plan.groups[0].choices) {
          expect(typeof c.itemOrdinal).toBe('number');
          expect(typeof c.candidateOrdinal).toBe('number');
          expect(Object.keys(c).sort()).toEqual(['candidateOrdinal', 'itemOrdinal']);
        }
      });
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
        | 'contentUnavailable'
        | 'locale';

      type HasForbiddenKey = [ForbiddenKeys & keyof BriefingModelSafeEvent] extends [never] ? false : true;
      const hasForbiddenKey: HasForbiddenKey = false;
      expect(hasForbiddenKey).toBe(false);
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

  describe('Untrusted provider plan vs Verified domain types', () => {
    it('untrusted extract plan carries only version and groups with ordinals', () => {
      type UntrustedHasSourceRecordId = 'sourceRecordId' extends keyof UntrustedBriefingChoice ? true : false;
      const untrustedHasSourceRecordId: UntrustedHasSourceRecordId = false;
      expect(untrustedHasSourceRecordId).toBe(false);

      type UntrustedHasSourceRecordIds = 'sourceRecordIds' extends keyof UntrustedBriefingGroupPlan ? true : false;
      const untrustedHasSourceRecordIds: UntrustedHasSourceRecordIds = false;
      expect(untrustedHasSourceRecordIds).toBe(false);

      type UntrustedHasText = 'text' extends keyof UntrustedBriefingChoice ? true : false;
      const untrustedHasText: UntrustedHasText = false;
      expect(untrustedHasText).toBe(false);

      const rawPlan: UntrustedBriefingGroupPlan = {
        version: 2,
        groups: [
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 1 },
            ],
          },
        ],
      };
      expect(rawPlan.version).toBe(2);
      expect(rawPlan.groups[0].choices[0]).toEqual({ itemOrdinal: 0, candidateOrdinal: 0 });
      expect('sourceRecordId' in rawPlan.groups[0].choices[0]).toBe(false);
      expect('text' in rawPlan.groups[0].choices[0]).toBe(false);
    });

    describe('PartnerBriefingItemPart', () => {
      it('pins item part keys to exactly text and sourceRecordId', () => {
        type PartKeys = keyof PartnerBriefingItemPart;
        type ExpectedKeys = 'text' | 'sourceRecordId';

        type HasAllExpected = [ExpectedKeys] extends [PartKeys] ? true : false;
        type HasNoExtra = [PartKeys] extends [ExpectedKeys] ? true : false;
        type KeysExact = HasAllExpected extends true
          ? HasNoExtra extends true
            ? true
            : false
          : false;

        const isKeysExact: KeysExact = true;
        expect(isKeysExact).toBe(true);
      });

      it('verified domain item part carries attributed text and one exact bound sourceRecordId', () => {
        const part: PartnerBriefingItemPart = {
          text: '사격 훈련을 진행했습니다.',
          sourceRecordId: 'rec-uuid-001',
        };

        expect(part.text).toBe('사격 훈련을 진행했습니다.');
        expect(part.sourceRecordId).toBe('rec-uuid-001');
      });
    });

    describe('PartnerBriefingItem', () => {
      it('pins item keys to exactly parts array', () => {
        type ItemKeys = keyof PartnerBriefingItem;
        type ExpectedKeys = 'parts';

        type HasAllExpected = [ExpectedKeys] extends [ItemKeys] ? true : false;
        type HasNoExtra = [ItemKeys] extends [ExpectedKeys] ? true : false;
        type KeysExact = HasAllExpected extends true
          ? HasNoExtra extends true
            ? true
            : false
          : false;

        const isKeysExact: KeysExact = true;
        expect(isKeysExact).toBe(true);
      });

      it('verified domain item carries parts with exact extract-to-original pairing', () => {
        const item: PartnerBriefingItem = {
          parts: [
            { text: '사격 훈련 진행', sourceRecordId: 'rec-uuid-001' },
            { text: '생활관 복귀', sourceRecordId: 'rec-uuid-002' },
          ],
        };

        expect(item.parts).toHaveLength(2);
        expect(item.parts[0].sourceRecordId).toBe('rec-uuid-001');
        expect(item.parts[1].sourceRecordId).toBe('rec-uuid-002');
      });
    });

    describe('PartnerBriefingOverview', () => {
      it('verified domain overview carries exact union sourceRecordIds bound by TypeScript', () => {
        type OverviewHasSourceRecordIds = 'sourceRecordIds' extends keyof PartnerBriefingOverview ? true : false;
        const overviewHasSourceRecordIds: OverviewHasSourceRecordIds = true;
        expect(overviewHasSourceRecordIds).toBe(true);

        const overview: PartnerBriefingOverview = {
          text: '주요 훈련 일정을 소화했습니다.',
          sourceRecordIds: ['rec-001', 'rec-002'],
        };
        expect(overview.sourceRecordIds).toEqual(['rec-001', 'rec-002']);
      });
    });
  });

  describe('Final PartnerBriefing domain structure', () => {
    it('represents multi-day results with exact sourceRecordIds per item and rangeLabel', () => {
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
                items: [
                  {
                    parts: [
                      {
                        text: '오전 훈련을 진행했습니다.',
                        sourceRecordId: 'rec-001',
                      },
                    ],
                  },
                ],
              },
              {
                period: 'evening',
                items: [
                  {
                    parts: [
                      {
                        text: '체력단련을 마쳤습니다.',
                        sourceRecordId: 'rec-002',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            date: '2026-08-27',
            sections: [
              {
                period: 'afternoon',
                items: [
                  {
                    parts: [
                      {
                        text: '휴식을 취했습니다.',
                        sourceRecordId: 'rec-003',
                      },
                    ],
                  },
                ],
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
      expect(multiDayBriefing.days[0].sections[0].items).toHaveLength(1);
      expect(multiDayBriefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-001');
      expect(multiDayBriefing.days[0].sections[1].items).toHaveLength(1);
      expect(multiDayBriefing.days[0].sections[1].items[0].parts[0].sourceRecordId).toBe('rec-002');
      expect(multiDayBriefing.days[1].date).toBe('2026-08-27');
      expect(multiDayBriefing.days[1].sections).toHaveLength(1);
      expect(multiDayBriefing.days[1].sections[0].items).toHaveLength(1);
      expect(multiDayBriefing.days[1].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-003');
    });
  });
});
