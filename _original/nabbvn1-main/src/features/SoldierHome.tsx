import { useMemo, useState } from "react";
import { Shuffle, Sparkles, Calendar, Utensils } from "lucide-react";
import { useStore, type CareKey } from "../lib/store";
import { CoupleAvatar } from "../components/CoupleAvatar";

const OPENERS = [
  "오늘 많이 힘들었다고 했는데, 어떤 일이 있었어?",
  "점심 약속 취소돼서 속상했겠다. 지금은 좀 괜찮아?",
  "친구랑 통화하고 마음이 가벼워졌다니 다행이야. 무슨 얘기 했어?",
];

const CARE_SUGGESTIONS: Record<CareKey, string> = {
  listen: "오늘 하루를 들어주는 것만으로도 큰 위로가 될 거예요.",
  empathy: "해결책보다 '많이 힘들었겠다'는 공감을 먼저 해주면 좋겠어요.",
  cheer: "작은 응원 한마디가 오늘의 힘이 될 거예요.",
  rest: "무리하지 않아도 괜찮다는 말로 여유를 주면 좋겠어요.",
  miss: "보고 싶다는 마음을 먼저 전해주면 따뜻할 거예요.",
  celebrate: "오늘의 소소한 일을 함께 기뻐해주면 좋겠어요.",
  none: "편안한 분위기로 통화를 시작해주세요.",
};

function daysLeft(dateStr: string) {
  const target = new Date(dateStr);
  const now = new Date();
  const diff = Math.ceil((target.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  return diff;
}

export function SoldierHome() {
  const { state } = useStore();
  const [openerIdx, setOpenerIdx] = useState(0);

  const briefing = useMemo(() => [
    state.dayLog || "오전 업무가 꼬여서 평소보다 많이 지쳤어요.",
    "점심 약속이 취소돼 조금 아쉬웠어요.",
    "친구와 통화한 뒤에는 마음이 조금 가벼워졌어요.",
  ], [state.dayLog]);

  const dDay = daysLeft(state.dischargeDate);
  const careSuggestion = CARE_SUGGESTIONS[state.care] ?? CARE_SUGGESTIONS.none;

  return (
    <div className="pb-6">
      <header className="px-5 pt-8 pb-1 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[26px] font-bold leading-tight">
            안녕, {state.myName}아 <span className="text-coral">♡</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{state.partnerName}이가 오늘 남긴 기록 3개가 있어요.</p>
        </div>
        <div className="shrink-0"><CoupleAvatar size={80} /></div>
      </header>

      <div className="mx-5 rounded-2xl bg-card border border-border/60 px-4 py-1.5 flex items-center justify-between shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="text-xs text-muted-foreground">우리의 연결 기록</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-coral animate-pulse" />
          <span className="text-sm font-semibold text-coral">연결 132일째</span>
        </div>
      </div>

      <div className="mx-5 mt-2 space-y-2">
        {/* Main briefing card */}
        <section className="rounded-2xl bg-card border border-border p-3 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-1.5">
            <span className="text-2xl">{state.emotion}</span>
            <div>
              <div className="text-[11px] text-muted-foreground">오늘의 마음</div>
              <div className="text-sm font-semibold">에너지가 조금 낮아요</div>
            </div>
          </div>

          <ol className="mt-2 space-y-1">
            {briefing.map((b, i) => (
              <li key={i} className="flex gap-3 text-sm leading-snug">
                <span className="w-5 h-5 shrink-0 rounded-full bg-coral/15 text-coral text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                <span>{b}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Care hint — most emphasized */}
        <section className="rounded-2xl bg-lilac p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-lilac-foreground/70">
            <Sparkles size={14} /> 오늘의 배려 힌트
          </div>
          <p className="mt-1 text-[16px] font-semibold text-lilac-foreground leading-tight">
            {careSuggestion}
          </p>
        </section>

        {/* Call opener */}
        <section className="rounded-2xl bg-mint p-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold text-mint-foreground/70">통화 첫마디</div>
            <button
              onClick={() => setOpenerIdx((i) => (i + 1) % OPENERS.length)}
              className="p-1 rounded-lg hover:bg-mint-foreground/10 transition"
              aria-label="다른 질문 보기"
            >
              <Shuffle size={14} className="text-mint-foreground/70" />
            </button>
          </div>
          <p className="mt-0.5 text-sm text-mint-foreground leading-snug">"{OPENERS[openerIdx]}"</p>
        </section>

        {/* Bottom info chips */}
        <div className="flex gap-2 pt-0.5">
          <div className="flex-1 rounded-xl bg-card border border-border/60 px-3 py-1.5 flex items-center justify-between gap-2 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
              <Calendar size={13} />전역까지
            </div>
            <span className="text-sm font-bold text-coral whitespace-nowrap">D-{dDay}</span>
          </div>
          <div className="flex-1 rounded-xl bg-card border border-border/60 px-3 py-1.5 flex items-center justify-between gap-2 shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
              <Utensils size={13} />오늘 저녁
            </div>
            <span className="text-sm font-semibold truncate text-right">돈까스 & 김치찌개</span>
          </div>
        </div>
      </div>
    </div>
  );
}
