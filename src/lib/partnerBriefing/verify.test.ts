import { describe, it, expect, vi } from 'vitest';
import * as chunkModule from './chunk';
import {
  hasDisallowedControlCharacters,
  isForbiddenInferenceText,
  isValidVerifyLimits,
  verifyBriefingProviderResult,
  type BriefingVerifyLimits,
} from './verify';
import type {
  BriefingProviderFailure,
  BriefingProviderSuccess,
} from './provider';

describe('Partner Briefing Verifier (Gate A6)', () => {
  const BASE_REQUEST_ID = 'req-briefing-test-123';
  const REQUESTED_ORDINALS = [0, 1, 2];

  const STANDARD_LIMITS: BriefingVerifyLimits = {
    maxSections: 16,
    maxSectionUtf8Bytes: 2048,
    maxTotalUtf8Bytes: 8192,
    maxSectionGraphemes: 1000,
  };

  const createValidSuccessResult = (
    overrides: Partial<BriefingProviderSuccess> = {},
  ): BriefingProviderSuccess => ({
    ok: true,
    requestId: BASE_REQUEST_ID,
    output: {
      sections: [
        {
          text: '오전에 운동을 다녀왔고 점심을 먹었다고 했어요.',
          sourceOrdinals: [0, 1],
        },
        {
          text: '저녁에 일찍 쉬겠다고 남겼어요.',
          sourceOrdinals: [2],
        },
      ],
    },
    ...overrides,
  });

  describe('1. Valid outputs and provenance invariants', () => {
    it('accepts valid multi-section result with exact source union coverage', () => {
      const providerResult = createValidSuccessResult();
      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]).toEqual({
        text: '오전에 운동을 다녀왔고 점심을 먹었다고 했어요.',
        sourceOrdinals: [0, 1],
      });
      expect(result.sections[1]).toEqual({
        text: '저녁에 일찍 쉬겠다고 남겼어요.',
        sourceOrdinals: [2],
      });
    });

    it('allows same known source ordinal across multiple different sections (cross-section overlap)', () => {
      const providerResult: BriefingProviderSuccess = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [
            {
              text: '오전에 산책을 다녀왔어요.',
              sourceOrdinals: [0, 1],
            },
            {
              text: '점심에 맛있는 음식을 먹고 즐거운 시간을 보냈대요.',
              sourceOrdinals: [1, 2],
            },
          ],
        },
      };

      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].sourceOrdinals).toEqual([0, 1]);
      expect(result.sections[1].sourceOrdinals).toEqual([1, 2]);
    });

    it('accepts requestedSourceOrdinals as a Set instance', () => {
      const providerResult = createValidSuccessResult();
      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: new Set([0, 1, 2]),
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result.ok).toBe(true);
    });

    it('outputs synthetic sourceOrdinals only without database IDs', () => {
      const providerResult = createValidSuccessResult();
      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const section of result.sections) {
        expect(Object.keys(section).sort()).toEqual(['sourceOrdinals', 'text']);
        for (const ord of section.sourceOrdinals) {
          expect(typeof ord).toBe('number');
        }
      }
    });

    it('accepts factual reporting text explicitly mandated by spec', () => {
      const providerResult: BriefingProviderSuccess = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [
            {
              text: '오늘 힘들었다고 남겼고 일찍 쉬겠다고 했어요',
              sourceOrdinals: [0, 1],
            },
            {
              text: '내일 전화할 가능성을 남겼어요',
              sourceOrdinals: [2],
            },
          ],
        },
      };

      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('2. Provider failure exact validation and correlation adversarial checks', () => {
    it('accepts valid failure response with ok:false, valid code, matching requestId', () => {
      const failureCodes: BriefingProviderFailure['code'][] = [
        'busy',
        'quota',
        'timeout',
        'cancelled',
        'malformed',
        'native_error',
      ];

      for (const code of failureCodes) {
        const failure: BriefingProviderFailure = {
          ok: false,
          requestId: BASE_REQUEST_ID,
          code,
        };

        const result = verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: failure,
          limits: STANDARD_LIMITS,
        });

        expect(result).toEqual({
          ok: false,
          rejection: { reason: 'provider_failed' },
        });
      }
    });

    it('accepts valid failure response with ok:false and valid code without optional requestId', () => {
      const failure: BriefingProviderFailure = {
        ok: false,
        code: 'timeout',
      };

      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult: failure,
        limits: STANDARD_LIMITS,
      });

      expect(result).toEqual({
        ok: false,
        rejection: { reason: 'provider_failed' },
      });
    });

    it('rejects provider failure if failure requestId differs from expectedRequestId with correlation_mismatch', () => {
      const failure = {
        ok: false,
        requestId: 'req-stale-mismatch-id',
        code: 'timeout',
      };

      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult: failure,
        limits: STANDARD_LIMITS,
      });

      expect(result).toEqual({
        ok: false,
        rejection: { reason: 'correlation_mismatch' },
      });
    });

    it('rejects provider failure with missing or invalid error code as invalid_structure', () => {
      const missingCode = { ok: false, requestId: BASE_REQUEST_ID };
      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: missingCode,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_structure' } });

      const invalidCode = {
        ok: false,
        requestId: BASE_REQUEST_ID,
        code: 'unknown_custom_error',
      };
      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: invalidCode,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_structure' } });
    });

    it('rejects provider failure with extra root fields as invalid_structure', () => {
      const extraField = {
        ok: false,
        requestId: BASE_REQUEST_ID,
        code: 'busy',
        extraSecret: 'leak',
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: extraField,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_structure' } });
    });

    it('rejects correlation mismatch when success requestId does not match expected', () => {
      const providerResult = createValidSuccessResult({
        requestId: 'req-stale-other-id',
      });

      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result).toEqual({
        ok: false,
        rejection: { reason: 'correlation_mismatch' },
      });
    });

    it('rejects empty or whitespace-only expectedRequestId', () => {
      const providerResult = createValidSuccessResult({
        requestId: '   ',
      });

      const result = verifyBriefingProviderResult({
        expectedRequestId: '   ',
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result).toEqual({
        ok: false,
        rejection: { reason: 'correlation_mismatch' },
      });
    });
  });

  describe('3. Non-object and structural validation', () => {
    it('rejects non-object provider results', () => {
      const invalidValues = [null, undefined, 42, 'string', true, false, [1, 2, 3]];

      for (const val of invalidValues) {
        const result = verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: val,
          limits: STANDARD_LIMITS,
        });

        expect(result).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects root object with missing required fields', () => {
      const missingOutput = { ok: true, requestId: BASE_REQUEST_ID };
      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: missingOutput,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_structure' } });
    });

    it('rejects root object with unexpected extra fields', () => {
      const extraField = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [{ text: '요약', sourceOrdinals: [0, 1, 2] }],
        },
        extraField: 'leaked_data',
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: extraField,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_structure' } });
    });

    it('rejects output with extra fields or missing sections', () => {
      const invalidOutputs = [
        { ok: true, requestId: BASE_REQUEST_ID, output: {} },
        { ok: true, requestId: BASE_REQUEST_ID, output: null },
        { ok: true, requestId: BASE_REQUEST_ID, output: 'sections' },
        {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            sections: [{ text: '요약', sourceOrdinals: [0, 1, 2] }],
            extra: 123,
          },
        },
      ];

      for (const providerResult of invalidOutputs) {
        const result = verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        });
        expect(result).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects sections array if not an array', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: { sections: 'not an array' },
      };
      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_structure' } });
    });

    it('rejects section element with extra fields or missing fields', () => {
      const withExtraField = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [
            {
              text: '요약',
              sourceOrdinals: [0, 1, 2],
              recordId: 'rec-123',
            },
          ],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult: withExtraField,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure', sectionIndex: 0 },
      });
    });
  });

  describe('4. Section count limits', () => {
    it('rejects zero sections with invalid_section_count', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: { sections: [] },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_section_count' },
      });
    });

    it('rejects excessive section count exceeding limits.maxSections', () => {
      const customLimits: BriefingVerifyLimits = {
        maxSections: 2,
        maxSectionUtf8Bytes: 2048,
        maxTotalUtf8Bytes: 8192,
      };

      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [
            { text: 'A', sourceOrdinals: [0] },
            { text: 'B', sourceOrdinals: [1] },
            { text: 'C', sourceOrdinals: [2] },
          ],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: customLimits,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_section_count' },
      });
    });
  });

  describe('5. Text validation, grapheme error rejection, and embedded control checks', () => {
    it('rejects empty and whitespace-only text with invalid_text', () => {
      const emptyTexts = ['', '   ', '\t\n\r', ' \n '];

      for (const t of emptyTexts) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            sections: [{ text: t, sourceOrdinals: [0, 1, 2] }],
          },
        };

        expect(
          verifyBriefingProviderResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedSourceOrdinals: REQUESTED_ORDINALS,
            providerResult,
            limits: STANDARD_LIMITS,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_text', sectionIndex: 0 },
        });
      }
    });

    it('rejects embedded disallowed C0/C1 control characters in otherwise nonempty text', () => {
      const embeddedControlTexts = [
        'hello\u0000world',
        'hello\u0007world', // Bell
        'hello\u0008world', // Backspace
        'hello\u001bworld', // ESC
        'hello\u007fworld', // DEL
        'hello\u0080world', // C1
        'hello\u009fworld', // C1
      ];

      for (const t of embeddedControlTexts) {
        expect(hasDisallowedControlCharacters(t)).toBe(true);

        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            sections: [{ text: t, sourceOrdinals: [0, 1, 2] }],
          },
        };

        expect(
          verifyBriefingProviderResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedSourceOrdinals: REQUESTED_ORDINALS,
            providerResult,
            limits: STANDARD_LIMITS,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_text', sectionIndex: 0 },
        });
      }
    });

    it('allows standard normal newlines, tabs, and carriage returns in text', () => {
      const normalWhitespaceText = '첫째 줄\n둘째 줄\t탭 구분\r\n셋째 줄';
      expect(hasDisallowedControlCharacters(normalWhitespaceText)).toBe(false);

      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [{ text: normalWhitespaceText, sourceOrdinals: [0, 1, 2] }],
        },
      };

      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits: STANDARD_LIMITS,
      });

      expect(result.ok).toBe(true);
    });

    it('rejects section text exceeding maxSectionUtf8Bytes', () => {
      const limits: BriefingVerifyLimits = {
        maxSections: 16,
        maxSectionUtf8Bytes: 20,
        maxTotalUtf8Bytes: 100,
      };

      const longText = '가나다라마바사아자차'; // 10 Korean chars = 30 UTF-8 bytes
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [{ text: longText, sourceOrdinals: [0, 1, 2] }],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_text', sectionIndex: 0 },
      });
    });

    it('rejects total text exceeding maxTotalUtf8Bytes', () => {
      const limits: BriefingVerifyLimits = {
        maxSections: 16,
        maxSectionUtf8Bytes: 25,
        maxTotalUtf8Bytes: 40,
      };

      const textA = '가나다라마바'; // 6 chars * 3 = 18 bytes
      const textB = '사아자차카타'; // 6 chars * 3 = 18 bytes
      const textC = '파하가나다라'; // 6 chars * 3 = 18 bytes (total = 54 > 40)

      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [
            { text: textA, sourceOrdinals: [0] },
            { text: textB, sourceOrdinals: [1] },
            { text: textC, sourceOrdinals: [2] },
          ],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_text', sectionIndex: 2 },
      });
    });

    it('rejects section text exceeding maxSectionGraphemes when configured', () => {
      const limits: BriefingVerifyLimits = {
        maxSections: 16,
        maxSectionUtf8Bytes: 2048,
        maxTotalUtf8Bytes: 8192,
        maxSectionGraphemes: 5,
      };

      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [{ text: '여섯글자입니다', sourceOrdinals: [0, 1, 2] }],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_text', sectionIndex: 0 },
      });
    });

    it('rejects invalid_text when countGraphemes returns null with maxSectionGraphemes present', () => {
      const countGraphemesSpy = vi
        .spyOn(chunkModule, 'countGraphemes')
        .mockReturnValue(null);

      const limits: BriefingVerifyLimits = {
        maxSections: 16,
        maxSectionUtf8Bytes: 2048,
        maxTotalUtf8Bytes: 8192,
        maxSectionGraphemes: 50,
      };

      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [{ text: '정상 텍스트입니다', sourceOrdinals: [0, 1, 2] }],
        },
      };

      const result = verifyBriefingProviderResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedSourceOrdinals: REQUESTED_ORDINALS,
        providerResult,
        limits,
      });

      expect(result).toEqual({
        ok: false,
        rejection: { reason: 'invalid_text', sectionIndex: 0 },
      });

      countGraphemesSpy.mockRestore();
    });
  });

  describe('6. Ordinal invariants: non-integer, negative, duplicate, unknown, missing', () => {
    it('rejects non-array or empty sourceOrdinals in a section', () => {
      const invalidOrdinals = ['0', null, undefined, {}, []];

      for (const ords of invalidOrdinals) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            sections: [{ text: '요약', sourceOrdinals: ords }],
          },
        };

        const result = verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(
            result.rejection.reason === 'invalid_ordinals' ||
              result.rejection.reason === 'invalid_structure',
          ).toBe(true);
        }
      }
    });

    it('rejects non-integer ordinals (float, NaN, string-encoded)', () => {
      const invalidValues = [0.5, 1.2, NaN, Infinity, '1'];

      for (const val of invalidValues) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            sections: [{ text: '요약', sourceOrdinals: [val as unknown as number, 1, 2] }],
          },
        };

        const result = verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.rejection.reason).toBe('invalid_ordinals');
          expect(result.rejection.sectionIndex).toBe(0);
        }
      }
    });

    it('rejects negative ordinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [{ text: '요약', sourceOrdinals: [-1, 0, 1, 2] }],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_ordinals', sectionIndex: 0, ordinal: -1 },
      });
    });

    it('rejects unknown / hallucinated ordinals not in requestedSourceOrdinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [{ text: '요약', sourceOrdinals: [0, 1, 2, 99] }],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_ordinals', sectionIndex: 0, ordinal: 99 },
      });
    });

    it('rejects duplicate ordinal within the same section', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [
            { text: '첫째', sourceOrdinals: [0, 0, 1] },
            { text: '둘째', sourceOrdinals: [2] },
          ],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({
        ok: false,
        rejection: {
          reason: 'duplicate_ordinal_in_section',
          sectionIndex: 0,
          ordinal: 0,
        },
      });
    });

    it('rejects when requestedSourceOrdinals contains missing items (incomplete coverage)', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          sections: [
            { text: '첫째', sourceOrdinals: [0] },
            { text: '둘째', sourceOrdinals: [1] },
          ],
        },
      };

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'incomplete_source_coverage' },
      });
    });
  });

  describe('7. Conservative semantic safety rejection (psychological, emotional, relationship, health, intent)', () => {
    const forbiddenExamples = [
      '우울해 보였다',
      '정서적으로 지쳤다',
      '관계에 불안을 느꼈다',
      '많이 보고 싶어 한 것 같아요',
      '심리적으로 지친 하루였습니다',
      '마음이 식은 것 같아요',
      '외로움을 느꼈던 것 같아요',
      '불안해 보였어요',
      '힘들어했던 것 같아요',
      '보고 싶었던 것 같아요',
      '우울감을 느꼈다',
      '오늘 피곤했던 것으로 추측된다',
      '우울증 증세를 보인 것 같다',
      '지쳐 보이네요',
      '서운해했던 것 같아요',
      '관계가 소원해진 모양이다',
      '애정도가 감소한 것으로 추정됩니다',
      '공황 발작을 겪은 듯하다',
      '속상해 보였어요',
      '마음이 멀어진 것 같아요',
      'seemed depressed after work',
      'felt relationship insecurity',
      // Health / illness speculation cases
      '건강이 안 좋아 보였다',
      '감기인 것 같다',
      '아픈 듯했다',
      '몸살에 걸린 것 같아요',
      '아파 보였어요',
      '건강이 나빠진 것 같다',
      '독감인 듯하다',
      'seemed sick today',
    ];

    for (const phrase of forbiddenExamples) {
      it(`rejects forbidden inference phrase: "${phrase}"`, () => {
        expect(isForbiddenInferenceText(phrase)).toBe(true);

        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            sections: [{ text: phrase, sourceOrdinals: [0, 1, 2] }],
          },
        };

        expect(
          verifyBriefingProviderResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedSourceOrdinals: REQUESTED_ORDINALS,
            providerResult,
            limits: STANDARD_LIMITS,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'forbidden_inference', sectionIndex: 0 },
        });
      });
    }

    const allowedFactualExamples = [
      '오늘 힘들었다고 남겼고 일찍 쉬겠다고 했어요',
      '내일 전화할 가능성을 남겼어요',
      '보고 싶다고 했어요',
      '점심에 피자를 먹었다고 적었어요',
      '오전에 산책을 다녀왔어요',
      '기분이 좋았다고 남겼어요',
      '사진 1장을 남겼어요',
      '우울하다고 기록했어요',
      '오늘 많이 힘들었대요',
      '내일 만날 예정이라고 했어요',
      '저녁에 피곤해서 먼저 잔다고 남겼어요',
      '감기 기운이 있다고 남겼어요',
      '병원에 다녀왔다고 했어요',
      '약 먹고 자겠다고 적었어요',
    ];

    for (const phrase of allowedFactualExamples) {
      it(`allows factual statement: "${phrase}"`, () => {
        expect(isForbiddenInferenceText(phrase)).toBe(false);

        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            sections: [{ text: phrase, sourceOrdinals: [0, 1, 2] }],
          },
        };

        const result = verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: STANDARD_LIMITS,
        });

        expect(result.ok).toBe(true);
      });
    }
  });

  describe('8. Input parameter validation', () => {
    it('rejects invalid verify limits structure', () => {
      expect(isValidVerifyLimits(null)).toBe(false);
      expect(isValidVerifyLimits({})).toBe(false);
      expect(
        isValidVerifyLimits({
          maxSections: 0,
          maxSectionUtf8Bytes: 100,
          maxTotalUtf8Bytes: 100,
        }),
      ).toBe(false);
      expect(
        isValidVerifyLimits({
          maxSections: 5,
          maxSectionUtf8Bytes: -1,
          maxTotalUtf8Bytes: 100,
        }),
      ).toBe(false);
      expect(
        isValidVerifyLimits({
          maxSections: 5,
          maxSectionUtf8Bytes: 100,
          maxTotalUtf8Bytes: 100,
          unknownExtra: 1,
        }),
      ).toBe(false);
      expect(isValidVerifyLimits(STANDARD_LIMITS)).toBe(true);
    });

    it('rejects when limits is missing or invalid in verifyBriefingProviderResult', () => {
      const providerResult = createValidSuccessResult();
      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: REQUESTED_ORDINALS,
          providerResult,
          limits: undefined as unknown as BriefingVerifyLimits,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_structure' } });
    });

    it('rejects invalid requestedSourceOrdinals (non-integer, negative)', () => {
      const providerResult = createValidSuccessResult();
      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: [0, -1] as number[],
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_ordinals' } });

      expect(
        verifyBriefingProviderResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedSourceOrdinals: 'invalid' as unknown as number[],
          providerResult,
          limits: STANDARD_LIMITS,
        }),
      ).toEqual({ ok: false, rejection: { reason: 'invalid_ordinals' } });
    });
  });
});
