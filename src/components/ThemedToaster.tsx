import { Toaster } from 'sonner';
import { useStore } from '@/lib/useStore';

export function ThemedToaster() {
  const { state } = useStore();

  return (
    <Toaster
      position="top-center"
      theme={state.theme === 'dark' ? 'dark' : 'light'}
      richColors={false}
    />
  );
}
