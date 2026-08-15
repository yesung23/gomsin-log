import { MobileShell } from '@/components/MobileShell';
import { WidgetDashboard } from '@/features/home/WidgetDashboard';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';

/**
 * One home for both roles.
 *
 * 군화 used to get `SoldierDashboard`, a separate hardcoded tree with no widget
 * system: nothing on it could be reordered, removed or added. `WidgetDashboard` is
 * now role-aware, so both people get the same add/remove/reorder engine and differ
 * only in their default layout and in which widgets they are offered
 * (`DEFAULT_LAYOUT_BY_ROLE` / `widgetsForRole`).
 *
 * Everything the soldier screen did well was kept as widgets rather than deleted:
 * the daily story became `partner_emotion_summary`, the mood + opening-line hint
 * became `care_hint`, and the service card is the existing `service_progress`.
 */
export function HomePage() {
  return (
    <MobileShell>
      <div className="px-4 pt-3">
        <Link
          to="/chat"
          aria-label="채팅으로 이동"
          className="flex min-h-11 items-center gap-2 text-label font-semibold text-coral-strong"
        >
          <MessageCircle size={18} aria-hidden="true" />
          채팅
        </Link>
      </div>
      <WidgetDashboard />
    </MobileShell>
  );
}
