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
  url?: string;
}

export interface DailyRecord {
  id: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:mm
  authorRole: Role;
  log: string;
  reaction?: ReactionType;
  attachments?: Attachment[];
  isPrivate: boolean; // false = 우리 둘에게 공유, true = 나에게만
  createdAt: string;  // ISO
}

export interface SummaryItem {
  id: string;
  text: string;
  recordIds: string[];
  kind: 'moment' | 'mood' | 'media' | 'topic';
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
  isDemoMode: boolean;
  highlightedRecordId?: string;
  authenticatedUser: AuthUser | null;
}

export interface AuthUser {
  id: string;
  email?: string;
  provider: 'email' | 'google' | 'apple' | 'demo';
}

/**
 * Auth Repository Abstraction Interface
 */
export interface IAuthRepository {
  getCurrentUser(): Promise<AuthUser | null>;
  signInWithMagicLink(email: string): Promise<{ error?: string }>;
  signInWithGoogle(): Promise<{ error?: string }>;
  signInWithApple(): Promise<{ error?: string }>;
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
