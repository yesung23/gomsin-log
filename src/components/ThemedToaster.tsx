import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useStore } from '@/lib/useStore';

export function ThemedToaster({ onReady }: { onReady?: () => void } = {}) {
  const { state } = useStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      onReady?.();
    }
  }, [mounted, onReady]);

  return (
    <div aria-live="polite" aria-atomic="true">
      <Toaster
        position="top-center"
        theme={state.theme === 'dark' ? 'dark' : 'light'}
        richColors={false}
      />
    </div>
  );
}
