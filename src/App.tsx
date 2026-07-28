import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from '@/lib/store';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { HomePage } from '@/pages/HomePage';
import { RecordPage } from '@/pages/RecordPage';
import { UsPage } from '@/pages/UsPage';
import { ServicePage } from '@/pages/ServicePage';
import { MyPage } from '@/pages/MyPage';

export function App() {
  const { state } = useStore();
  
  if (!state.setupComplete) {
    return (
      <Routes>
        <Route path="*" element={<OnboardingPage />} />
      </Routes>
    );
  }
  
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/record" element={<RecordPage />} />
      <Route path="/us" element={<UsPage />} />
      <Route path="/service" element={<ServicePage />} />
      <Route path="/my" element={<MyPage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
