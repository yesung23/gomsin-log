import { describe, it, expect } from 'vitest';
import {
  hasDisallowedControlCharacters,
  verifyBriefingExtractResult,
  type BriefingExtractVerifyInput,
} from './verify';
import type {
  BriefingExtractFailure,
  BriefingExtractRequestItem,
  BriefingProviderErrorCode,
} from './provider';

describe('Partner Briefing Closed-Extract Verifier (v2 Group Plan)', () => {
  const BASE_REQUEST_ID = 'req-extract-test-123';

  const createValidExtractRequestItems = (count: number = 3): BriefingExtractRequestItem[] => {
    const items: BriefingExtractRequestItem[] = [];
    for (let i = 0; i < count; i += 1) {
      items.push({
        itemOrdinal: i,
        candidates: [
          { candidateOrdinal: 0, text: `후보 0 (항목 ${i})` },
          { candidateOrdinal: 1, text: `후보 1 (항목 ${i})` },
          { candidateOrdinal: 2, text: `후보 2 (항목 ${i})` },
        ],
      });
    }
    return items;
  };

  const createValidExtractSuccessResult = (
    overrides: Record<string, unknown> = {},
  ) => ({
    ok: true,
    requestId: BASE_REQUEST_ID,
    output: {
      version: 2,
      groups: [
        {
          groupOrdinal: 0,
          choices: [
            { itemOrdinal: 0, candidateOrdinal: 0 },
            { itemOrdinal: 1, candidateOrdinal: 1 },
            { itemOrdinal: 2, candidateOrdinal: 0 },
          ],
        },
      ],
    },
    ...overrides,
  });

  describe('1. Valid group plan acceptance & numeric output invariants', () => {
    it('accepts valid 3-item request with single group of 3 choices in request order', () => {
      const requestedItems = createValidExtractRequestItems(3);
      const providerResult = createValidExtractSuccessResult();

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result).toEqual({
        ok: true,
        groups: [
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 1 },
              { itemOrdinal: 2, candidateOrdinal: 0 },
            ],
          },
        ],
      });
    });

    it('accepts single-item request (N=1) with exactly one singleton group', () => {
      const requestedItems = createValidExtractRequestItems(1);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [{ itemOrdinal: 0, candidateOrdinal: 2 }],
            },
          ],
        },
      };

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result).toEqual({
        ok: true,
        groups: [
          {
            groupOrdinal: 0,
            choices: [{ itemOrdinal: 0, candidateOrdinal: 2 }],
          },
        ],
      });
    });

    it('accepts valid partition of 2 items into 1 group of size 2', () => {
      const requestedItems = createValidExtractRequestItems(2);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
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
        },
      };

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result).toEqual({
        ok: true,
        groups: [
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 1 },
              { itemOrdinal: 1, candidateOrdinal: 0 },
            ],
          },
        ],
      });
    });

    it('accepts valid partition of 5 items into 2 groups (size 3 + size 2)', () => {
      const requestedItems = createValidExtractRequestItems(5);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 2 },
              ],
            },
            {
              groupOrdinal: 1,
              choices: [
                { itemOrdinal: 3, candidateOrdinal: 0 },
                { itemOrdinal: 4, candidateOrdinal: 1 },
              ],
            },
          ],
        },
      };

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result).toEqual({
        ok: true,
        groups: [
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 1 },
              { itemOrdinal: 2, candidateOrdinal: 2 },
            ],
          },
          {
            groupOrdinal: 1,
            choices: [
              { itemOrdinal: 3, candidateOrdinal: 0 },
              { itemOrdinal: 4, candidateOrdinal: 1 },
            ],
          },
        ],
      });
    });

    it('accepts valid partition of 8 items into 2 groups (size 4 + size 4)', () => {
      const requestedItems = createValidExtractRequestItems(8);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 2 },
                { itemOrdinal: 3, candidateOrdinal: 0 },
              ],
            },
            {
              groupOrdinal: 1,
              choices: [
                { itemOrdinal: 4, candidateOrdinal: 1 },
                { itemOrdinal: 5, candidateOrdinal: 2 },
                { itemOrdinal: 6, candidateOrdinal: 0 },
                { itemOrdinal: 7, candidateOrdinal: 1 },
              ],
            },
          ],
        },
      };

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.groups.length).toBe(2);
        expect(result.groups[0].choices.length).toBe(4);
        expect(result.groups[1].choices.length).toBe(4);
      }
    });

    it('ensures verified result contains ONLY numeric ordinals and zero text or database IDs', () => {
      const requestedItems = createValidExtractRequestItems(3);
      const providerResult = createValidExtractSuccessResult();

      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems,
        providerResult,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const rootKeys = Object.keys(result);
        expect(rootKeys.sort()).toEqual(['groups', 'ok']);
        for (const grp of result.groups) {
          const grpKeys = Object.keys(grp);
          expect(grpKeys.sort()).toEqual(['choices', 'groupOrdinal']);
          expect(Number.isSafeInteger(grp.groupOrdinal)).toBe(true);
          for (const choice of grp.choices) {
            const choiceKeys = Object.keys(choice);
            expect(choiceKeys.sort()).toEqual(['candidateOrdinal', 'itemOrdinal']);
            expect(Number.isSafeInteger(choice.itemOrdinal)).toBe(true);
            expect(Number.isSafeInteger(choice.candidateOrdinal)).toBe(true);
          }
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
    it('accepts empty requested items with empty groups output', () => {
      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems: [],
        providerResult: {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 2,
            groups: [],
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        groups: [],
      });
    });

    it('rejects empty requested items when provider returns non-empty groups', () => {
      const result = verifyBriefingExtractResult({
        expectedRequestId: BASE_REQUEST_ID,
        requestedItems: [],
        providerResult: {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 2,
            groups: [
              {
                groupOrdinal: 0,
                choices: [{ itemOrdinal: 0, candidateOrdinal: 0 }],
              },
            ],
          },
        },
      });

      expect(result).toEqual({
        ok: false,
        rejection: { reason: 'invalid_groups' },
      });
    });
  });

  describe('3. Group size constraints (N>=2 rejects singletons and oversized >4)', () => {
    it('rejects singleton group (size 1) when N=2 (e.g. 2 singleton groups)', () => {
      const requestedItems = createValidExtractRequestItems(2);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [{ itemOrdinal: 0, candidateOrdinal: 0 }],
            },
            {
              groupOrdinal: 1,
              choices: [{ itemOrdinal: 1, candidateOrdinal: 1 }],
            },
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
        rejection: { reason: 'invalid_groups', groupOrdinal: 0 },
      });
    });

    it('rejects trailing singleton group when N=5 (e.g. size 4 + size 1)', () => {
      const requestedItems = createValidExtractRequestItems(5);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 2 },
                { itemOrdinal: 3, candidateOrdinal: 0 },
              ],
            },
            {
              groupOrdinal: 1,
              choices: [{ itemOrdinal: 4, candidateOrdinal: 1 }],
            },
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
        rejection: { reason: 'invalid_groups', groupOrdinal: 1 },
      });
    });

    it('rejects oversized group with choices.length > 4 (e.g. size 5)', () => {
      const requestedItems = createValidExtractRequestItems(5);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 2 },
                { itemOrdinal: 3, candidateOrdinal: 0 },
                { itemOrdinal: 4, candidateOrdinal: 1 },
              ],
            },
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
        rejection: { reason: 'invalid_groups', groupOrdinal: 0 },
      });
    });

    it('rejects empty choices array in a group for N>=1', () => {
      const requestedItems = createValidExtractRequestItems(2);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [],
            },
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
        rejection: { reason: 'invalid_groups', groupOrdinal: 0 },
      });
    });
  });

  describe('4. Adversarial extra fields & P1 mechanical proof (prose rejection)', () => {
    it('rejects provider result carrying extra root field with arbitrary prose ("상대는 이별을 원한다")', () => {
      const requestedItems = createValidExtractRequestItems(3);
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
      const requestedItems = createValidExtractRequestItems(3);
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
      const requestedItems = createValidExtractRequestItems(3);
      const extraOutputFields = [
        { text: '상대는 이별을 원한다' },
        { claim: '추측된 감정' },
        { title: '타이틀' },
        { label: '위험' },
        { summary: '요약문' },
        { content: '본문' },
        { sections: [] },
        { choices: [] }, // v1 field not allowed in v2 output
        { extra: true },
      ];

      for (const extra of extraOutputFields) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 2,
            groups: [
              {
                groupOrdinal: 0,
                choices: [
                  { itemOrdinal: 0, candidateOrdinal: 0 },
                  { itemOrdinal: 1, candidateOrdinal: 1 },
                  { itemOrdinal: 2, candidateOrdinal: 0 },
                ],
              },
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

    it('rejects group carrying extra fields (text, claim, summary, name, label)', () => {
      const requestedItems = createValidExtractRequestItems(3);
      const extraGroupFields = [
        { text: '요약 텍스트' },
        { claim: '관계 분석' },
        { summary: '오전 요약' },
        { name: 'group-1' },
        { label: '오전' },
        { extra: 99 },
      ];

      for (const extra of extraGroupFields) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 2,
            groups: [
              {
                groupOrdinal: 0,
                choices: [
                  { itemOrdinal: 0, candidateOrdinal: 0 },
                  { itemOrdinal: 1, candidateOrdinal: 1 },
                  { itemOrdinal: 2, candidateOrdinal: 0 },
                ],
                ...extra,
              },
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
          rejection: { reason: 'invalid_structure', groupOrdinal: 0 },
        });
      }
    });

    it('rejects choice carrying extra fields (text, claim, title, prose, comment)', () => {
      const requestedItems = createValidExtractRequestItems(3);
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
            version: 2,
            groups: [
              {
                groupOrdinal: 0,
                choices: [
                  { itemOrdinal: 0, candidateOrdinal: 0, ...extra },
                  { itemOrdinal: 1, candidateOrdinal: 1 },
                  { itemOrdinal: 2, candidateOrdinal: 0 },
                ],
              },
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
          rejection: { reason: 'invalid_structure', groupOrdinal: 0, itemOrdinal: 0 },
        });
      }
    });
  });

  describe('5. Version and structure invariants', () => {
    const requestedItems = createValidExtractRequestItems(3);

    it('rejects legacy v1 version (version: 1) with invalid_version', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 1,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
    });

    it('rejects version other than 2 with invalid_version', () => {
      const invalidVersions = [3, 0, -1, 2.5, '2', null, undefined, {}];

      for (const ver of invalidVersions) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: ver,
            groups: [
              {
                groupOrdinal: 0,
                choices: [
                  { itemOrdinal: 0, candidateOrdinal: 0 },
                  { itemOrdinal: 1, candidateOrdinal: 1 },
                  { itemOrdinal: 2, candidateOrdinal: 0 },
                ],
              },
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

    it('rejects non-array groups in output', () => {
      const nonArrayGroups = [null, undefined, 'groups', 123, true, {}];

      for (const val of nonArrayGroups) {
        const providerResult = {
          ok: true,
          requestId: BASE_REQUEST_ID,
          output: {
            version: 2,
            groups: val,
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
  });

  describe('6. Group ordinal invariants', () => {
    const requestedItems = createValidExtractRequestItems(5);

    it('rejects non-sequential groupOrdinal (e.g. 1 instead of 0)', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 1, // should be 0
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
            {
              groupOrdinal: 2,
              choices: [
                { itemOrdinal: 3, candidateOrdinal: 0 },
                { itemOrdinal: 4, candidateOrdinal: 1 },
              ],
            },
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
        rejection: { reason: 'invalid_ordinals', groupOrdinal: 1 },
      });
    });

    it('rejects fractional groupOrdinal with invalid_ordinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0.5,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
                { itemOrdinal: 3, candidateOrdinal: 0 },
                { itemOrdinal: 4, candidateOrdinal: 1 },
              ],
            },
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
        rejection: { reason: 'invalid_ordinals', groupOrdinal: 0.5 },
      });
    });
  });

  describe('7. Item ordinal partition & ordering invariants', () => {
    const requestedItems = createValidExtractRequestItems(3);

    it('rejects negative itemOrdinal with unknown_item', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: -1, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
        rejection: { reason: 'unknown_item', groupOrdinal: 0, itemOrdinal: -1 },
      });
    });

    /*
      An out-of-range ordinal that equals the position the verifier is expecting.

      `currentExpectedItemOrdinal` advances with every consumed choice, so a plan carrying
      MORE choices than were requested walks it past the end of `requestedItems`. The
      bounds check used to sit inside the "ordinal is not what I expected" branch, so this
      shape skipped it, matched the expectation, and indexed `requestedItems[2]` on a
      two-item request -- a TypeError out of a verifier whose whole contract is a bounded
      rejection, and nothing at the call site caught it.
    */
    it('rejects an over-long plan with unknown_item instead of throwing', () => {
      const twoItems = createValidExtractRequestItems(2);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                // One past the end, and exactly what the walker expects next.
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
          ],
        },
      };

      const run = () =>
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: twoItems,
          providerResult,
        });

      expect(run).not.toThrow();
      expect(run()).toEqual({
        ok: false,
        rejection: { reason: 'unknown_item', groupOrdinal: 0, itemOrdinal: 2 },
      });
    });

    it('rejects a plan whose choices START past the end of the request', () => {
      const twoItems = createValidExtractRequestItems(2);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 2, candidateOrdinal: 0 },
                { itemOrdinal: 3, candidateOrdinal: 0 },
              ],
            },
          ],
        },
      };

      const run = () =>
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: twoItems,
          providerResult,
        });

      expect(run).not.toThrow();
      expect(run()).toEqual({
        ok: false,
        rejection: { reason: 'unknown_item', groupOrdinal: 0, itemOrdinal: 2 },
      });
    });

    it('rejects an extra GROUP that runs past the end of the request', () => {
      const twoItems = createValidExtractRequestItems(2);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
              ],
            },
            {
              groupOrdinal: 1,
              choices: [
                { itemOrdinal: 2, candidateOrdinal: 0 },
                { itemOrdinal: 3, candidateOrdinal: 0 },
              ],
            },
          ],
        },
      };

      const run = () =>
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: twoItems,
          providerResult,
        });

      expect(run).not.toThrow();
      const result = run();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection.reason).toBe('unknown_item');
        expect(result.rejection.itemOrdinal).toBe(2);
        // Bounded: the rejection still carries only numeric ordinals and a reason.
        expect(Object.keys(result.rejection).sort()).toEqual([
          'groupOrdinal',
          'itemOrdinal',
          'reason',
        ]);
        expect(JSON.stringify(result)).not.toContain('후보');
      }
    });

    it('still reports a reordered in-range ordinal as reordered_choices', () => {
      // The hoisted bounds check must not swallow the reordering case.
      const threeItems = createValidExtractRequestItems(3);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 1, candidateOrdinal: 0 },
                { itemOrdinal: 0, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: threeItems,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'reordered_choices', groupOrdinal: 0, itemOrdinal: 1 },
      });
    });

    it('rejects fractional itemOrdinal with invalid_ordinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0.5, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
        rejection: { reason: 'invalid_ordinals', groupOrdinal: 0, itemOrdinal: 0.5 },
      });
    });

    it('rejects out-of-range itemOrdinal with unknown_item', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 99, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
        rejection: { reason: 'unknown_item', groupOrdinal: 0, itemOrdinal: 99 },
      });
    });

    it('rejects duplicate itemOrdinal with reordered_choices', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 0, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
        rejection: { reason: 'reordered_choices', groupOrdinal: 0, itemOrdinal: 0 },
      });
    });

    it('rejects reordered itemOrdinals across groups with reordered_choices', () => {
      const requestedItems5 = createValidExtractRequestItems(5);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 3, candidateOrdinal: 0 },
                { itemOrdinal: 4, candidateOrdinal: 1 },
              ],
            },
            {
              groupOrdinal: 1,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 2 },
              ],
            },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: requestedItems5,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'reordered_choices', groupOrdinal: 0, itemOrdinal: 3 },
      });
    });

    it('rejects missing trailing items (fewer total choices than requestedItems) with invalid_choices', () => {
      const requestedItems5 = createValidExtractRequestItems(5);
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 2 },
              ],
            },
          ],
        },
      };

      expect(
        verifyBriefingExtractResult({
          expectedRequestId: BASE_REQUEST_ID,
          requestedItems: requestedItems5,
          providerResult,
        }),
      ).toEqual({
        ok: false,
        rejection: { reason: 'invalid_choices' },
      });
    });
  });

  describe('8. Candidate ordinal invariants (bounds, unknown, negative, fractional)', () => {
    const requestedItems = createValidExtractRequestItems(3);

    it('rejects negative candidateOrdinal with unknown_candidate', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: -1 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
        rejection: { reason: 'unknown_candidate', groupOrdinal: 0, itemOrdinal: 0, candidateOrdinal: -1 },
      });
    });

    it('rejects fractional candidateOrdinal with invalid_ordinals', () => {
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 0.5 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
        rejection: { reason: 'invalid_ordinals', groupOrdinal: 0, itemOrdinal: 0, candidateOrdinal: 0.5 },
      });
    });

    it('rejects candidateOrdinal out of bounds for that specific item with unknown_candidate', () => {
      // item 0 has 3 candidates (0, 1, 2). candidateOrdinal: 3 is out of bounds
      const providerResult = {
        ok: true,
        requestId: BASE_REQUEST_ID,
        output: {
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 3 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
                { itemOrdinal: 2, candidateOrdinal: 0 },
              ],
            },
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
        rejection: { reason: 'unknown_candidate', groupOrdinal: 0, itemOrdinal: 0, candidateOrdinal: 3 },
      });
    });
  });

  describe('9. Request ID correlation & format', () => {
    const requestedItems = createValidExtractRequestItems(3);

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
  });

  describe('10. Provider failure codes & error bounds', () => {
    const requestedItems = createValidExtractRequestItems(3);
    const validErrorCodes: BriefingProviderErrorCode[] = [
      'busy',
      'quota',
      'timeout',
      'cancelled',
      'malformed',
      'native_error',
    ];

    for (const code of validErrorCodes) {
      it(`accepts failure code "${code}" and rejects with provider_failed`, () => {
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
    const requestedItems = createValidExtractRequestItems(3);

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
        expect(keys.every((k) => k === 'reason' || k === 'groupOrdinal' || k === 'itemOrdinal' || k === 'candidateOrdinal')).toBe(true);
        expect(typeof res.rejection.reason).toBe('string');
      }
    });
  });
});
