import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import {
  notificationDestination,
  subscribeNotifications,
  type ReentryNotification,
} from '@/lib/notifications';

/** In-app re-entry surface; it carries no record preview or sensitive metadata. */
export function NotificationReentryBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useStore();
  const [items, setItems] = useState<ReentryNotification[]>([]);
  const userId = state.authenticatedUser?.id || state.profile.id || '';

  useEffect(() => {
    setItems([]);
    if (!userId) return;
    return subscribeNotifications((notification) => {
      if (notification.userId !== userId) return;
      setItems((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 3));
    });
  }, [userId]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || detail.userId !== userId) return;
      const destination = notificationDestination(detail);
      if (destination) navigate(destination);
    };
    window.addEventListener('gomsinlog:notification-open', open);
    return () => window.removeEventListener('gomsinlog:notification-open', open);
  }, [navigate, userId]);

  const visibleItems = items.filter((item) => item.userId === userId);
  if (visibleItems.length === 0 || location.pathname === '/auth/callback') return null;

  const open = (item: ReentryNotification) => {
    const destination = notificationDestination(item);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    if (destination) navigate(destination);
  };

  return (
    <aside className="fixed top-[calc(env(safe-area-inset-top,0px)+4rem)] left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[398px] z-[60] space-y-2" aria-label="새 알림">
      {visibleItems.map((item) => (
        <div key={item.id} className="flex items-center gap-2 rounded-surface border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm" role="status">
          <Bell size={17} className="shrink-0 text-coral" aria-hidden="true" />
          <button type="button" className="press-response-row min-w-0 flex-1 text-left rounded-control" onClick={() => open(item)}>
            <span className="block text-label font-bold text-foreground">{item.title}</span>
            <span className="block text-caption text-muted-foreground">{item.body}</span>
            <span className="block text-caption text-coral mt-0.5">원본 확인하기</span>
          </button>
          <button type="button" className="press-response min-h-11 min-w-11 flex items-center justify-center rounded-control text-muted-foreground" aria-label="알림 닫기" onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </aside>
  );
}
