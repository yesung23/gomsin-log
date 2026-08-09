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

export const CYCLE_SYMPTOMS = [
  'cramps',
  'headache',
  'fatigue',
  'bloating',
  'mood_changes',
  'backache',
] as const;

export type CycleSymptom = (typeof CYCLE_SYMPTOMS)[number];

export interface CycleEntry {
  id: string;
  userId: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  notes?: string;
  symptoms: CycleSymptom[];
}

export const CYCLE_SUPPORT_KINDS = [
  'resting',
  'need_space',
  'would_like_support',
  'check_in_later',
] as const;

export type CycleSupportKind = (typeof CYCLE_SUPPORT_KINDS)[number];

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
