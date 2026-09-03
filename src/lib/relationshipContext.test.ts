import { describe, expect, expectTypeOf, it } from 'vitest';
import type { GenderIdentity, RelationshipContext, Role } from '@/types';
import {
  parseGenderIdentity,
  resolveRelationshipContext,
  usesMilitaryFeatures,
} from '@/lib/relationshipContext';

describe('relationship context stays separate from authorization role', () => {
  it('keeps the existing two-value Role contract intact', () => {
    expectTypeOf<Role>().toEqualTypeOf<'gomsin' | 'soldier'>();
    expectTypeOf<RelationshipContext>().toEqualTypeOf<'military' | 'general'>();
    expectTypeOf<GenderIdentity>().toEqualTypeOf<'woman' | 'man'>();
  });

  it.each([
    ['military', 'military'],
    ['general', 'general'],
    [undefined, 'military'],
    [null, 'military'],
  ] as const)('resolves %s without changing legacy military behavior', (value, expected) => {
    expect(resolveRelationshipContext(value)).toBe(expected);
  });

  it('rejects malformed server context instead of inventing a new product mode', () => {
    expect(resolveRelationshipContext('woman')).toBeUndefined();
    expect(resolveRelationshipContext('soldier')).toBeUndefined();
    expect(resolveRelationshipContext(1)).toBeUndefined();
  });

  it('enables military presentation only for the military context', () => {
    expect(usesMilitaryFeatures('military')).toBe(true);
    expect(usesMilitaryFeatures('general')).toBe(false);
  });
});

describe('optional gender identity', () => {
  it.each(['woman', 'man'] as const)('accepts the declared %s value', (value) => {
    expect(parseGenderIdentity(value)).toBe(value);
  });

  it.each([undefined, null, '', 'unspecified', 'gomsin', 'soldier'])('stores %s as no answer', (value) => {
    expect(parseGenderIdentity(value)).toBeUndefined();
  });
});
