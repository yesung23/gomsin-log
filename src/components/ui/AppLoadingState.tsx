import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Full-frame loading for both initial hydration and lazy route transitions.
 *
 * A named static structure remains understandable when Reduced Motion disables
 * the pulse. It also prevents a blank spinner from being mistaken for a frozen
 * app while private data is intentionally held behind hydration.
 */
export function AppLoadingState({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[100dvh] w-full justify-center bg-muted">
      <main
        data-astryx-theme="gomsin"
        className="notebook min-h-[100dvh] w-full max-w-[430px] px-6 pt-[max(env(safe-area-inset-top,0px),5rem)]"
      >
        <div className="mx-auto w-full max-w-sm">
          <p className="text-title leading-none" style={{ color: 'var(--ink)' }}>
            곰신로그
          </p>
          <div className="ink-rule my-4" aria-hidden="true" />
          <Skeleton label={label} description={description} lines={3} />
        </div>
      </main>
    </div>
  );
}
