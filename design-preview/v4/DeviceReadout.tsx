import { useCallback, useEffect, useState } from 'react';

/**
 * 이 셸이 존재하는 이유 — 막혀 있는 두 숫자를 실기기에서 뽑는다.
 *
 * 계획서는 손글씨에 대해 두 가지를 `UNVERIFIED`로 남겼다. 하나는 첫 화면이 실제로
 * 내려받는 폰트 양(시뮬레이션 81–105 kB, 예산 150 kB)이고, 다른 하나는 5줄 본문의
 * 가독성에서 정해질 `--font-hand-scale`(잠정 1.15)이다. 둘 다 데스크톱에서는 답이
 * 나오지 않는다 -- 화면 크기도, 픽셀 밀도도, 눈과의 거리도 다르다.
 *
 * 그래서 이 패널은 눈대중을 숫자로 바꾼다.
 */

interface FontLoad {
  slices: number;
  bytes: number;
}

/**
 * 실제로 내려온 손글씨 슬라이스만 센다.
 *
 * `encodedBodySize`를 쓴다. `transferSize`는 캐시에서 온 응답에서 0이 되어, 두 번째
 * 방문에 "0 kB"라는 거짓 합격을 만든다. 측정은 새로고침 직후에 하고, 정확히 재려면
 * 기기에서 캐시를 비우고 한 번 더 본다.
 */
function measureFonts(): FontLoad {
  if (typeof performance === 'undefined') return { slices: 0, bytes: 0 };
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const hand = entries.filter((entry) => /hand-\d+[^/]*\.woff2/.test(entry.name));
  return {
    slices: hand.length,
    bytes: hand.reduce((total, entry) => total + (entry.encodedBodySize || 0), 0),
  };
}

const BUDGET_BYTES = 150 * 1024;

export function DeviceReadout({
  scale,
  onScaleChange,
}: {
  scale: number;
  onScaleChange: (next: number) => void;
}) {
  const [fonts, setFonts] = useState<FontLoad>({ slices: 0, bytes: 0 });

  const refresh = useCallback(() => setFonts(measureFonts()), []);

  useEffect(() => {
    refresh();
    /*
      슬라이스는 글자가 그려질 때 늦게 도착한다. 한 번만 재면 0이 나오므로 잠깐 동안
      다시 잰다. 폴링을 영원히 돌리지 않는 이유는 이것이 측정 도구이지 감시 도구가
      아니기 때문이다.
    */
    const timers = [400, 1200, 2500].map((delay) => window.setTimeout(refresh, delay));
    return () => timers.forEach(window.clearTimeout);
  }, [refresh]);

  const kb = Math.round((fonts.bytes / 1024) * 10) / 10;
  const withinBudget = fonts.bytes > 0 && fonts.bytes <= BUDGET_BYTES;

  return (
    <div className="space-y-2 rounded-md bg-neutral-900 p-3 text-neutral-100">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold">첫 화면 손글씨 전송량</span>
        <button
          type="button"
          onClick={refresh}
          className="min-h-11 rounded px-2 text-[11px] text-neutral-300 underline"
        >
          다시 재기
        </button>
      </div>

      <p className="text-[20px] font-bold tabular-nums">
        {fonts.bytes === 0 ? '측정 중…' : `${kb} kB`}
        <span className="ml-2 text-[12px] font-normal text-neutral-400">
          슬라이스 {fonts.slices}개 · 예산 150 kB
        </span>
      </p>

      {fonts.bytes > 0 ? (
        <p className={`text-[12px] ${withinBudget ? 'text-emerald-400' : 'text-amber-400'}`}>
          {withinBudget ? '예산 안' : '예산 초과 — 적용 범위를 줄여야 한다'}
        </p>
      ) : null}

      <p className="text-[11px] leading-relaxed text-neutral-400">
        캐시에서 온 응답은 크기가 0으로 잡힌다. 정확히 재려면 기기에서 캐시를 비우고
        새로고침한 뒤 이 숫자를 읽는다.
      </p>

      <hr className="border-neutral-700" />

      <label className="block space-y-1">
        <span className="text-[12px] font-semibold">
          손글씨 배율 <span className="tabular-nums">{scale.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={1}
          max={1.4}
          step={0.01}
          value={scale}
          onChange={(event) => onScaleChange(Number(event.target.value))}
          className="w-full"
          aria-label="손글씨 배율"
        />
        <span className="block text-[11px] leading-relaxed text-neutral-400">
          아래 다섯 줄짜리 기록이 편하게 읽히는 값을 찾는다. 그 값이
          <code className="mx-1 rounded bg-neutral-800 px-1">--font-hand-scale</code>
          이 된다.
        </span>
      </label>
    </div>
  );
}
