/**
 * In-memory barrier for the short interval after the server authoritatively
 * reports a connected couple but before its irreversible couple write floor is
 * confirmed active.
 *
 * This is deliberately not a cryptographic authority and is never persisted.
 * It only prevents the legacy floor=0 plaintext route from being selected for
 * the exact account/couple scope while activation is pending or unavailable.
 */
const requiredScopes = new Set<string>();

function keyFor(userId: string, coupleId: string): string {
  return `${userId}\u0000${coupleId}`;
}

export function requireCoupleProtection(userId: string, coupleId: string): void {
  if (!userId || !coupleId) return;
  requiredScopes.add(keyFor(userId, coupleId));
}

export function clearCoupleProtectionRequirement(userId: string, coupleId: string): void {
  if (!userId || !coupleId) return;
  requiredScopes.delete(keyFor(userId, coupleId));
}

export function isCoupleProtectionRequired(userId: string, coupleId: string): boolean {
  return !!userId && !!coupleId && requiredScopes.has(keyFor(userId, coupleId));
}

export function clearAllCoupleProtectionRequirements(): void {
  requiredScopes.clear();
}
