import type { GenderIdentity, RelationshipContext } from '@/types';

export function resolveRelationshipContext(value: unknown): RelationshipContext | undefined {
  if (value === undefined || value === null) return 'military';
  if (value === 'military' || value === 'general') return value;
  return undefined;
}

export function parseGenderIdentity(value: unknown): GenderIdentity | undefined {
  if (value === 'woman' || value === 'man') return value;
  return undefined;
}

export function usesMilitaryFeatures(context: RelationshipContext): boolean {
  return context === 'military';
}
