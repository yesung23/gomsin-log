import { Shield, ChevronRight, AlertTriangle } from 'lucide-react';
import type { DeviceProtectionStatus } from '@/app/e2ee/deviceProtectionStatus';
import { Button } from '@/components/ui/Button';

export type DeviceProtectionSectionProps = {
  status: DeviceProtectionStatus;
  onStart?: () => void;
  onRecover?: () => void;
  busy?: boolean;
  errorMessage?: string;
};

/** Small, state-driven surface for My/Settings. Crypto jargon stays in code. */
export function DeviceProtectionSection({
  status,
  onStart,
  onRecover,
  busy = false,
  errorMessage,
}: DeviceProtectionSectionProps) {
  const protectedOnThisDevice = status === 'PROTECTED';
  const setupRequired = status === 'SETUP_REQUIRED';
  const recoveryRequired = status === 'RECOVERY_REQUIRED';
  const storageUnavailable = status === 'SECURE_STORAGE_UNAVAILABLE';

  return (
    <section className="rounded-surface bg-card border border-border p-4 space-y-3" data-testid="device-protection">
      <div className="flex items-start gap-3">
        <Shield size={20} className="mt-0.5 text-coral" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-heading text-foreground">기록 보호</h2>
          <p className="text-caption text-muted-foreground mt-1 leading-relaxed">
            {protectedOnThisDevice
              ? '이 기기에서 기록 보호를 사용할 수 있어요.'
              : setupRequired
                ? '이 기기의 보안 저장소를 이용해 기록 보호를 설정해 주세요.'
                : recoveryRequired
                  ? '이 기기에서는 기록 보호를 복구해야 해요.'
                  : storageUnavailable
                    ? '이 기기에서 필요한 보안 저장소를 사용할 수 없어요.'
                    : '보호 상태를 지금 확인할 수 없어요. 잠시 후 다시 시도해 주세요.'}
          </p>
          {errorMessage && (
            <p className="text-caption text-warning-foreground bg-warning-surface border border-warning/30 rounded-control p-2 mt-2 flex gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </p>
          )}
        </div>
      </div>
      {setupRequired && onStart && (
        <Button variant="primary" full
                onClick={onStart}
          disabled={busy}>
          {busy ? '준비 중...' : '보호 설정 시작'}
          {!busy && <ChevronRight size={16} aria-hidden="true" />}
        </Button>
      )}
      {recoveryRequired && onRecover && (
        <Button variant="primary" full
                onClick={onRecover}
          disabled={busy}>
          {busy ? '준비 중...' : '기록 보호 복구'}
          {!busy && <ChevronRight size={16} aria-hidden="true" />}
        </Button>
      )}
    </section>
  );
}
