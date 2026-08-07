import { useState } from 'react';
import { SCREENS, STATES, THEMES, VIEWPORTS } from './registry';
import type { ScreenState } from './fixtures';

/**
 * Design preview harness.
 *
 * Every frame is a real element at real phone dimensions with `overflow: hidden`,
 * so anything that would be clipped or scroll sideways in the app is clipped here
 * too rather than being rescued by a tall desktop window.
 *
 * The screen/state/viewport tables live in `registry.ts`: a module exporting both
 * components and other values trips `react-refresh/only-export-components`, and
 * `npm run lint` runs with `--max-warnings 0`.
 */

const ON = 'bg-neutral-900 text-neutral-50 dark:bg-neutral-100 dark:text-neutral-900';
const OFF = 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100';

export function PreviewApp() {
  const [screenId, setScreenId] = useState(SCREENS[0].id);
  const [state, setState] = useState<ScreenState>('normal');
  const screen = SCREENS.find((s) => s.id === screenId) ?? SCREENS[0];
  const Screen = screen.C;

  return (
    <div className="harness min-h-screen p-5 font-sans">
      <header className="mb-3">
        <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
          곰신로그 디자인 프리뷰
        </h1>
        <p className="text-[12px] text-neutral-600 dark:text-neutral-300">
          프로덕션 라우트에 연결되지 않은 독립 시안입니다. 정적 픽스처만 사용하며 사용자 데이터를
          읽거나 쓰지 않습니다.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            type="button"
            data-screen-btn={s.id}
            aria-pressed={s.id === screenId}
            onClick={() => setScreenId(s.id)}
            className={`min-h-11 rounded-md px-2.5 text-[12px] font-medium ${
              s.id === screenId ? ON : OFF
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-1">
        {STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            data-state-btn={s.id}
            aria-pressed={state === s.id}
            onClick={() => setState(s.id)}
            className={`min-h-11 rounded-md px-3 text-[13px] font-medium ${
              state === s.id ? ON : OFF
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {VIEWPORTS.map((v) =>
          THEMES.map((t) => (
            <figure key={`${v.name}-${t}`} className="m-0 flex flex-col gap-1.5">
              <figcaption className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                {screen.label} · {v.name} · {t === 'light' ? '라이트' : '다크'}
              </figcaption>
              <div
                data-theme={t}
                data-frame={`${screen.id}|${state}|${t}|${v.width}`}
                className="overflow-hidden rounded-xl ring-1 ring-black/15"
                style={{ width: v.width, height: v.height }}
              >
                <Screen state={state} compact={v.compact} />
              </div>
            </figure>
          )),
        )}
      </div>
    </div>
  );
}
