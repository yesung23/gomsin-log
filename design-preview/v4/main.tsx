import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../preview.css';
import { V4Shell } from './V4Shell';

/** 부트스트랩만. 컴포넌트는 `V4Shell.tsx`에 있다. */
createRoot(document.getElementById('v4-root') as HTMLElement).render(
  <StrictMode>
    <V4Shell />
  </StrictMode>,
);
