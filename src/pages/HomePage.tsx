import { MobileShell } from '@/components/MobileShell';
import { WidgetDashboard } from '@/features/home/WidgetDashboard';
import { SoldierDashboard } from '@/features/home/SoldierDashboard';
import { useStore } from '@/lib/store';

export function HomePage() {
  const { state } = useStore();
  const isGomsin = state.profile.role === 'gomsin';

  return (
    <MobileShell>
      {isGomsin ? <WidgetDashboard /> : <SoldierDashboard />}
    </MobileShell>
  );
}
