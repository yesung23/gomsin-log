import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Apple, Chrome } from "lucide-react";
import { useStore, type Role } from "../lib/store";

export const Route = createFileRoute("/")({
  component: Onboarding,
});

function Onboarding() {
  const { state, update } = useStore();
  const navigate = useNavigate();
  const [myName, setMyName] = useState(state.setup ? state.myName : "");
  const [partnerName, setPartnerName] = useState(state.setup ? state.partnerName : "");
  const [role, setRole] = useState<Role>(state.role);

  if (state.setup) {
    // If already set up, jump to home
    navigate({ to: "/home" });
    return null;
  }

  const canSubmit = myName.trim() && partnerName.trim();

  const submit = () => {
    if (!canSubmit) return;
    update({ myName: myName.trim(), partnerName: partnerName.trim(), role, setup: true });
    navigate({ to: "/home" });
  };

  return (
    <div className="min-h-screen w-full flex justify-center bg-[oklch(0.95_0.008_85)]">
      <div className="w-full max-w-[430px] min-h-screen bg-background px-6 pt-16 pb-10 flex flex-col">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground" style={{ letterSpacing: "0.02em" }}>
            NABBVN
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">짧은 연락 시간도, 더 가까운 하루로.</p>
        </div>

        <div className="mt-10 space-y-3">
          <button className="w-full h-12 rounded-2xl bg-foreground text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2">
            <Apple size={18} /> Apple로 계속하기
          </button>
          <button className="w-full h-12 rounded-2xl bg-card border border-border text-foreground text-sm font-semibold flex items-center justify-center gap-2">
            <Chrome size={18} /> Google로 계속하기
          </button>
        </div>

        <div className="my-8 flex items-center gap-3 text-[11px] text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> 또는 이름으로 시작하기 <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-muted-foreground">내 이름 또는 별명</span>
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="예) 춘향"
              className="mt-1 w-full h-11 rounded-xl bg-muted/60 px-4 text-sm outline-none focus:bg-card focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">상대방 이름 또는 별명</span>
            <input
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              placeholder="예) 몽룡"
              className="mt-1 w-full h-11 rounded-xl bg-muted/60 px-4 text-sm outline-none focus:bg-card focus:ring-2 focus:ring-ring/40"
            />
          </label>

          <div>
            <span className="text-xs text-muted-foreground">나의 역할</span>
            <div className="mt-2 grid gap-2">
              <RoleCard
                active={role === "gomshin"}
                onClick={() => setRole("gomshin")}
                title="곰신"
                desc="기록을 남길게요"
                emoji="🌸"
              />
              <RoleCard
                active={role === "soldier"}
                onClick={() => setRole("soldier")}
                title="군인"
                desc="브리핑을 받을게요"
                emoji="🎖️"
              />
            </div>
          </div>
        </div>

        <div className="mt-auto pt-8">
          <button
            disabled={!canSubmit}
            onClick={submit}
            className="w-full h-13 py-3.5 rounded-2xl bg-coral text-coral-foreground text-sm font-semibold disabled:opacity-40 transition"
          >
            우리 공간 만들기
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  active, onClick, title, desc, emoji,
}: { active: boolean; onClick: () => void; title: string; desc: string; emoji: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl px-4 py-3.5 flex items-center gap-3 border transition ${
        active ? "border-foreground/60 bg-card shadow-sm" : "border-border bg-card/60"
      }`}
    >
      <span className="text-2xl">{emoji}</span>
      <div className="flex-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <span
        className={`w-5 h-5 rounded-full border-2 ${
          active ? "border-coral bg-coral" : "border-border"
        }`}
      />
    </button>
  );
}
