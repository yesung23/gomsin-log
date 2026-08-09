import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './preview.css';
import { PreviewApp } from './Harness';

/** Bootstrap only. Components live in `Harness.tsx` (see the note there). */
createRoot(document.getElementById('preview-root') as HTMLElement).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
