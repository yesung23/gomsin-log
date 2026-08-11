/**
 * The cryptographic domains and their state machine.
 *
 * The three scope domains are independently random and never derive from one
 * another. That separation is the whole reason a partner can read shared
 * content without ever being able to read personal or health content, so the
 * domain travels as a typed value rather than a string everywhere it is used.
 */

/** Wire values. Never renumber: they are bound into GLK2 and GLDC1 headers. */
export const KEY_DOMAIN = {
  personal: 1,
  health: 2,
  couple: 3,
} as const;

export type KeyDomainName = keyof typeof KEY_DOMAIN;
export type KeyDomainCode = (typeof KEY_DOMAIN)[KeyDomainName];

export const KEY_DOMAIN_NAMES = Object.keys(KEY_DOMAIN) as KeyDomainName[];

export function domainName(code: number): KeyDomainName {
  const found = KEY_DOMAIN_NAMES.find((name) => KEY_DOMAIN[name] === code);
  if (!found) throw new RangeError(`unknown key domain: ${code}`);
  return found;
}

export function isUserScopedDomain(domain: KeyDomainName): boolean {
  return domain === 'personal' || domain === 'health';
}

/** Recipient kinds for a GLK2 envelope. */
export const RECIPIENT_KIND = {
  device: 1,
  recoveryIdentity: 2,
} as const;
export type RecipientKindName = keyof typeof RECIPIENT_KIND;

/**
 * Granted domains, as a bitmask inside the signed certificate body.
 *
 * Signed rather than stored in a mutable column so that a server cannot promote
 * a device — for example a web device — into the health domain.
 */
export const DOMAIN_GRANT_BIT = {
  personal: 0b001,
  couple: 0b010,
  health: 0b100,
} as const;

export function grantsToMask(domains: readonly KeyDomainName[]): number {
  let mask = 0;
  for (const domain of domains) mask |= DOMAIN_GRANT_BIT[domain];
  return mask;
}

export function maskToGrants(mask: number): KeyDomainName[] {
  if (mask < 0 || mask > 0b111) throw new RangeError(`invalid grant mask: ${mask}`);
  return KEY_DOMAIN_NAMES.filter((name) => (mask & DOMAIN_GRANT_BIT[name]) !== 0);
}

export function maskGrantsDomain(mask: number, domain: KeyDomainName): boolean {
  return (mask & DOMAIN_GRANT_BIT[domain]) !== 0;
}

/** An issuer may never grant a subject more than the issuer itself holds. */
export function isGrantSubset(subjectMask: number, issuerMask: number): boolean {
  return (subjectMask & ~issuerMask) === 0;
}

/**
 * Epoch lifecycle.
 *
 * An epoch becomes ACTIVE only once every required envelope exists and
 * validates, which is what makes an interrupted rotation a non-event: the
 * half-built epoch is simply never referenced.
 */
export const EPOCH_STATE = {
  preparing: 'PREPARING',
  ready: 'READY',
  active: 'ACTIVE',
  retired: 'RETIRED',
  abandoned: 'ABANDONED',
} as const;
export type EpochState = (typeof EPOCH_STATE)[keyof typeof EPOCH_STATE];

/** Only ACTIVE accepts new writes. RETIRED stays readable forever. */
export function epochAcceptsWrites(state: EpochState): boolean {
  return state === EPOCH_STATE.active;
}

export function epochAllowsDecrypt(state: EpochState): boolean {
  return state === EPOCH_STATE.active || state === EPOCH_STATE.retired;
}

/**
 * Device assurance.
 *
 * `webNonExtractable` is deliberately its own class and deliberately the
 * weakest: Phase 1A-1 demonstrated that a non-extractable key cannot be
 * exported but CAN be used by same-origin script, so it is not XSS protection.
 */
export const ASSURANCE = {
  secureEnclave: 'secure_enclave',
  strongBox: 'strongbox',
  tee: 'tee',
  softwareKeystore: 'software_keystore',
  webNonExtractable: 'web_nonextractable',
} as const;
export type Assurance = (typeof ASSURANCE)[keyof typeof ASSURANCE];

export const ASSURANCE_WIRE: Record<Assurance, number> = {
  [ASSURANCE.secureEnclave]: 1,
  [ASSURANCE.strongBox]: 2,
  [ASSURANCE.tee]: 3,
  [ASSURANCE.softwareKeystore]: 4,
  [ASSURANCE.webNonExtractable]: 5,
};

export function assuranceFromWire(code: number): Assurance {
  const found = (Object.keys(ASSURANCE_WIRE) as Assurance[]).find((k) => ASSURANCE_WIRE[k] === code);
  if (!found) throw new RangeError(`unknown assurance code: ${code}`);
  return found;
}

/** True only for classes actually backed by dedicated hardware. */
export function isHardwareBacked(assurance: Assurance): boolean {
  return (
    assurance === ASSURANCE.secureEnclave
    || assurance === ASSURANCE.strongBox
    || assurance === ASSURANCE.tee
  );
}

/**
 * Whether losing this device should default to the compromise path.
 *
 * Web keys live in browser storage that the app cannot attest, so a lost web
 * device is treated as potentially compromised unless the user states
 * otherwise. Defaulting the other way would silently skip rotation.
 */
export function defaultsToCompromised(assurance: Assurance): boolean {
  return !isHardwareBacked(assurance);
}

export const PLATFORM = { ios: 1, android: 2, web: 3 } as const;
export type PlatformName = keyof typeof PLATFORM;

export function platformFromWire(code: number): PlatformName {
  const found = (Object.keys(PLATFORM) as PlatformName[]).find((k) => PLATFORM[k] === code);
  if (!found) throw new RangeError(`unknown platform code: ${code}`);
  return found;
}

/** Device lifecycle. Operational only — never a cryptographic trust input. */
export const DEVICE_STATUS = {
  pending: 'PENDING',
  recoveryAuthenticated: 'RECOVERY_AUTHENTICATED',
  provisioning: 'PROVISIONING',
  active: 'ACTIVE',
  provisioningFailed: 'PROVISIONING_FAILED',
  revoked: 'REVOKED',
} as const;
export type DeviceStatus = (typeof DEVICE_STATUS)[keyof typeof DEVICE_STATUS];

/** Why a device was revoked. Drives whether scope keys must rotate. */
export const REVOCATION_REASON = {
  voluntary: 1,
  lostSecured: 2,
  potentiallyCompromised: 3,
  compromised: 4,
  supersededByRecovery: 5,
} as const;
export type RevocationReasonName = keyof typeof REVOCATION_REASON;
export type RevocationReasonCode = (typeof REVOCATION_REASON)[RevocationReasonName];

/**
 * Does this reason require rotating every domain the device held?
 *
 * `lostSecured` is the only lost-device reason that skips rotation, and it
 * requires the user to affirm a confirmed secure erase. The default for a plain
 * "I lost it" is `potentiallyCompromised`, which rotates.
 */
export function requiresRotation(reason: RevocationReasonName): boolean {
  return (
    reason === 'potentiallyCompromised'
    || reason === 'compromised'
    || reason === 'supersededByRecovery'
  );
}

/** Severity ordering: a revocation may escalate, never soften. */
const REASON_SEVERITY: Record<RevocationReasonName, number> = {
  voluntary: 1,
  lostSecured: 2,
  supersededByRecovery: 3,
  potentiallyCompromised: 4,
  compromised: 5,
};

export function canEscalateReason(from: RevocationReasonName, to: RevocationReasonName): boolean {
  return REASON_SEVERITY[to] > REASON_SEVERITY[from];
}
