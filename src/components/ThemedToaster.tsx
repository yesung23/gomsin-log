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
        offset={{ top: 'calc(env(safe-area-inset-top, 0px) + 4rem)' }}
        mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 4rem)' }}
        theme={state.theme === 'dark' ? 'dark' : 'light'}
        richColors={false}
      />
    </div>
  );
}
