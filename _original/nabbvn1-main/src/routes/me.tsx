import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight, Sparkles, UserCircle2, Users, Brain, Share2, Lock, BookHeart,
  Bell, Megaphone, BookOpen, HelpCircle, MessageSquare, FileText, ShieldCheck, LogOut,
} from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { useStore } from "../lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/me")({
  component: MePage,
});

interface Item { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; onClick?: () => void }

function MePage() {
  const { state, reset } = useStore();
  const navigate = useNavigate();

  const groups: { title?: string; items: Item[] }[] = [
    { title: "설정", items: [
      { icon: Brain, label: "AI 브리핑 설정" },
      { icon: Share2, label: "공유 및 개인정보" },
      { icon: Sparkles, label: "기능 제안하기" },
    ]},
    { title: "계정", items: [
      { icon: UserCircle2, label: "내 계정" },
      { icon: Users, label: "커플 연결" },
    ]},
    { title: "기록", items: [
      { icon: Lock, label: "내 몸의 리듬" },
      { icon: BookHeart, label: "기록 및 추억 관리" },
    ]},
    { title: "앱", items: [
      { icon: Bell, label: "알림" },
      { icon: Megaphone, label: "공지사항" },
    ]},
    { title: "도움말", items: [
      { icon: BookOpen, label: "NABBVN 사용 설명서" },
      { icon: HelpCircle, label: "자주 묻는 질문" },
      { icon: MessageSquare, label: "문의하기" },
    ]},
    { title: "약관", items: [
      { icon: FileText, label: "서비스 이용약관" },
      { icon: ShieldCheck, label: "개인정보 처리방침" },
    ]},
  ];

  return (
    <MobileShell>
      <div className="px-5 pt-12 pb-5">
        <h1 className="text-2xl font-bold">마이</h1>
      </div>

      <div className="px-5">
        <div className="flex items-center gap-4">
          <div className="w-[72px] h-[72px] rounded-full bg-lilac flex items-center justify-center text-2xl">
            {state.role === "gomshin" ? "🌸" : "🎖️"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold truncate">{state.myName}</div>
            <div className="text-sm text-muted-foreground truncate">
              {state.role === "gomshin" ? "곰신" : "군인"} · {state.partnerName}님과 연결됨
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && (
              <div className="px-5 pb-2 text-[13px] font-semibold text-foreground">
                {g.title}
              </div>
            )}
            <ul className="mx-5 bg-white rounded-2xl overflow-hidden">
              {g.items.map((it, i) => {
                const Icon = it.icon;
                const isLast = i === g.items.length - 1;
                return (
                  <li key={i} className={!isLast ? "border-b border-border/60" : ""}>
                    <button
                      onClick={it.onClick ?? (() => toast("준비 중인 기능이에요"))}
                      className="w-full flex items-center gap-4 px-1 py-4 text-left active:bg-muted/40 transition"
                    >
                      <Icon size={22} className="text-foreground shrink-0" />
                      <span className="flex-1 text-[15px]">{it.label}</span>
                      <ChevronRight size={18} className="text-muted-foreground shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="px-5">
          <button
            onClick={() => { reset(); navigate({ to: "/" }); }}
            className="w-full h-12 rounded-2xl border border-border/70 text-sm font-semibold text-muted-foreground flex items-center justify-center gap-2 active:bg-muted/40 transition"
          >
            <LogOut size={16} /> 초기화 · 다시 시작하기
          </button>
        </div>
      </div>
    </MobileShell>
  );
}
