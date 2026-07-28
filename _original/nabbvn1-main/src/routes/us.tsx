import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronRight, Camera, PenLine, Mic, CalendarHeart, X } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "../components/MobileShell";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/us")({
  component: UsPage,
  head: () => ({
    meta: [
      { title: "우리 · NABBVN" },
      { name: "description", content: "떨어져 있는 시간도 둘의 이야기로 남는 관계 아카이브." },
    ],
  }),
});

function daysBetween(a: Date, b: Date) {
  const ms = b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

function UsPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(false);

  const { connectedDays, nextMilestone, milestoneLeft } = useMemo(() => {
    const anniv = new Date(state.anniversaryDate);
    const today = new Date();
    const connectedDays = Math.max(1, daysBetween(new Date(anniv), new Date(today)) + 1);
    const nextMilestone = Math.ceil((connectedDays + 1) / 100) * 100;
    const milestoneLeft = nextMilestone - connectedDays;
    return { connectedDays, nextMilestone, milestoneLeft };
  }, [state.anniversaryDate]);

  const anniv = new Date(state.anniversaryDate);
  const annivStr = `${anniv.getFullYear()}년 ${anniv.getMonth() + 1}월 ${anniv.getDate()}일`;

  const memories = [
    { title: "처음 함께한 봄", date: "2024.03.21", tint: "oklch(0.93 0.05 60)" },
    { title: `${state.partnerName}의 첫 휴가`, date: "2025.08.07", tint: "oklch(0.93 0.045 155)" },
    { title: `${state.myName}의 생일`, date: "2026.05.12", tint: "oklch(0.93 0.04 300)" },
  ];

  const upcoming = [
    { label: `${nextMilestone}일`, when: `${milestoneLeft}일 뒤` },
    { label: `${state.partnerName}의 휴가`, when: "12일 뒤" },
    { label: `${state.myName}의 생일`, when: "45일 뒤" },
  ];

  return (
    <MobileShell>
      <div className="bg-[oklch(0.985_0.008_85)] min-h-full">
        <header className="px-6 pt-14 pb-6">
          <h1 className="text-[26px] font-bold tracking-tight">
            {state.myName} <span className="text-coral">♡</span> {state.partnerName}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {annivStr}부터,<br />서로의 오늘을 함께 지나고 있어요.
          </p>
          <div className="mt-6">
            <div className="text-[42px] font-bold leading-none tracking-tight">
              연결 <span className="text-coral">{connectedDays}</span>일째
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              다가오는 기념일 · {nextMilestone}일 D-{milestoneLeft}
            </div>
          </div>
        </header>

        <section className="mx-5">
          <button
            onClick={() => navigate({ to: "/home" })}
            className="w-full text-left rounded-2xl bg-card border border-border/50 px-5 py-4 flex items-start gap-4"
          >
            <div className="flex-1">
              <div className="text-[11px] text-muted-foreground">오늘의 우리</div>
              <p className="mt-1.5 text-[14px] leading-relaxed">
                오늘 {state.myName}은 <span className="font-semibold">‘공감’</span>을,<br />
                {state.partnerName}은 <span className="font-semibold">‘잘 듣는 마음’</span>을 남겼어요.
              </p>
              <span className="inline-block mt-3 text-[11px] px-2 py-0.5 rounded-full bg-[oklch(0.96_0.02_155)] text-[oklch(0.4_0.05_155)]">
                서로의 하루를 확인했어요
              </span>
            </div>
            <ChevronRight size={16} className="text-muted-foreground shrink-0 mt-1" />
          </button>
        </section>

        <section className="mx-5 mt-4">
          <div className="rounded-2xl bg-card border border-border/50 px-5 py-4">
            <div className="text-[11px] text-muted-foreground">우리가 지나온 시간</div>
            <p className="mt-2 text-[14px] leading-relaxed">
              이번 달, 서로의 하루를 <span className="font-semibold">18번</span> 더 가까이 들여다봤어요.
            </p>
            <div className="mt-4 flex gap-6 text-[11px] text-muted-foreground">
              <div>
                <div className="text-[15px] font-semibold text-foreground">24</div>
                {state.myName}이 남긴 기록
              </div>
              <div>
                <div className="text-[15px] font-semibold text-foreground">17</div>
                {state.partnerName}이 읽은 브리핑
              </div>
            </div>
          </div>
        </section>

        <section className="mx-5 mt-4">
          <button
            onClick={() => toast("월간 아카이브는 준비 중이에요")}
            className="w-full text-left rounded-2xl overflow-hidden border border-border/50"
          >
            <div
              className="h-24 w-full"
              style={{ background: "linear-gradient(135deg, oklch(0.94 0.035 300) 0%, oklch(0.95 0.03 60) 100%)" }}
            />
            <div className="bg-card px-5 py-4">
              <div className="text-[11px] text-muted-foreground">7월의 우리 이야기</div>
              <p className="mt-1.5 text-[14px] leading-relaxed">
                비가 자주 오던 7월,<br />
                {state.myName}은 바쁜 날에도 작은 마음을 남겼고<br />
                {state.partnerName}은 저녁마다 그 마음을 읽었어요.
              </p>
              <div className="mt-3 text-[11px] text-muted-foreground">
                사진 14장 · 기록 28개 · 마음 31개
              </div>
            </div>
          </button>
        </section>

        <section className="mt-6">
          <div className="px-5 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">다시 꺼내보고 싶은 순간</h2>
            <button onClick={() => toast("추억 앨범은 준비 중이에요")} className="text-[11px] text-muted-foreground">
              모두 보기
            </button>
          </div>
          <div className="mt-3 flex gap-3 overflow-x-auto px-5 pb-1">
            {memories.map((m, i) => (
              <button
                key={i}
                onClick={() => toast(`${m.title} · 준비 중`)}
                className="shrink-0 w-[148px] text-left"
              >
                <div
                  className="w-full h-[110px] rounded-xl flex items-end p-3"
                  style={{ background: `linear-gradient(160deg, ${m.tint}, oklch(0.98 0.01 85))` }}
                >
                  <Camera size={16} className="text-foreground/40" />
                </div>
                <div className="mt-2 text-[13px] font-semibold leading-tight">{m.title}</div>
                <div className="text-[11px] text-muted-foreground">{m.date}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="mx-5 mt-6">
          <div className="rounded-2xl bg-card border border-border/50 divide-y divide-border/50">
            <div className="px-5 py-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold">곧 함께할 날</span>
              <button
                onClick={() => toast("기념일 캘린더는 준비 중이에요")}
                className="text-[11px] text-muted-foreground flex items-center gap-0.5"
              >
                더 보기 <ChevronRight size={12} />
              </button>
            </div>
            {upcoming.map((u, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CalendarHeart size={16} className="text-coral/70" />
                  <span className="text-[14px]">{u.label}</span>
                </div>
                <span className="text-[12px] text-muted-foreground">{u.when}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="px-5 mt-6 pb-8">
          <button
            onClick={() => setSheet(true)}
            className="w-full h-12 rounded-2xl bg-coral text-coral-foreground text-sm font-semibold"
          >
            오늘의 추억 남기기
          </button>
        </div>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50 flex justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSheet(false)} />
          <div className="relative w-full max-w-[430px] mt-auto bg-card rounded-t-3xl px-5 pt-4 pb-8">
            <div className="mx-auto w-10 h-1 rounded-full bg-border" />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm font-semibold">오늘의 추억 남기기</div>
              <button onClick={() => setSheet(false)} aria-label="닫기">
                <X size={18} className="text-muted-foreground" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { icon: Camera, label: "사진" },
                { icon: PenLine, label: "한 줄 편지" },
                { icon: Mic, label: "음성" },
                { icon: CalendarHeart, label: "기억할 날" },
              ].map((o) => {
                const Icon = o.icon;
                return (
                  <button
                    key={o.label}
                    onClick={() => { setSheet(false); toast(`${o.label} · 준비 중`); }}
                    className="rounded-2xl bg-muted/40 py-6 flex flex-col items-center gap-2 active:bg-muted/60 transition"
                  >
                    <Icon size={20} className="text-foreground/70" />
                    <span className="text-[13px] font-medium">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
