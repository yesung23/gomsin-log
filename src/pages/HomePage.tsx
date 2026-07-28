import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/store';
import { GomshinHome } from '@/features/home/GomshinHome';
import { SoldierHome } from '@/features/home/SoldierHome';

export function HomePage() {
  const { state } = useStore();
  
  return (
    <MobileShell>
      {state.profile.role === 'gomsin' ? <GomshinHome /> : <SoldierHome />}
    </MobileShell>
  );
}
