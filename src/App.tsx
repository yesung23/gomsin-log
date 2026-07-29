import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from '@/lib/store';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { AuthCallbackPage } from '@/pages/AuthCallbackPage';
import { HomePage } from '@/pages/HomePage';
import { RecordPage } from '@/pages/RecordPage';
import { SchedulePage } from '@/pages/SchedulePage';
import { UsPage } from '@/pages/UsPage';
import { MyPage } from '@/pages/MyPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TripsPage } from '@/pages/TripsPage';
import { TripDetailPage } from '@/pages/TripDetailPage';

export function App() {
  const { state } = useStore();

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      {!state.setupComplete ? (
        <>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<OnboardingPage />} />
        </>
      ) : (
        <>
          <Route path="/" element={<HomePage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/record" element={<RecordPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/us" element={<UsPage />} />
          <Route path="/my" element={<MyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
}
