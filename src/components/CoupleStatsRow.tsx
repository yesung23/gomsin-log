import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { buildCoupleStats, type ThirdSlotChoice } from '@/lib/coupleStats';
import { effectiveDischargeDate } from '@/lib/milestones';
import { loadThirdSlot, saveThirdSlot } from '@/lib/thirdSlotPreference';
import type { CoupleEvent, MilitaryInfo } from '@/types';

/**
 * 커플 프로필의 통계 줄.
 *
 * 인스타 프로필의 `게시물 · 팔로워 · 팔로잉` 자리를 관계의 시간으로 바꾼다. 균등 3분할,
 * 위는 숫자 아래는 라벨, 전부 탭 가능 -- 세 성질은 그대로 가져오고 "클수록 좋다"만
 * 뒤집는다. 첫 칸은 쌓이고 나머지 둘은 줄어든다.
 *
 * ## 줄어드는 숫자에 색을 쓰지 않는다
 *
 * `D-1`이 빨간색이면 그건 정보가 아니라 카운트다운 압박이다. 세 숫자 전부 같은 잉크색,
 * 같은 크기, 같은 무게다. 이 앱은 불안을 만들지 않는다(§3 원칙 6).
 *
 * ## 자물쇠는 자랑이 아니라 고지다
 *
 * 인스타의 비공개 계정 자물쇠 자리를 쓰되, 누르면 **그 시점에 사실인 문장**만 보여준다.
 * §14.5의 단계별 표현 계약을 따르며, 지금 단계에서 "E2EE로 보호됩니다"라고 쓰면 거짓이다.
 */
export function CoupleStatsRow({
  userId,
  anniversaryDate,
  events,
  military,
  todayStr,
  onProtectionTap,
}: {
  userId: string;
  anniversaryDate?: string;
  events: CoupleEvent[];
  military?: MilitaryInfo;
  todayStr: string;
  onProtectionTap: () => void;
}) {
  const navigate = useNavigate();
  const hasMilitary = Boolean(military?.enlistmentDate && effectiveDischargeDate(military));
  const [thirdSlot, setThirdSlot] = useState<ThirdSlotChoice>(
    () => loadThirdSlot(userId, hasMilitary),
  );

  const stats = useMemo(
    () => buildCoupleStats({ anniversaryDate, events, military, todayStr, thirdSlot }),
    [anniversaryDate, events, military, todayStr, thirdSlot],
  );

  /** 세 번째 칸을 길게 누르지 않고, 두 번째 탭으로 돌린다. 숨은 제스처를 만들지 않는다. */
  const cycleThirdSlot = () => {
    const order: ThirdSlotChoice[] = ['discharge', 'anniversary', 'meetings'];
    const next = order[(order.indexOf(thirdSlot) + 1) % order.length];
    setThirdSlot(next);
    saveThirdSlot(userId, next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-stretch" data-testid="couple-stats">
        {stats.map((stat, index) => {
          const isThird = index === 2;
          const label = stat.hint ? `${stat.label} — ${stat.hint}` : stat.label;
          return (
            <button
              key={stat.label}
              type="button"
              onClick={() => {
                if (isThird) { cycleThirdSlot(); return; }
                if (stat.href) navigate(stat.href);
              }}
              aria-label={isThird ? `${label}. 눌러서 다른 항목으로 바꾸기` : label}
              className="press-response flex flex-1 flex-col items-center gap-0.5 rounded-control py-2"
            >
              {/* 셋 다 같은 색·같은 크기다. 줄어드는 숫자에 경고색을 쓰지 않는다. */}
              <span className="text-title text-foreground tabular-nums">{stat.value}</span>
              <span className="text-caption text-muted-foreground">{stat.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onProtectionTap}
        className="press-response mx-auto flex min-h-11 items-center justify-center gap-1.5 rounded-control px-3 text-caption text-muted-foreground"
      >
        <Lock size={12} aria-hidden="true" />
        둘만 봅니다
      </button>
    </div>
  );
}
