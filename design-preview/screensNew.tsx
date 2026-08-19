import { useState } from 'react';
import { AppBar, Card, TabBar } from './ui';
import { EmotionCharacter } from '@/components/emotion/EmotionCharacter';
import { CycleDayMarker, CycleLegend } from '@/components/cycle/CycleDayMarker';
import { BASIC_EMOTION_LABEL, BASIC_EMOTION_ORDER, type BasicEmotion } from '@/lib/basicEmotions';
import { cycleDayMarkLabels, type CycleDayMark } from '@/components/cycle/cycleFormatting';

type Props = { state: unknown; compact: boolean };

/**
 * The two 2026-08-20 additions, rendered from the PRODUCTION components.
 *
 * Not a mock. `EmotionCharacter`, `CycleDayMarker` and `CycleLegend` are imported
 * through the `@` alias, so what the capture pipeline photographs is what the app
 * paints -- including the token values, which is the point: the emotion accents and
 * the 한글 tracking curve are only judgeable against a real render in both themes.
 */
export function NewComponents({ compact }: Props) {
  const [selected, setSelected] = useState<BasicEmotion>('happiness');
  const marks: CycleDayMark[] = ['period', 'period_predicted', 'fertile', 'ovulation'];

  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="기록 속 마음 · 주기 표시" right={compact ? '320' : ''} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Card title="기록 속 마음">
          <div className="px-4 pb-3 space-y-2">
            <p className="text-caption text-muted-foreground">다르면 눌러서 바꿀 수 있어요.</p>
            <ul className="grid grid-cols-6 gap-1">
              {BASIC_EMOTION_ORDER.map((basic) => {
                const on = basic === selected;
                return (
                  <li key={basic}>
                    <button
                      type="button"
                      onClick={() => setSelected(basic)}
                      aria-pressed={on}
                      className={`press-response w-full min-h-11 py-1.5 rounded-control flex flex-col items-center justify-center gap-0.5 border ${
                        on ? 'border-transparent' : 'border-border bg-card'
                      }`}
                      style={on ? { backgroundColor: `var(--emotion-${basic}-surface)` } : undefined}
                    >
                      <EmotionCharacter emotion={basic} selected={on} size={32} />
                      <span className={`text-caption leading-none ${on ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                        {BASIC_EMOTION_LABEL[basic]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <Card title="감정 캐릭터 — 선택 / 비선택">
          <div className="px-4 pb-3 grid grid-cols-6 gap-2">
            {BASIC_EMOTION_ORDER.map((basic) => (
              <div key={basic} className="flex flex-col items-center gap-1">
                <EmotionCharacter emotion={basic} selected size={40} />
                <EmotionCharacter emotion={basic} size={40} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="주기 표시 — 기록은 채움, 예상은 테두리">
          <div className="px-4 pb-3 space-y-3">
            <div className="grid grid-cols-7 gap-0.5 text-center text-label">
              {Array.from({ length: 14 }).map((_, i) => {
                const mark = i === 3 ? 'period' : i === 4 ? 'period_predicted' : i === 8 ? 'fertile' : i === 9 ? 'ovulation' : null;
                return (
                  <div key={i} className="press-response min-h-11 rounded-control border border-transparent flex flex-col items-center justify-center gap-0.5">
                    <span>{i + 1}</span>
                    <span className="flex items-center justify-center gap-0.5 h-3">
                      {mark && <CycleDayMarker mark={mark} />}
                    </span>
                  </div>
                );
              })}
            </div>
            <ul className="space-y-1">
              {marks.map((mark) => (
                <li key={mark} className="flex items-center gap-2 text-caption text-foreground">
                  <CycleDayMarker mark={mark} size={14} />
                  {cycleDayMarkLabels[mark]}
                </li>
              ))}
            </ul>
            <CycleLegend />
          </div>
        </Card>

        <Card title="타이포그래피 — 한글 tracking 곡선">
          <div className="px-4 pb-3 space-y-1">
            <p className="text-display text-foreground">오늘의 기록</p>
            <p className="text-title text-foreground">상대방의 오늘</p>
            <p className="text-heading text-foreground">이야기거리 여섯 개</p>
            <p className="text-body text-foreground">본문은 tracking 0으로 둡니다. 한글 본문은 자간을 좁히면 읽기 어려워져요.</p>
            <p className="text-caption text-muted-foreground">캡션은 살짝 넓혀요 — ㅁ과 ㅇ이 붙지 않도록.</p>
          </div>
        </Card>
      </div>
      <TabBar active="기록" />
    </div>
  );
}
