import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Branch, DischargeDateSource, MilitaryStatus, Role } from '@/types';

export type RelationshipLifecycleV2 = 'personal' | 'pending' | 'active' | 'disconnected';

export type RelationshipPartnerServiceV2 = {
  branch: Branch | null;
  militaryStatus: MilitaryStatus | null;
  enlistmentDate: string | null;
  expectedDischargeDate: string | null;
  dischargeDate: string | null;
  dischargeDateSource: DischargeDateSource | null;
};

export type RelationshipPartnerV2 = {
  userId: string;
  joinedAt: string;
  displayName: string;
  role: Role;
  avatarPath: string | null;
  username: string | null;
  service: RelationshipPartnerServiceV2 | null;
};

type SnapshotCommon = {
  contractVersion: 2;
  ownerUserId: string;
};

export type RelationshipSnapshotV2 = SnapshotCommon & (
  | {
    lifecycle: 'personal';
    coupleId: null;
    relationRevision: null;
    partner: null;
    invitationActive: false;
    invitationExpiresAt: null;
  }
  | {
    lifecycle: 'pending';
    coupleId: string;
    relationRevision: string;
    partner: null;
    invitationActive: boolean;
    invitationExpiresAt: string | null;
  }
  | {
    lifecycle: 'active';
    coupleId: string;
    relationRevision: string;
    partner: RelationshipPartnerV2;
    invitationActive: false;
    invitationExpiresAt: null;
  }
  | {
    lifecycle: 'disconnected';
    coupleId: string;
    relationRevision: string;
    partner: null;
    invitationActive: false;
    invitationExpiresAt: null;
  }
);

export type RelationshipSnapshotReadResult =
  | { ok: true; snapshot: RelationshipSnapshotV2 }
  | { ok: false; reason: 'unavailable' | 'server' | 'invalid-payload' };

const TOP_LEVEL_KEYS = [
  'contract_version',
  'owner_user_id',
  'lifecycle',
  'couple_id',
  'relation_revision',
  'partner',
  'invitation_active',
  'invitation_expires_at',
] as const;

const PARTNER_KEYS = [
  'user_id',
  'joined_at',
  'display_name',
  'role',
  'avatar_path',
  'username',
  'service',
] as const;

const SERVICE_KEYS = [
  'branch',
  'military_status',
  'enlistment_date',
  'expected_discharge_date',
  'discharge_date',
  'discharge_date_source',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

const LIFECYCLES = new Set<RelationshipLifecycleV2>([
  'personal', 'pending', 'active', 'disconnected',
]);
const ROLES = new Set<Role>(['gomsin', 'soldier']);
const BRANCHES = new Set<Branch>([
  'army', 'navy', 'airforce', 'marine', 'reserve', 'social_service', 'other',
]);
const MILITARY_STATUSES = new Set<MilitaryStatus>([
  'planned', 'serving', 'discharge_soon', 'discharged', 'unknown',
]);
const DISCHARGE_DATE_SOURCES = new Set<DischargeDateSource>([
  'calculated', 'manual', 'unknown',
]);

export class RelationshipSnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelationshipSnapshotParseError';
  }
}

function invalid(field: string): never {
  throw new RelationshipSnapshotParseError(`Invalid relationship snapshot field: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(field);
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(field);
  return value;
}

function calendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field);
  const match = DATE_PATTERN.exec(value);
  if (!match) invalid(field);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    invalid(field);
  }
  return value;
}

function nullableCalendarDate(value: unknown, field: string): string | null {
  return value === null ? null : calendarDate(value, field);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field);
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) invalid(field);
  calendarDate(match[1], field);
  if (Number.isNaN(Date.parse(value))) invalid(field);
  return value;
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    invalid('relation_revision');
  }
  try {
    if (BigInt(value) > POSTGRES_BIGINT_MAX) invalid('relation_revision');
  } catch {
    invalid('relation_revision');
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid(field);
  return value;
}

function nullableEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  field: string,
): T | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !allowed.has(value as T)) invalid(field);
  return value as T;
}

function parseService(value: unknown): RelationshipPartnerServiceV2 | null {
  if (value === null) return null;
  const service = record(value, 'partner.service');
  exactKeys(service, SERVICE_KEYS, 'partner.service');
  return {
    branch: nullableEnum(service.branch, BRANCHES, 'partner.service.branch'),
    militaryStatus: nullableEnum(
      service.military_status,
      MILITARY_STATUSES,
      'partner.service.military_status',
    ),
    enlistmentDate: nullableCalendarDate(
      service.enlistment_date,
      'partner.service.enlistment_date',
    ),
    expectedDischargeDate: nullableCalendarDate(
      service.expected_discharge_date,
      'partner.service.expected_discharge_date',
    ),
    dischargeDate: nullableCalendarDate(
      service.discharge_date,
      'partner.service.discharge_date',
    ),
    dischargeDateSource: nullableEnum(
      service.discharge_date_source,
      DISCHARGE_DATE_SOURCES,
      'partner.service.discharge_date_source',
    ),
  };
}

function parsePartner(value: unknown, ownerUserId: string): RelationshipPartnerV2 {
  const partner = record(value, 'partner');
  exactKeys(partner, PARTNER_KEYS, 'partner');
  const userId = uuid(partner.user_id, 'partner.user_id');
  if (userId === ownerUserId) invalid('partner.user_id');
  if (typeof partner.display_name !== 'string') invalid('partner.display_name');
  if (typeof partner.role !== 'string' || !ROLES.has(partner.role as Role)) {
    invalid('partner.role');
  }
  const username = nullableString(partner.username, 'partner.username');
  if (username !== null && !USERNAME_PATTERN.test(username)) invalid('partner.username');
  const service = parseService(partner.service);
  if (partner.role !== 'soldier' && service !== null) invalid('partner.service');

  return {
    userId,
    joinedAt: timestamp(partner.joined_at, 'partner.joined_at'),
    displayName: partner.display_name,
    role: partner.role as Role,
    avatarPath: nullableString(partner.avatar_path, 'partner.avatar_path'),
    username,
    service,
  };
}

export function parseRelationshipSnapshotV2(
  value: unknown,
  expectedOwnerUserId: string,
): RelationshipSnapshotV2 {
  const expectedOwner = uuid(expectedOwnerUserId, 'expected_owner_user_id');
  const snapshot = record(value, 'snapshot');
  exactKeys(snapshot, TOP_LEVEL_KEYS, 'snapshot');

  if (snapshot.contract_version !== 2) invalid('contract_version');
  const ownerUserId = uuid(snapshot.owner_user_id, 'owner_user_id');
  if (ownerUserId !== expectedOwner) invalid('owner_user_id');
  if (
    typeof snapshot.lifecycle !== 'string'
    || !LIFECYCLES.has(snapshot.lifecycle as RelationshipLifecycleV2)
  ) {
    invalid('lifecycle');
  }
  if (typeof snapshot.invitation_active !== 'boolean') invalid('invitation_active');

  const common: SnapshotCommon = { contractVersion: 2, ownerUserId };
  const lifecycle = snapshot.lifecycle as RelationshipLifecycleV2;

  if (lifecycle === 'personal') {
    if (
      snapshot.couple_id !== null
      || snapshot.relation_revision !== null
      || snapshot.partner !== null
      || snapshot.invitation_active !== false
      || snapshot.invitation_expires_at !== null
    ) {
      invalid('personal');
    }
    return {
      ...common,
      lifecycle,
      coupleId: null,
      relationRevision: null,
      partner: null,
      invitationActive: false,
      invitationExpiresAt: null,
    };
  }

  const coupleId = uuid(snapshot.couple_id, 'couple_id');
  const relationRevision = revision(snapshot.relation_revision);

  if (lifecycle === 'pending') {
    if (snapshot.partner !== null) invalid('partner');
    const invitationActive = snapshot.invitation_active;
    const invitationExpiresAt = invitationActive
      ? timestamp(snapshot.invitation_expires_at, 'invitation_expires_at')
      : null;
    if (!invitationActive && snapshot.invitation_expires_at !== null) {
      invalid('invitation_expires_at');
    }
    return {
      ...common,
      lifecycle,
      coupleId,
      relationRevision,
      partner: null,
      invitationActive,
      invitationExpiresAt,
    };
  }

  if (
    snapshot.invitation_active !== false
    || snapshot.invitation_expires_at !== null
  ) {
    invalid('invitation');
  }

  if (lifecycle === 'active') {
    return {
      ...common,
      lifecycle,
      coupleId,
      relationRevision,
      partner: parsePartner(snapshot.partner, ownerUserId),
      invitationActive: false,
      invitationExpiresAt: null,
    };
  }

  if (snapshot.partner !== null) invalid('partner');
  return {
    ...common,
    lifecycle: 'disconnected',
    coupleId,
    relationRevision,
    partner: null,
    invitationActive: false,
    invitationExpiresAt: null,
  };
}

export async function fetchMyRelationshipSnapshotV2(
  expectedOwnerUserId: string,
): Promise<RelationshipSnapshotReadResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: 'unavailable' };
  try {
    uuid(expectedOwnerUserId, 'expected_owner_user_id');
  } catch {
    return { ok: false, reason: 'invalid-payload' };
  }

  try {
    const { data, error } = await supabase.rpc('get_my_relationship_snapshot_v2');
    if (error) return { ok: false, reason: 'server' };
    try {
      return {
        ok: true,
        snapshot: parseRelationshipSnapshotV2(data, expectedOwnerUserId),
      };
    } catch {
      return { ok: false, reason: 'invalid-payload' };
    }
  } catch {
    return { ok: false, reason: 'server' };
  }
}
