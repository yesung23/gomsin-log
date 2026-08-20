import type { ServerErrorKind } from '@/lib/serverErrors';

export type { ServerErrorKind };

export type Role = 'gomsin' | 'soldier';

export type Branch = 
  | 'army'            // 육군 (18개월)
  | 'navy'            // 해군 (20개월)
  | 'airforce'        // 공군 (21개월)
  | 'marine'          // 해병대 (18개월)
  | 'reserve'         // 상근예비역 (18개월)
  | 'social_service'  // 사회복무요원 (21개월)
  | 'other';          // 기타

export type MilitaryStatus = 
  | 'planned'         // 입대 예정
  | 'serving'         // 복무 중
  | 'discharge_soon'  // 전역 예정
  | 'discharged'      // 전역했어요
  | 'unknown';        // 아직 입력하지 않을래요

export type DischargeDateSource = 'calculated' | 'manual' | 'unknown';

export type CoupleStatus = 'pending' | 'active' | 'disconnected';

export type ReactionType = 'good' | 'event' | 'hard' | 'thought_of_you';

export interface Attachment {
  type: 'photo' | 'video' | 'voice';
  name: string;
  url?: string; // Signed URL or temporary local preview URL
  path?: string; // Storage path
  /**
   * Why this attachment has no `url`.
   *
   * A missing `url` used to be indistinguishable from "not signed yet": when
   * `createSignedUrls` failed the attachment came back bare and the record still
   * loaded as a success, so the UI rendered an un-openable filename chip with no
   * explanation. Set to the classified cause when signing was ATTEMPTED and
   * failed, so a surface can say so instead of pretending the media is fine.
   * Never persisted -- writes project attachments down to type/name/path.
   */
  urlUnavailable?: ServerErrorKind;
}

export type EmotionGroup =
  | 'joy'
  | 'love'
  | 'anger'
  | 'disgust'
  | 'envy'
  | 'fear'
  | 'jealousy'
  | 'sadness'
  | 'shame'
  | 'guilt'
  | 'neutral'
  | 'uncertain'
  | 'frustration'
  | 'concern'
  | 'longing'
  | 'calm'
  | 'fatigue'
  | 'excitement'
  | 'surprise';

export type EmotionVisibility = 'shared' | 'author_only' | 'hidden';

/**
 * The six refined emotions the product speaks in.
 *
 * Declared here rather than in `lib/basicEmotions.ts` so that `types` stays a leaf
 * module: `basicEmotions` already imports `EmotionGroup` from here, and defining
 * this the other way round would close an import cycle.
 */
export type BasicEmotion =
  | 'happiness'
  | 'surprise'
  | 'fear'
  | 'disgust'
  | 'anger'
  | 'sadness';

export interface EmotionFlowItem {
  id?: string;
  sequence: number;
  group: EmotionGroup;
  displayLabel: string;
  matchedText?: string;
  source?: 'rule_suggested' | 'user_confirmed';
  visibility?: EmotionVisibility;
  /**
   * The refined six-emotion reading (분노 / 혐오 / 공포 / 행복 / 슬픔 / 놀람).
   *
   * Optional because records written before this existed have only `group`;
   * `basicEmotionOf()` maps those forward, so nothing needs migrating.
   */
  basic?: BasicEmotion;
  /**
   * True when a human overrode the machine's reading. Kept so a correction is
   * visible as a correction and is never quietly re-analysed away.
   */
  userEdited?: boolean;
}

export interface EmotionAnalysis {
  primaryEmotion: EmotionGroup;
  confidence: number;
  flowList: EmotionFlowItem[];
  emotionPath: string;
  emotionSummary: string;
}

export function getEmotionPath(analysis: EmotionAnalysis): string | null {
  if (!analysis || !analysis.flowList || analysis.flowList.length === 0) return null;
  return (
    analysis.emotionPath?.trim() ||
    analysis.flowList.map((item) => item.displayLabel).join(' → ')
  );
}

export interface DailyRecord {
  id: string;
  userId?: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:mm
  authorRole: Role;
  log: string;
  reaction?: ReactionType;
  attachments?: Attachment[];
  isPrivate: boolean; // false = 우리 둘에게 공유, true = 나에게만
  /** Explicitly saved by the author as a topic for the next call. */
  talkAbout?: boolean;
  emotionFlow?: EmotionFlowItem[];
  emotionAnalysis?: EmotionAnalysis;
  emotionUpdatedAt?: string | null;
  /**
   * The server-validated monotonic revision of an ENCRYPTED record.
   *
   * Carried from the server for legacy and encrypted rows alike. For encrypted
   * rows it is bound into GLE1 associated data, so an edit must present exactly
   * `OLD + 1` (migration 032's R6) and a concurrent write loses rather than
   * silently overwriting. A legacy row may therefore transition using a revision
   * greater than 1.
   */
  contentRevision?: number;
  /**
   * Why this record's content could not be shown.
   *
   * Set instead of returning an empty record, because "the author wrote nothing"
   * and "this device cannot open it" must never look the same. `key_unavailable`
   * means a device or epoch key is missing and may arrive later;
   * `undecryptable` means authentication failed or the epoch is gone.
   */
  contentUnavailable?: 'key_unavailable' | 'undecryptable';
  createdAt: string;  // ISO
}

export type EventType = 'visit' | 'vacation' | 'anniversary' | 'date' | 'trip' | 'other';

export interface CoupleEvent {
  id: string;
  coupleId: string;
  createdBy: string;
  title: string;
  eventType: EventType;
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  isPrivate: boolean;
  talkAbout?: boolean;
  createdAt: string;
}

export interface CoupleTask {
  id: string;
  coupleId: string;
  createdBy: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm
  assigneeId?: string;
  completed: boolean;
  isPrivate: boolean;
  createdAt: string;
}

export interface SummaryItem {
  id: string;
  text: string;
  recordIds: string[];
  kind: 'moment' | 'mood' | 'media' | 'topic';
}

export type TripStatus = 'planned' | 'ongoing' | 'completed';

export interface Trip {
  id: string;
  coupleId: string;
  createdBy: string;
  title: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  createdAt: string;
}

export interface TripItem {
  id: string;
  tripId: string;
  itemDate: string;
  startTime?: string;
  title: string;
  category: 'activity' | 'food' | 'lodging' | 'transport';
  memo?: string;
  /** A shared note is intentionally part of the place, not a private draft. */
  talkAbout?: boolean;
  url?: string;
  address?: string;
  businessHours?: string;
  latitude?: number;
  longitude?: number;
  source?: 'manual' | 'screenshot' | 'kakao';
  sortOrder: number;
}

export interface TripChecklist {
  id: string;
  tripId: string;
  itemName: string;
  completed: boolean;
}

export interface CycleSettings {
  userId: string;
  averageCycleLength: number;
  averagePeriodLength: number;
}

/**
 * What a person may log about their own body.
 *
 * PERSONAL ONLY. None of this is ever partner-visible: the partner-facing payload
 * is `CyclePartnerProjection`, which has no field that could carry a symptom, and
 * the only other thing a partner sees is a `CycleSupportSignal` the owner chose to
 * send.
 *
 * `nausea` and `breast_tenderness` were added 2026-08-20. Two of the most commonly
 * reported, and until now the two most likely to end up written into `note` --
 * which is worse for privacy than a checkbox, because a note is prose and prose is
 * where identifying detail collects.
 *
 * The wording follows the set that was already here: `복부 불편감`, not 생리통;
 * `허리 불편감`, not 요통. This surface describes discomfort in ordinary words rather
 * than naming conditions, so `가슴 불편감` joins that pattern instead of `가슴 통증`.
 *
 * Extending this needs no migration: `cycle_daily_logs.symptoms` is `TEXT[]` with
 * no CHECK constraint (migration 022). The legacy `cycle_entries` table does carry
 * `cycle_entries_symptoms_check`, but nothing under `src/` reads or writes that
 * table any more, and `cycleV3DataPath.test.tsx` is what keeps it that way.
 */
export const CYCLE_SYMPTOMS = [
  'cramps',
  'headache',
  'fatigue',
  'bloating',
  'mood_changes',
  'backache',
  'nausea',
  'breast_tenderness',
] as const;

export type CycleSymptom = (typeof CYCLE_SYMPTOMS)[number];

export const CYCLE_FLOWS = ['spotting', 'light', 'medium', 'heavy'] as const;
export type CycleFlow = (typeof CYCLE_FLOWS)[number];

export const CYCLE_PAIN_LEVELS = ['none', 'mild', 'moderate', 'severe'] as const;
export type CyclePainLevel = (typeof CYCLE_PAIN_LEVELS)[number];

export const CYCLE_MOODS = ['calm', 'sensitive', 'sad', 'tired', 'good'] as const;
export type CycleMood = (typeof CYCLE_MOODS)[number];

export interface CyclePeriod {
  id: string;
  userId: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  createdAt?: string;
  updatedAt?: string;
}

export interface CycleDailyLog {
  id: string;
  userId: string;
  logDate: string; // YYYY-MM-DD
  flow?: CycleFlow;
  painLevel?: CyclePainLevel;
  symptoms: CycleSymptom[];
  mood?: CycleMood;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserSensitiveConsent {
  id: string;
  userId: string;
  consentType: string;
  version: string;
  grantedAt: string;
  revokedAt?: string;
}

export interface CycleSharingPreferences {
  userId: string;
  shareCurrentPeriod: boolean;
  sharePredictionWindow: boolean;
  shareFertilityWindow: boolean;
}

/**
 * The ONLY cycle information a partner ever receives.
 *
 * Produced by the `get_partner_cycle_projection()` RPC, which reads the owner's
 * raw tables under SECURITY DEFINER and returns nothing but these booleans and
 * date ranges. The shape is the enforcement: there is no field here that could
 * carry a symptom, flow, pain level, mood, note, row id, or actual period date,
 * so a future change cannot leak one by accident.
 */
export interface CyclePartnerProjection {
  isCurrentPeriodShared: boolean;
  isPeriodActive: boolean;
  isPredictionShared: boolean;
  predictedWindowStart?: string;
  predictedWindowEnd?: string;
  isFertilityShared: boolean;
  fertilityWindowStart?: string;
  fertilityWindowEnd?: string;
}

export interface CycleEntry {
  id: string;
  userId: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  notes?: string;
  symptoms: CycleSymptom[];
}

/**
 * The care-signal vocabulary. One row per deliberate act (migration 014), with
 * `shared_for_date` chosen by the owner, `expires_at` a day out, `revoked_at` for
 * taking it back.
 *
 * `feeling_unwell` ("오늘은 몸이 힘들어요") is the one body-state kind, added
 * 2026-08-21 per V1_LAUNCH_DECISIONS §5. It is deliberately a single ungraded
 * value: an earlier draft carried `pain_mild`/`pain_moderate`/`pain_severe`, and
 * the independent security review refused it — a graded scale mirrors the personal
 * HRK pain levels inside a server-visible `kind` column, which PRODUCT_V3 §21
 * forbids sharing under any setting. The signal says today is hard; it never says
 * how much, and it is never derived from `CycleDailyLog.painLevel`.
 */
export const CYCLE_SUPPORT_KINDS = [
  'resting',
  'need_space',
  'would_like_support',
  'check_in_later',
  'feeling_unwell',
] as const;

export type CycleSupportKind = (typeof CYCLE_SUPPORT_KINDS)[number];

/**
 * "이따 이야기하기" — a metadata-only flag that a shared record is worth
 * talking about later (migration 038).
 *
 * Note what is absent and must stay absent: no topic, no note, no excerpt, no
 * summary, no emotion. The list UI renders content from the records the client
 * already holds; this only identifies WHICH ones.
 */
export interface TalkAboutMark {
  id: string;
  recordId: string;
  coupleId: string;
  actorUserId: string;
  createdAt: string;
  /** Conversation Bridge completion state; no record content is stored here. */
  isCompleted: boolean;
}

export interface CycleSupportSignal {
  id: string;
  coupleId: string;
  ownerId: string;
  kind: CycleSupportKind;
  message?: string;
  sharedForDate: string; // YYYY-MM-DD, explicitly selected by the owner
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailySummary {
  date: string;
  items: SummaryItem[];
  opener?: SummaryItem;
  totalSharedCount: number;
}

export interface ContactPreferences {
  weekdayStart: string; // HH:mm
  weekdayEnd: string;   // HH:mm
  weekendStart: string; // HH:mm
  weekendEnd: string;   // HH:mm
  enabled: boolean;
}

export interface MilitaryInfo {
  branch: Branch;
  militaryStatus: MilitaryStatus;
  enlistmentDate?: string;          // 입대일 / 입대 예정일 (YYYY-MM-DD)
  expectedDischargeDate?: string;   // 예상 전역일 (YYYY-MM-DD)
  dischargeDate?: string;           // 실제 전역일 (YYYY-MM-DD)
  dischargeDateSource: DischargeDateSource;
  memo?: string;
}

export interface CoupleInfo {
  coupleId?: string;
  partnerName: string;
  anniversaryDate?: string; // YYYY-MM-DD (사귄 날짜 - null 가능)
  coupleCode: string;
  connected: boolean;
  status: CoupleStatus;
}

export interface UserProfile {
  id?: string;               // Auth UID
  myName: string;
  role: Role;
  avatarPath?: string;
  onboardingCompletedAt?: string;
  couple: CoupleInfo;
  military: MilitaryInfo;
  contact: ContactPreferences;
}

export interface AppState {
  setupComplete: boolean;
  onboardingStep: number;
  profile: UserProfile;
  records: DailyRecord[];
  events: CoupleEvent[];
  trips: Trip[];
  /**
   * "이따 이야기하기" marks for the active couple (migration 038).
   *
   * Metadata only -- ids, actor and timestamp. The list UI joins these
   * against `records` above, which the client is already authorized to hold,
   * so no record content ever lives here. See `lib/talkAboutList.ts`.
   */
  talkAboutMarks: TalkAboutMark[];
  highlightedRecordId?: string;
  authenticatedUser: AuthUser | null;
  /** Home layout for 곰신. Named without a role suffix for backward compatibility. */
  widgetLayout: string[];
  /**
   * Home layout for 군화, stored separately.
   *
   * The two people have opposite home screens, and a single shared list meant
   * whoever arranged theirs last overwrote the other's on a role change.
   */
  soldierWidgetLayout: string[];
  hasSeenInstallPrompt: boolean;
  theme: 'light' | 'dark';
}

export interface AuthUser {
  id: string;
  email?: string;
  provider: 'apple' | 'google' | 'email';
}

/**
 * Auth Repository Abstraction Interface
 */
export interface IAuthRepository {
  getCurrentUser(): Promise<AuthUser | null>;
  signInWithGoogle(): Promise<{ error?: string }>;
  signInWithApple(): Promise<{ error?: string }>;
  signInWithEmail(email: string): Promise<{ error?: string }>;
  signOut(): Promise<void>;
  isConfigured(): boolean;
}

/**
 * Log Repository Abstraction Interface
 */
export interface ILogRepository {
  loadState(): Promise<AppState | null>;
  saveState(state: AppState): Promise<void>;
  isConfigured(): boolean;
}
