import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { WidgetDashboard } from '@/features/home/WidgetDashboard';
import { ConversationHome } from '@/features/home/ConversationHome';

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
  /*
    Two shapes for the same home, chosen the way `theme` is.

    `conversation` is a presentation of the SAME records, not a second product:
    both read through `visibleRecordsForViewer`, both derive their summary from
    the same deterministic `generateDailySummary`, and neither can send anything.
    Being a device preference rather than an account one matters -- the two people
    use two phones at opposite times of day, and the one catching up on a backlog
    does not want to impose that reading on the one writing through it.
  */
  const { state } = useStore();
  return (
    <MobileShell>
      {state.homeStyle === 'conversation' ? <ConversationHome /> : <WidgetDashboard />}
    </MobileShell>
  );
}
