import { Shield, ChevronRight, AlertTriangle } from 'lucide-react';
import { bootstrapStateFromFacts, type BootstrapFacts, type BootstrapState } from '@/app/e2ee/bootstrapStateMachine';

export type DeviceProtectionSectionProps = {
  /** State is retained for the unavailable shell; verified facts take precedence. */
  state?: BootstrapState | 'UNAVAILABLE';
  facts?: BootstrapFacts;
  onStart?: () => void;
  busy?: boolean;
  errorMessage?: string;
};

/** Small, state-driven surface for My/Settings. Crypto jargon stays in code. */
export function DeviceProtectionSection({
  state,
  facts,
  onStart,
  busy = false,
  errorMessage,
}: DeviceProtectionSectionProps) {
  const derivedState = facts ? bootstrapStateFromFacts(facts) : state ?? 'UNAVAILABLE';
  const unavailable = derivedState === 'UNAVAILABLE';
  // COUPLE_KEYS_READY only means the shared key is available. It is not proof
  // that the runtime/LCK is installed, so it must not suppress the CTA or claim
  // that protected records are ready.
  const ready = derivedState === 'ACTIVE' || derivedState === 'RUNTIME_READY';
  const couplePending = derivedState === 'COUPLE_KEYS_PENDING';

  return (
    <section className="rounded-surface bg-card border border-border p-4 space-y-3" data-testid="device-protection">
      <div className="flex items-start gap-3">
        <Shield size={20} className="mt-0.5 text-coral" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-heading text-foreground">기록 보호</h2>
          <p className="text-caption text-muted-foreground mt-1 leading-relaxed">
            {unavailable
              ? '이 기기에서 보호 설정 상태를 확인할 수 없어요.'
              : ready
                ? '이 기기에서 안전한 기록을 사용할 준비가 되었어요.'
                : couplePending
                  ? '개인 기록 보호는 준비되었어요. 함께 보는 기록의 보호 설정은 파트너 연결 후 완료돼요.'
                  : '이 기기에서 곰신로그의 기록을 안전하게 보호하려면 한 번의 보안 설정이 필요해요.'}
          </p>
          {errorMessage && (
            <p className="text-caption text-warning-foreground bg-warning-surface border border-warning/30 rounded-control p-2 mt-2 flex gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </p>
          )}
        </div>
      </div>
      {!unavailable && !ready && onStart && (
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="w-full h-11 rounded-control bg-coral-fill text-coral-fill-foreground text-label font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy ? '준비 중...' : '보호 설정 시작'}
          {!busy && <ChevronRight size={16} aria-hidden="true" />}
        </button>
      )}
    </section>
  );
}
