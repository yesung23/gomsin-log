import { Link, useRouterState } from "@tanstack/react-router";
import { Home, PenLine, Heart, Shield, User } from "lucide-react";
import type { ReactNode } from "react";

const TABS = [
  { to: "/home", label: "홈", icon: Home },
  { to: "/record", label: "기록", icon: PenLine },
  { to: "/us", label: "우리", icon: Heart },
  { to: "/service", label: "복무", icon: Shield },
  { to: "/me", label: "마이", icon: User },
] as const;

export function MobileShell({ children, hideTabs = false }: { children: ReactNode; hideTabs?: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen w-full flex justify-center bg-[oklch(0.95_0.008_85)]">
      <div className="relative w-full max-w-[430px] min-h-screen bg-background shadow-[0_0_60px_-30px_rgba(27,35,64,0.25)] flex flex-col">
        <main className={`flex-1 ${hideTabs ? "" : "pb-24"}`}>{children}</main>
        {!hideTabs && (
          <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-card/95 backdrop-blur border-t border-border">
            <ul className="grid grid-cols-5 px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
              {TABS.map((t) => {
                const active = path === t.to || (t.to === "/home" && path === "/");
                const Icon = t.icon;
                return (
                  <li key={t.to}>
                    <Link
                      to={t.to}
                      className={`flex flex-col items-center gap-1 py-1.5 text-[11px] font-medium transition-colors ${
                        active ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                      <span>{t.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
