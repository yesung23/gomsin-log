import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  CYCLE_LENGTH_MAX,
  CYCLE_LENGTH_MIN,
  PERIOD_LENGTH_MAX,
  PERIOD_LENGTH_MIN,
} from '@/lib/cycle';
import type { CyclePrediction } from '@/lib/cyclePrediction';
import type { CycleSharingPreferences } from '@/types';
import { CycleSheet } from './CycleSheet';
import { CycleSharingSettings } from './CycleSharingSettings';

type ShareKey = 'shareCurrentPeriod' | 'sharePredictionWindow' | 'shareFertilityWindow';
type Pane = 'root' | 'cycle' | 'sharing' | 'privacy';

interface CycleSettingsSheetProps {
  cycleLength: number;
  periodLength: number;
  prediction: CyclePrediction;
  periodActive: boolean;
  preferences: CycleSharingPreferences;
  sharingPendingKey: ShareKey | null;
  sharingError: string | null;
  settingsPending: boolean;
  settingsError: string | null;
  consentPending: boolean;
  consentError: string | null;
  onSaveLengths: (cycleLength: number, periodLength: number) => void;
  onToggleSharing: (key: ShareKey, next: boolean) => void;
  onRevokeConsent: () => void;
  onClose: () => void;
}

/**
 * Everything that is not the daily job of the tracker.
 *
 * These controls used to sit stacked under the calendar, so the first thing
 * below the fold was a numeric input for average cycle length — a value most
 * users set once, if ever. Moving them behind one entry point is what lets the
 * main screen be Hero / Calendar / Quick log / Summary and nothing else.
 */
export function CycleSettingsSheet({
  cycleLength,
  periodLength,
  prediction,
  periodActive,
  preferences,
  sharingPendingKey,
  sharingError,
  settingsPending,
  settingsError,
  consentPending,
  consentError,
  onSaveLengths,
  onToggleSharing,
  onRevokeConsent,
  onClose,
}: CycleSettingsSheetProps) {
  const [pane, setPane] = useState<Pane>('root');
  const [cycleDraft, setCycleDraft] = useState(cycleLength);
  const [periodDraft, setPeriodDraft] = useState(periodLength);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const title = pane === 'root'
    ? '내 몸의 리듬 설정'
    : pane === 'cycle' ? '주기 설정'
      : pane === 'sharing' ? '파트너 배려 공유'
        : '민감정보 동의';

  return (
    <CycleSheet title={title} onClose={onClose} busy={settingsPending || consentPending}>
      {pane !== 'root' && (
        <button
          type="button"
          onClick={() => setPane('root')}
          className="press-response min-h-11 -ml-1 flex items-center gap-1 text-caption font-medium text-muted-foreground"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          설정으로 돌아가기
        </button>
      )}

      {pane === 'root' && (
        <ul className="divide-y divide-border/40">
          {([
            ['cycle', '주기 설정', `평균 주기 ${cycleLength}일 · 평균 기간 ${periodLength}일`],
            ['sharing', '파트너 배려 공유', preferences.shareCurrentPeriod
              || preferences.sharePredictionWindow
              || preferences.shareFertilityWindow
              ? '일부 항목을 공유하고 있어요' : '공유 중인 정보 없음'],
            ['privacy', '민감정보 동의', '수집 항목과 동의 철회'],
          ] as Array<[Pane, string, string]>).map(([target, label, hint]) => (
            <li key={target}>
              <button
                type="button"
                onClick={() => setPane(target)}
                className="press-response-row w-full min-h-11 py-3 flex items-center justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-label font-medium text-foreground">{label}</span>
                  <span className="block text-caption text-muted-foreground mt-0.5">{hint}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pane === 'cycle' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-caption font-bold text-foreground">평균 주기 길이</span>
              <input
                type="number"
                min={CYCLE_LENGTH_MIN}
                max={CYCLE_LENGTH_MAX}
                value={cycleDraft}
                onChange={(event) => setCycleDraft(Number(event.target.value))}
                disabled={settingsPending}
                className="w-full min-h-11 p-2.5 rounded-control border border-border bg-background text-body"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-caption font-bold text-foreground">평균 생리 기간</span>
              <input
                type="number"
                min={PERIOD_LENGTH_MIN}
                max={PERIOD_LENGTH_MAX}
                value={periodDraft}
                onChange={(event) => setPeriodDraft(Number(event.target.value))}
                disabled={settingsPending}
                className="w-full min-h-11 p-2.5 rounded-control border border-border bg-background text-body"
              />
            </label>
          </div>
          <p className="text-caption text-muted-foreground">
            주기 {CYCLE_LENGTH_MIN}~{CYCLE_LENGTH_MAX}일 · 기간 {PERIOD_LENGTH_MIN}~{PERIOD_LENGTH_MAX}일
          </p>
          {prediction.status === 'personalized' && (
            /* Both numbers, side by side: the measured value never silently
               overwrites what the user typed. */
            <p className="text-caption text-muted-foreground">
              설정값 {cycleLength}일 · 최근 기록 기준 약 {prediction.medianCycleLength}일
            </p>
          )}
          {settingsError && <p role="alert" className="text-caption text-destructive">{settingsError}</p>}
          <button
            type="button"
            onClick={() => onSaveLengths(cycleDraft, periodDraft)}
            disabled={settingsPending}
            className="press-response w-full min-h-11 rounded-control bg-foreground text-background text-label font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {settingsPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {settingsPending ? '저장 중' : '저장'}
          </button>
        </div>
      )}

      {pane === 'sharing' && (
        <CycleSharingSettings
          preferences={preferences}
          prediction={prediction}
          periodActive={periodActive}
          pendingKey={sharingPendingKey}
          error={sharingError}
          onToggle={onToggleSharing}
        />
      )}

      {pane === 'privacy' && (
        <div className="space-y-3 text-caption text-muted-foreground leading-relaxed">
          <p><strong className="text-foreground">수집 항목:</strong> 생리 시작·종료일, 일별 컨디션(증상·통증·기분·메모), 평균 주기 설정</p>
          <p><strong className="text-foreground">이용 목적:</strong> 본인 주기 기록, 본인 주기 예상, 본인 패턴 참고</p>
          <p><strong className="text-foreground">파트너 공유:</strong> 직접 선택한 항목만. 원본 기록은 공유되지 않아요.</p>
          <p><strong className="text-foreground">보유 기간:</strong> 직접 삭제하거나 회원 탈퇴할 때까지</p>
          <a
            href="/legal/privacy"
            className="flex min-h-11 items-center text-caption font-medium text-info underline underline-offset-2"
          >
            개인정보 처리방침 보기
          </a>

          {consentError && <p role="alert" className="text-caption text-destructive">{consentError}</p>}

          {confirmingRevoke ? (
            <div className="rounded-control border border-destructive/30 bg-destructive/5 p-3 space-y-2">
              <p className="text-caption text-foreground">
                동의를 철회하면 주기 기능을 사용할 수 없어요. 이미 저장된 기록은 삭제되지 않고, 설정에서 직접 삭제할 수 있어요.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={consentPending}
                  className="press-response-row flex-1 min-h-11 rounded-control border border-border text-label font-medium"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={onRevokeConsent}
                  disabled={consentPending}
                  className="press-response flex-1 min-h-11 rounded-control bg-destructive text-destructive-foreground text-label font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {consentPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  철회
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRevoke(true)}
              className="press-response min-h-11 text-caption font-medium text-destructive underline underline-offset-2"
            >
              민감정보 동의 철회
            </button>
          )}
        </div>
      )}
    </CycleSheet>
  );
}
