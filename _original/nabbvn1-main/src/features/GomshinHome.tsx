import { useState } from "react";
import { Camera, Mic, Eye, Heart } from "lucide-react";
import { toast } from "sonner";
import { useStore, type CareKey } from "../lib/store";
import { CoupleAvatar } from "../components/CoupleAvatar";

const EMOTIONS = ["😊", "😌", "😞", "😤", "🥹"] as const;

const CARES: { key: CareKey; label: string; emoji: string }[] = [
  { key: "listen", label: "들어줘", emoji: "🤍" },
  { key: "empathy", label: "공감", emoji: "🫂" },
  { key: "cheer", label: "응원", emoji: "💪" },
  { key: "rest", label: "쉬고 싶어", emoji: "🌿" },
  { key: "miss", label: "보고 싶어", emoji: "💌" },
  { key: "celebrate", label: "축하", emoji: "🎉" },
];

export function GomshinHome() {
  const { state, update } = useStore();
  const [log, setLog] = useState(state.dayLog);
  const [emotion, setEmotion] = useState(state.emotion);
  const [energy, setEnergy] = useState(state.energy);
  const [care, setCare] = useState<CareKey>(state.care);

  const save = () => {
    update({ dayLog: log, emotion, energy, care });
    toast.success("오늘의 마음을 저장했어요");
  };

  return (
    <div className="pb-6">
      {/* Header */}
      <header className="px-5 pt-12 pb-4 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[26px] font-bold leading-tight">
            안녕, {state.myName}아 <span className="text-coral">♡</span>
          </h1>
        </div>
        <div className="shrink-0"><CoupleAvatar size={80} /></div>
      </header>

      {/* Connection badge */}
      <div className="mx-5 rounded-2xl bg-card border border-border/60 px-4 py-3 flex items-center justify-between shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="text-xs text-muted-foreground">우리의 연결 기록</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-coral animate-pulse" />
          <span className="text-sm font-semibold text-coral">연결 132일째</span>
        </div>
      </div>

      {/* Today record */}
      <section className="mx-5 mt-5 rounded-2xl bg-card border border-border p-4 shadow-sm">
        <div className="text-sm font-semibold">오늘의 한 줄 기록</div>
        <p className="mt-1 text-[11px] text-muted-foreground">{state.partnerName}에게 전할 마음을 남겨보세요.</p>
        <textarea
          value={log}
          onChange={(e) => setLog(e.target.value)}
          placeholder="오늘 어땠어요? 한 줄이면 충분해요."
          className="mt-3 w-full min-h-[84px] rounded-xl bg-muted/50 p-3 text-sm outline-none resize-none focus:bg-muted"
        />
        <div className="mt-3 flex gap-2">
          <SmallBtn icon={<Camera size={14} />} label="사진" />
          <SmallBtn icon={<Mic size={14} />} label="음성" />
          <SmallBtn icon={<Eye size={14} />} label="꼭 봐줘" accent />
        </div>
      </section>

      {/* Emotion */}
      <section className="mx-5 mt-4 rounded-2xl bg-card border border-border p-4">
        <div className="text-sm font-semibold">지금 감정</div>
        <div className="mt-3 flex justify-between">
          {EMOTIONS.map((e) => (
            <button
              key={e}
              onClick={() => setEmotion(e)}
              className={`w-11 h-11 rounded-full text-xl flex items-center justify-center transition ${
                emotion === e ? "bg-coral/15 ring-2 ring-coral" : "bg-muted/50"
              }`}
            >{e}</button>
          ))}
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>에너지</span><span>{energy}%</span>
          </div>
          <input
            type="range" min={0} max={100} value={energy}
            onChange={(e) => setEnergy(Number(e.target.value))}
            className="mt-2 w-full accent-[color:var(--coral)]"
          />
        </div>
      </section>

      {/* Care */}
      <section className="mx-5 mt-4 rounded-2xl bg-lilac p-4">
        <div className="text-sm font-semibold text-lilac-foreground">오늘 저녁, 어떤 배려가 필요해?</div>
        <p className="mt-1 text-[11px] text-lilac-foreground/70">하루에 한 번만 골라요. 17:50 전까지 바꿀 수 있어요.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {CARES.map((c) => {
            const active = care === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCare(c.key)}
                className={`rounded-xl px-2 py-3 text-xs font-medium flex flex-col items-center gap-1 transition ${
                  active ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10" : "bg-card/50 text-lilac-foreground/80"
                }`}
              >
                <span className="text-lg">{c.emoji}</span>
                {c.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setCare("none")}
          className={`mt-3 w-full text-[11px] ${care === "none" ? "text-foreground font-semibold" : "text-lilac-foreground/70"}`}
        >오늘은 선택하지 않을래</button>
      </section>

      {/* Submit */}
      <div className="mx-5 mt-5">
        <button
          onClick={save}
          className="w-full h-12 rounded-2xl bg-coral text-coral-foreground text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Heart size={16} /> 오늘의 마음 남기기
        </button>
      </div>
    </div>
  );
}

function SmallBtn({ icon, label, accent }: { icon: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <button className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border ${
      accent ? "bg-coral/10 border-coral/30 text-coral" : "bg-muted/60 border-border text-muted-foreground"
    }`}>{icon}{label}</button>
  );
}
