import { Toaster } from 'sonner';
import { useStore } from '@/lib/store';

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
