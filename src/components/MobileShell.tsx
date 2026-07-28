import { Link, useLocation } from 'react-router-dom';
import { Home, PenLine, Heart, Shield, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { InstallPromptBanner } from '@/components/InstallPromptBanner';

const TABS = [
  { to: '/home', label: '홈', icon: Home },
  { to: '/record', label: '기록', icon: PenLine },
  { to: '/us', label: '우리', icon: Heart },
  { to: '/service', label: '복무', icon: Shield },
  { to: '/my', label: '마이', icon: User },
] as const;

export function MobileShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  
  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex justify-center bg-[oklch(0.95_0.008_85)]">
      <div className="relative w-full max-w-[430px] min-h-screen min-h-[100dvh] bg-background shadow-[0_0_60px_-30px_rgba(27,35,64,0.18)] flex flex-col pt-[env(safe-area-inset-top,0px)]">
        <main className="flex-1 pb-24 overflow-y-auto">
          {children}
        </main>
        
        {/* iOS Safari Standalone Install Banner Prompt */}
        <InstallPromptBanner />

        {/* Fixed 5-Tab Navigation Bar with safe-area bottom inset */}
        <nav
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-card/95 backdrop-blur-md border-t border-border/60 z-50"
          role="tablist"
          aria-label="앱 내비게이션"
        >
          <ul className="grid grid-cols-5 px-2 pt-2 pb-[max(env(safe-area-inset-bottom,0px),10px)]">
            {TABS.map((t) => {
              const active = pathname === t.to || (t.to === '/home' && pathname === '/');
              const Icon = t.icon;
              return (
                <li key={t.to}>
                  <Link
                    to={t.to}
                    role="tab"
                    aria-selected={active}
                    aria-label={t.label}
                    className={cn(
                      'flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium transition-all duration-200 min-h-[44px] justify-center relative',
                      active ? 'text-coral' : 'text-muted-foreground'
                    )}
                  >
                    <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                    <span className={cn(active && 'font-bold')}>{t.label}</span>
                    {active && (
                      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-full bg-coral" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
