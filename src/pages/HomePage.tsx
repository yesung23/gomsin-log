import { MobileShell } from '@/components/MobileShell';
import { WidgetDashboard } from '@/features/home/WidgetDashboard';

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
      <WidgetDashboard />
    </MobileShell>
  );
}
