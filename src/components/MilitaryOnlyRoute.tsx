import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '@/lib/useStore';
import { resolveRelationshipContext } from '@/lib/relationshipContext';

export function MilitaryOnlyRoute({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const relationshipContext = resolveRelationshipContext(
    state.profile.couple.relationshipContext,
  );

  // Missing context is the legacy military contract. A known general context,
  // or a malformed value that escaped hydration, never renders military UI.
  if (relationshipContext !== 'military') {
    return <Navigate to="/my" replace />;
  }

  return children;
}
