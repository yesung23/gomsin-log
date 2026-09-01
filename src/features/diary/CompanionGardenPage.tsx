import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { localToday } from '@/lib/cycle';
import { togetherDays } from '@/lib/coupleStats';
import { isCalendarDate } from '@/lib/trips';
import { deriveCompanionGardenState } from './companionGarden';
import {
  loadGardenAccessories,
  saveGardenAccessory,
  type GardenAccessory,
  type GardenCompanionId,
} from '@/lib/companionGardenLocalState';
import { CompanionGardenView } from './CompanionGardenView';

function CompanionGardenPageBody() {
  const navigate = useNavigate();
  const { state, sharedSyncStatus, coupleLifecycle } = useStore();
  const couple = state.profile.couple;
  const anniversaryDate = couple.anniversaryDate;
  const userId = state.authenticatedUser?.id || state.profile.id || '';
  const [accessories, setAccessories] = useState(() => loadGardenAccessories(userId));

  useEffect(() => {
    setAccessories(loadGardenAccessories(userId));
  }, [userId]);

  const changeAccessory = (companion: GardenCompanionId, accessory: GardenAccessory) => {
    setAccessories(saveGardenAccessory(userId, companion, accessory));
  };

  const hasLocalActiveCouple = couple.connected && couple.status === 'active';
  const hasVerifiedActiveCouple = hasLocalActiveCouple
    && coupleLifecycle === 'connected'
    && Boolean(couple.coupleId)
    && Boolean(state.authenticatedUser?.id || state.profile.id);

  const readableDate = hasVerifiedActiveCouple
    && sharedSyncStatus !== 'unavailable'
    && anniversaryDate
    && isCalendarDate(anniversaryDate)
    ? anniversaryDate
    : null;

  const gardenState = useMemo(
    () => deriveCompanionGardenState(
      readableDate ? togetherDays(readableDate, localToday()) : null,
    ),
    [readableDate],
  );

  const unavailableReason = !hasLocalActiveCouple
    ? 'inactive_couple'
    : !hasVerifiedActiveCouple || sharedSyncStatus === 'unavailable'
      ? 'shared_unavailable'
      : 'missing_date';

  return (
    <CompanionGardenView
      state={gardenState}
      unavailableReason={unavailableReason}
      accessories={accessories}
      onAccessoryChange={changeAccessory}
      onBack={() => navigate('/diary')}
    />
  );
}

export function CompanionGardenPage() {
  return (
    <MobileShell>
      <CompanionGardenPageBody />
    </MobileShell>
  );
}
