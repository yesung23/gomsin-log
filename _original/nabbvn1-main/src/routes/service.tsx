import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MobileShell } from "../components/MobileShell";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/service")({
  component: ServicePage,
  head: () => ({
    meta: [
      { title: "복무 · NABBVN" },
      { name: "description", content: "전역까지 남은 시간과 오늘의 식단을 한눈에." },
    ],
  }),
});

function daysBetween(a: Date, b: Date) {
  const ms = b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

function ServicePage() {
  const { state, update } = useStore();
  const [pick, setPick] = useState(state.dischargeDate);

  const { dday, progress } = useMemo(() => {
    const today = new Date();
    const dc = new Date(state.dischargeDate);
    const dday = Math.max(0, daysBetween(new Date(today), new Date(dc)));
    const total = 548;
    const done = Math.max(0, Math.min(total, total - dday));
    return { dday, progress: Math.round((done / total) * 100) };
  }, [state.dischargeDate]);

  const meals = [
    { label: "아침", items: "쌀밥, 소고기무국" },
    { label: "점심", items: "제육볶음, 계란국" },
    { label: "저녁", items: "닭갈비, 미역국" },
  ];

  return (
    <MobileShell>
      <div className="px-5 pt-12 pb-6">
        <h1 className="text-2xl font-bold">복무</h1>
        <p className="mt-1 text-xs text-muted-foreground">전역까지의 시간과 오늘의 부대 정보예요.</p>
      </div>

      <section className="px-5">
        <div className="rounded-2xl bg-card border border-border p-6 shadow-sm">
          <div className="text-xs text-muted-foreground">전역까지</div>
          <div className="mt-1 text-5xl font-bold tracking-tight">D-{dday}</div>
          <div className="mt-5">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>복무 진행률</span><span>{progress}%</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-coral rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="mt-4 text-xs text-muted-foreground">전역일 {state.dischargeDate.replaceAll("-", ".")}</div>
        </div>
      </section>

      <section className="px-5 mt-6">
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="text-sm font-semibold">전역일 계산기</div>
          <div className="mt-3 flex gap-2">
            <input
              type="date"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="flex-1 h-11 rounded-xl bg-muted/60 px-3 text-sm outline-none"
            />
            <button
              onClick={() => update({ dischargeDate: pick })}
              className="px-4 h-11 rounded-xl bg-coral text-coral-foreground text-xs font-semibold"
            >
              계산하기
            </button>
          </div>
        </div>
      </section>

      <section className="px-5 mt-6">
        <div className="rounded-2xl bg-mint p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-mint-foreground">오늘의 식단표</div>
            <span className="text-[10px] text-mint-foreground/70">MVP 예시 데이터</span>
          </div>
          <ul className="mt-3 space-y-2">
            {meals.map((m) => (
              <li key={m.label} className="flex items-start gap-3 text-sm text-mint-foreground">
                <span className="w-10 shrink-0 text-xs font-semibold opacity-70">{m.label}</span>
                <span>{m.items}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MobileShell>
  );
}
