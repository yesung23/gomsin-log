import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  notificationPermission,
  requestNotificationPermission,
  saveNotificationPreferences,
  type NotificationPermission,
  type NotificationPreferences,
} from '@/lib/notifications';

export function NotificationPreferencesSection({ userId }: { userId: string }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [permission, setPermission] = useState<NotificationPermission>(() => notificationPermission());

  useEffect(() => {
    setPreferences(loadNotificationPreferences(userId));
    setPermission(notificationPermission());
  }, [userId]);

  if (!userId) return null;

  const update = (patch: Partial<NotificationPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveNotificationPreferences(userId, next);
  };

  const request = async () => {
    const nextPermission = await requestNotificationPermission();
    setPermission(nextPermission);
    if (nextPermission === 'granted') update({ systemEnabled: true });
    else if (nextPermission === 'denied') update({ systemEnabled: false });
  };

  return (
    <section className="space-y-2" data-testid="notification-preferences">
      <h2 className="text-heading text-foreground">알림과 다시 들어오기</h2>
      <div className="rounded-surface bg-card border border-border p-4 space-y-3">
        <p className="text-caption text-muted-foreground leading-relaxed">
          알림에는 기록 본문이나 사진이 들어가지 않아요. 현재는 앱이 열려 있을 때만 알려주며, 누르면 현재 권한으로 확인할 수 있는 정확한 원본으로 이동해요.
        </p>
        <label className="flex items-center justify-between gap-3 min-h-11">
          <span className="flex items-center gap-2 text-label font-semibold text-foreground"><Bell size={16} className="text-coral" />앱 안에서 다시 알려주기</span>
          <input type="checkbox" checked={preferences.inAppEnabled} onChange={(event) => update({ inAppEnabled: event.target.checked })} className="h-5 w-5 accent-coral" />
        </label>
        <label className="flex items-center justify-between gap-3 min-h-11">
          <span className="flex items-center gap-2 text-label font-semibold text-foreground"><BellOff size={16} className="text-coral" />새로운 하루 알림</span>
          <input type="checkbox" checked={preferences.sharedRecordEnabled} onChange={(event) => update({ sharedRecordEnabled: event.target.checked })} className="h-5 w-5 accent-coral" />
        </label>
        <label className="flex items-center justify-between gap-3 min-h-11">
          <span className="flex items-center gap-2 text-label font-semibold text-foreground"><BellOff size={16} className="text-coral" />이야기할 것 알림</span>
          <input type="checkbox" checked={preferences.talkAboutEnabled} onChange={(event) => update({ talkAboutEnabled: event.target.checked })} className="h-5 w-5 accent-coral" />
        </label>
        {permission === 'unsupported' ? (
          <p className="text-caption text-muted-foreground">이 기기에서는 앱이 열려 있을 때 보여주는 안내만 사용할 수 있어요.</p>
        ) : permission === 'denied' ? (
          <p className="text-caption text-muted-foreground">브라우저 알림이 차단되어 있어요. 기기 설정에서 허용하면 사용할 수 있어요.</p>
        ) : (
          <button type="button" onClick={() => void request()} disabled={permission === 'granted'} className="w-full min-h-11 rounded-control border border-border text-label font-semibold text-foreground disabled:opacity-60">
            {permission === 'granted' ? '앱이 열려 있을 때 브라우저 알림 사용' : '앞에서 보여줄 브라우저 알림 허용'}
          </button>
        )}
      </div>
    </section>
  );
}
