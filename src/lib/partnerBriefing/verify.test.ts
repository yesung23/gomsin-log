import { describe, it, expect } from 'vitest';
import {
  hasDisallowedControlCharacters,
  verifyBriefingExtractResult,
  type BriefingExtractVerifyInput,
} from './verify';
import type {
  BriefingExtractFailure,
  BriefingExtractRequestItem,
  BriefingExtractSuccess,
  BriefingProviderErrorCode,
} from './provider';

describe('Partner Briefing Closed-Extract Verifier (Gate A6 Amendment)', () => {
  const BASE_REQUEST_ID = 'req-extract-test-123';

  const createValidExtractRequestItems = (): BriefingExtractRequestItem[] => [
    {
      itemOrdinal: 0,
      candidates: [
        { candidateOrdinal: 0, text: '오전에 운동 다녀왔어요' },
        { candidateOrdinal: 1, text: '아침에 헬스장' },
      ],
    },
    {
      itemOrdinal: 1,
      candidates: [
        { candidateOrdinal: 0, text: '점심에 피자 먹었어요' },
        { candidateOrdinal: 1, text: '피자 주문' },
        { candidateOrdinal: 2, text: '점심 식사' },
      ],
    },
    {
      itemOrdinal: 2,
      candidates: [
        { candidateOrdinal: 0, text: '저녁에 일찍 잘게요' },
      ],
    },
  ];

  const createValidExtractSuccessResult = (
    overrides: Record<string, unknown> = {},
  ) => ({
    ok: true,
    requestId: BASE_REQUEST_ID,
    output: {
      version: 1,
      choices: [
        { itemOrdinal: 0, candidateOrdinal: 0 },
        { itemOrdinal: 1, candidateOrdinal: 1 },
        { itemOrdinal: 2, candidateOrdinal: 0 },
      ],
    },
    ...overrides,
  });

  describe('1. Valid extract plan acceptance & numeric output invariants', () => {
    it('accepts valid multi-item request with exact ordinal choices in request order', () => {
      const requestedItems = createValidExtractRequestItems();
      const providerResult = createValidExtractSuccessResult();

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result).toEqual({
        ok: true,
        choices: [
          { itemOrdinal: 0, candidateOrdinal: 0 },
          { itemOrdinal: 1, candidateOrdinal: 1 },
          { itemOrdinal: 2, candidateOrdinal: 0 },
        ],
      });
    });

    it('accepts single-item request with non-zero candidate choice', () => {
      const requestedItems: BriefingExtractRequestItem[] = [
        {
          itemOrdinal: 0,
          candidates: [
            { candidateOrdinal: 0, text: '후보 0' },
            { candidateOrdinal: 1, text: '후보 1' },
          ],
        },
      ];
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [{ itemOrdinal: 0, candidateOrdinal: 1 }],
        },
      };

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result).toEqual({
        ok: true,
        choices: [{ itemOrdinal: 0, candidateOrdinal: 1 }],
      });
    });

    it('ensures verified result contains ONLY numeric choices and zero text or database IDs', () => {
      const requestedItems = createValidExtractRequestItems();
      const providerResult = createValidExtractSuccessResult();

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const rootKeys = Object.keys(result);
        expect(rootKeys.sort()).toEqual(['choices', 'ok']);
        for (const choice of result.choices) {
          const choiceKeys = Object.keys(choice);
          expect(choiceKeys.sort()).toEqual(['candidateOrdinal', 'itemOrdinal']);
          expect(Number.isSafeInteger(choice.itemOrdinal)).toBe(true);
          expect(Number.isSafeInteger(choice.candidateOrdinal)).toBe(true);
        }
      }
    });

    it('rejects invalid or non-object input parameter with invalid_request', () => {
      const invalidInputs = [null, undefined, 'string', 123, []];
      for (const val of invalidInputs) {
        expect(
          verifyBriefingExtractResult(val as unknown as BriefingExtractVerifyInput),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_request' },
        });
      }
    });
  });

  describe('2. Zero-item request behavior (explicitly documented)', () => {
    it('accepts empty requested items with empty choices output', () => {
      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems: [],
        providerResult: {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 1,
            choices: [],
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        choices: [],
      });
    });

    it('rejects empty requested items when provider returns non-empty choices', () => {
      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems: [],
        providerResult: {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 1,
            choices: [{ itemOrdinal: 0, candidateOrdinal: 0 }],
          },
        },
      });

      expect(result).toEqual({
        ok: false,
        rejection: { reason: 'invalid_choices' },
      });
    });
  });

  describe('3. Adversarial extra fields & P1 mechanical proof (prose rejection)', () => {
    it('rejects provider result carrying extra root field with arbitrary prose ("상대는 이별을 원한다")', () => {
      const requestedItems = createValidExtractRequestItems();
      const maliciousResult = {
        ...createValidExtractSuccessResult(),
        text: '상대는 이별을 원한다',
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult: maliciousResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });
    });

    it('rejects provider result with extra root keys (claim, title, label, summary, extra)', () => {
      const requestedItems = createValidExtractRequestItems();
      const extraRootKeys = [
        { claim: '불안해 보인다' },
        { title: '오늘의 요약' },
        { label: '이별' },
        { summary: '정서적 지침' },
        { extra: 123 },
      ];

      for (const extra of extraRootKeys) {
        const providerResult = {
          ...createValidExtractSuccessResult(),
          ...extra,
        };
        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects output level carrying extra fields (text, claim, title, label, summary, content, sections)', () => {
      const requestedItems = createValidExtractRequestItems();
      const extraOutputFields = [
        { text: '상대는 이별을 원한다' },
        { claim: '추측된 감정' },
        { title: '타이틀' },
        { label: '위험' },
        { summary: '요약문' },
        { content: '본문' },
        { sections: [] },
        { extra: true },
      ];

      for (const extra of extraOutputFields) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 1,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 1 },
              { itemOrdinal: 2, candidateOrdinal: 0 },
            ],
            ...extra,
          },
        };

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects choice carrying extra fields (text, claim, title, prose, comment)', () => {
      const requestedItems = createValidExtractRequestItems();
      const extraChoiceFields = [
        { text: '상대는 이별을 원한다' },
        { claim: '불안감 추측' },
        { title: '이별 신호' },
        { prose: '요약 생성' },
        { comment: '자유 텍스트' },
        { extra: 123 },
      ];

      for (const extra of extraChoiceFields) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 1,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0, ...extra },
              { itemOrdinal: 1, candidateOrdinal: 1 },
              { itemOrdinal: 2, candidateOrdinal: 0 },
            ],
          },
        };

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure', itemOrdinal: 0 },
        });
      }
    });
  });

  describe('4. Provider result root structure & type invariants', () => {
    const requestedItems = createValidExtractRequestItems();

    it('rejects non-object root (null, undefined, string, number, boolean, array)', () => {
      const nonObjects = [null, undefined, 'string', 123, true, false, []];

      for (const val of nonObjects) {
        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult: val,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects empty object or missing ok', () => {
      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult: {},
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });
    });

    it('rejects non-boolean ok values (string "true", number 1)', () => {
      const invalidOks = ['true', 'false', 1, 0, null, {}];
      for (const val of invalidOks) {
        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult: {
              ok: val,
              requestId: BASE_REQUEST_ID,
              output: { version: 1, choices: [] },
            },
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects success missing output or requestId', () => {
      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult: {
            ok: true,
            requestId: BASE_REQUEST_ID,
          },
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult: {
            ok: true,
            output: { version: 1, choices: [] },
          },
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });
    });
  });

  describe('5. Request ID correlation & format', () => {
    const requestedItems = createValidExtractRequestItems();

    it('rejects mismatched requestId in success response with correlation_mismatch', () => {
      const providerResult = createValidExtractSuccessResult({
        requestId: 'wrong-request-id',
      });

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'correlation_mismatch' },
      });
    });

    it('rejects empty or whitespace-only requestId in success response', () => {
      const emptyReqIds = ['', '   ', String.fromCharCode(9, 10)];
      for (const reqId of emptyReqIds) {
        const providerResult = createValidExtractSuccessResult({
          requestId: reqId,
        });

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects non-string requestId in success response', () => {
      const providerResult = createValidExtractSuccessResult({
        requestId: 12345,
      });

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });
    });

    it('rejects mismatched requestId in failure response with correlation_mismatch', () => {
      const providerResult: BriefingExtractFailure = {
        ok: false,
        code: 'timeout',
        requestId: 'different-request-id',
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'correlation_mismatch' },
      });
    });

    it('accepts failure response without requestId as provider_failed', () => {
      const providerResult: BriefingExtractFailure = {
        ok: false,
        code: 'busy',
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'provider_failed' },
      });
    });

    it('rejects failure response with non-string requestId', () => {
      const providerResult = {
        ok: false,
        code: 'busy',
        requestId: 999,
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });
    });
  });

  describe('6. Provider failure codes & error bounds', () => {
    const requestedItems = createValidExtractRequestItems();
    const validErrorCodes: BriefingProviderErrorCode[] = [
      'busy',
      'quota',
      'timeout',
      'cancelled',
      'malformed',
      'native_error',
    ];

    for (const code of validErrorCodes) {
      it('accepts failure code "' + code + '" and rejects with provider_failed', () => {
        const providerResult: BriefingExtractFailure = {
          ok: false,
          code,
          requestId: BASE_REQUEST_ID,
        };

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'provider_failed' },
        });
      });
    }

    it('rejects unknown provider error codes with invalid_structure', () => {
      const providerResult = {
        ok: false,
        code: 'unknown_failure_code',
        requestId: BASE_REQUEST_ID,
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });
    });

    it('rejects failure result with extra fields with invalid_structure', () => {
      const providerResult = {
        ok: false,
        code: 'timeout',
        requestId: BASE_REQUEST_ID,
        message: 'Timeout occurred while waiting for model',
        extra: 123,
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_structure' },
      });
    });
  });

  describe('7. Output version invariants', () => {
    const requestedItems = createValidExtractRequestItems();

    it('rejects version other than 1 with invalid_version', () => {
      const invalidVersions = [2, 0, -1, 1.5, '1', null, undefined, {}];

      for (const ver of invalidVersions) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: ver,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 1 },
              { itemOrdinal: 2, candidateOrdinal: 0 },
            ],
          },
        };

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_version' },
        });
      }
    });
  });

  describe('8. Choices array structure & length invariants', () => {
    const requestedItems = createValidExtractRequestItems();

    it('rejects non-array choices in output', () => {
      const nonArrayChoices = [null, undefined, 'choices', 123, true, {}];

      for (const val of nonArrayChoices) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 1,
            choices: val,
          },
        };

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure' },
        });
      }
    });

    it('rejects choices length fewer than requested items with invalid_choices', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_choices' },
      });
    });

    it('rejects choices length greater than requested items with invalid_choices', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
            { itemOrdinal: 3, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_choices' },
      });
    });

    it('rejects non-object choice element', () => {
      const nonObjectChoices = [null, undefined, 123, 'choice', []];

      for (const val of nonObjectChoices) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 1,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              val,
              { itemOrdinal: 2, candidateOrdinal: 0 },
            ],
          },
        };

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_structure', itemOrdinal: 1 },
        });
      }
    });

    it('rejects choice missing itemOrdinal or candidateOrdinal', () => {
      const missingFieldChoices = [
        { itemOrdinal: 0 },
        { candidateOrdinal: 0 },
        {},
      ];

      for (const c of missingFieldChoices) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 1,
            choices: [
              c,
              { itemOrdinal: 1, candidateOrdinal: 1 },
              { itemOrdinal: 2, candidateOrdinal: 0 },
            ],
          },
        };

        const res = verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        });

        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(
            res.rejection.reason === 'invalid_structure' ||
              res.rejection.reason === 'invalid_ordinals',
          ).toBe(true);
        }
      }
    });
  });

  describe('9. Item ordinal invariants (order, duplicates, negative, fractional, unknown)', () => {
    const requestedItems = createValidExtractRequestItems();

    it('rejects negative itemOrdinal with unknown_item', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: -1, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'unknown_item', itemOrdinal: -1 },
      });
    });

    it('rejects fractional itemOrdinal with invalid_ordinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0.5, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_ordinals', itemOrdinal: 0.5 },
      });
    });

    it('rejects string itemOrdinal with invalid_ordinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: '0' as unknown as number, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_ordinals' },
      });
    });

    it('rejects out-of-range itemOrdinal with unknown_item', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 99, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'unknown_item', itemOrdinal: 99 },
      });
    });

    it('rejects duplicate itemOrdinal with reordered_choices', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: 0 },
            { itemOrdinal: 0, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'reordered_choices', itemOrdinal: 0 },
      });
    });

    it('rejects reordered choices with reordered_choices', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 1, candidateOrdinal: 0 },
            { itemOrdinal: 0, candidateOrdinal: 0 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'reordered_choices', itemOrdinal: 1 },
      });
    });
  });

  describe('10. Candidate ordinal invariants (bounds, unknown, negative, fractional)', () => {
    const requestedItems = createValidExtractRequestItems();

    it('rejects negative candidateOrdinal with unknown_candidate', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: -1 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'unknown_candidate', itemOrdinal: 0, candidateOrdinal: -1 },
      });
    });

    it('rejects fractional candidateOrdinal with invalid_ordinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: 0.5 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_ordinals', itemOrdinal: 0, candidateOrdinal: 0.5 },
      });
    });

    it('rejects candidateOrdinal out of bounds for that specific item with unknown_candidate', () => {
      // item 0 has 2 candidates (0 and 1)
      const providerResultA = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: 2 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult: providerResultA,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'unknown_candidate', itemOrdinal: 0, candidateOrdinal: 2 },
      });

      // item 2 has 1 candidate (0)
      const providerResultB = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 0 },
            { itemOrdinal: 2, candidateOrdinal: 1 },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems,
          providerResult: providerResultB,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'unknown_candidate', itemOrdinal: 2, candidateOrdinal: 1 },
      });
    });
  });

  describe('11. Request validation fail-closed', () => {
    const providerResult = createValidExtractSuccessResult();

    it('rejects non-array requestedItems with invalid_request', () => {
      const invalidRequests = [null, undefined, 'not-array', 123, {}];

      for (const val of invalidRequests) {
        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems: val as unknown as BriefingExtractRequestItem[],
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_request' },
        });
      }
    });

    it('rejects non-sequential item ordinals in request items', () => {
      const badItems: BriefingExtractRequestItem[] = [
        {
          itemOrdinal: 1, // should be 0
          candidates: [{ candidateOrdinal: 0, text: '테스트' }],
        },
      ];

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: badItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_request', itemOrdinal: 1 },
      });
    });

    it('rejects empty candidates array in request item', () => {
      const badItems: BriefingExtractRequestItem[] = [
        {
          itemOrdinal: 0,
          candidates: [],
        },
      ];

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: badItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_request', itemOrdinal: 0 },
      });
    });

    it('rejects non-sequential candidate ordinals in request candidate', () => {
      const badItems: BriefingExtractRequestItem[] = [
        {
          itemOrdinal: 0,
          candidates: [{ candidateOrdinal: 1, text: '후보 1' }], // should be 0
        },
      ];

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: badItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_request', itemOrdinal: 0, candidateOrdinal: 1 },
      });
    });

    it('rejects empty or whitespace-only candidate text in request item', () => {
      const emptyTexts = ['', '   ', String.fromCharCode(9, 10)];

      for (const t of emptyTexts) {
        const badItems: BriefingExtractRequestItem[] = [
          {
            itemOrdinal: 0,
            candidates: [{ candidateOrdinal: 0, text: t }],
          },
        ];

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems: badItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_request', itemOrdinal: 0, candidateOrdinal: 0 },
        });
      }
    });

    it('rejects candidate text containing disallowed control characters', () => {
      const controlTexts = [
        'hello\u0000world',
        'hello\u0007world',
        'hello\u001bworld',
        'hello\u007fworld',
        'hello\u0080world',
      ];

      for (const t of controlTexts) {
        const badItems: BriefingExtractRequestItem[] = [
          {
            itemOrdinal: 0,
            candidates: [{ candidateOrdinal: 0, text: t }],
          },
        ];

        expect(
          verifyBriefingExtractResult({
            expectedRequestId: BASE_REQUEST_ID,
            requestedItems: badItems,
            providerResult,
          }),
        ).toEqual({
          ok: false,
          rejection: { reason: 'invalid_request', itemOrdinal: 0, candidateOrdinal: 0 },
        });
      }
    });

    it('rejects request item with unexpected extra fields', () => {
      const badItems = [
        {
          itemOrdinal: 0,
          candidates: [{ candidateOrdinal: 0, text: '정상 텍스트' }],
          recordId: 'rec-123',
        },
      ] as unknown as BriefingExtractRequestItem[];

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: badItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_request', itemOrdinal: 0 },
      });
    });
  });

  describe('12. Bounded rejection metadata guarantees', () => {
    const requestedItems = createValidExtractRequestItems();

    it('guarantees rejection metadata never leaks candidate text, messages, or user content', () => {
      const providerResult = {
        ok: false,
        code: 'timeout',
        requestId: BASE_REQUEST_ID,
      };

      const res = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        const keys = Object.keys(res.rejection);
        expect(keys.every((k) => k === 'reason' || k === 'itemOrdinal' || k === 'candidateOrdinal')).toBe(true);
        expect(typeof res.rejection.reason).toBe('string');
      }
    });
  });
});
