import { useEffect, useState } from 'react';
import './paper.css';
import { DeviceReadout } from './DeviceReadout';
import { InstaHome } from './screens/InstaHome';
import { InstaStory } from './screens/InstaStory';
import { InstaProfile } from './screens/InstaProfile';
import { InstaSearch } from './screens/InstaSearch';
import { InstaPlan } from './screens/InstaPlan';
import { InkTabBar, type Tab } from './screens/InkTabBar';
import { InstaCompose } from './screens/InstaCompose';
import { InstaSaved } from './screens/InstaSaved';
import { InstaCall } from './screens/InstaCall';

/**
 * GOMSINLOG V4 Preview Shell — Tailscale 모바일 검증용.
 *
 * ## 무엇을 세우는 셸인가
 *
 * **레이아웃·위치·제스처는 인스타그램 그대로**이고, 바뀌는 것은 그것이 무엇 위에
 * 그려졌는가뿐이다 -- 유리와 빛 대신 공책과 펜. 기존 곰신로그의 카드 문법(코랄 레일,
 * 위젯 스택, 웜 크림)은 여기서 쓰지 않는다.
 *
 * ## 무엇을 확인하는 도구인가
 *
 * 계획서가 `UNVERIFIED`로 남긴 두 가지는 데스크톱에서 답이 나오지 않는다 -- 첫 화면
 * 손글씨 전송량과 5줄 본문의 가독성. 화면 크기도 픽셀 밀도도 눈과의 거리도 다르기
 * 때문이다. 상단 패널이 그 둘을 숫자로 뽑는다.
 *
 * ## 프로덕션에 닿을 수 없다
 *
 * `design-preview/vite.config.ts`는 루트 `vite.config.ts`와 별개이고 `npm run build`가
 * 이 파일을 보지 않는다. Supabase 클라이언트도 store도 없고 전부 정적 픽스처다.
 *
 * ## 기기에서 여는 법
 *
 *     npm run preview:v4
 *     # 폰에서: http://<머신이름>.<tailnet>.ts.net:5199/v4.html
 */

/*
  화면은 두 축으로 나뉜다.

  **탭**은 인스타의 하단 5칸이고 사용자가 실제로 오가는 길이다. **스토리**는 탭이 아니라
  레일에서 열리는 전체화면이라, 인스타가 그렇듯 열리면 탭바가 사라진다.

  상단의 Home/Story/Memory 스위치는 확인자를 위한 지름길이다 -- 실기기에서 레일을 눌러
  들어가는 대신 바로 그 화면으로 간다. 앱의 내비게이션이 아니라 도구다.
*/
type Surface = 'home' | 'story' | 'memory';

const SURFACES: { id: Surface; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'story', label: 'Story' },
  { id: 'memory', label: 'Memory' },
];

const SURFACE_TO_TAB: Record<Surface, Tab> = { home: 'home', story: 'home', memory: 'us' };

const DEVICE = { width: 390, height: 844 };

/*
  전체화면으로 덮이는 것들.

  인스타에서 스토리·만들기·DM 은 탭 위에 올라오지 탭을 바꾸지 않는다. 여기도 같다 --
  덮인 동안 탭바가 사라지고, 닫으면 있던 탭으로 돌아온다.
*/
type Overlay = null | 'story' | 'compose' | 'saved' | 'call';

export function V4Shell() {
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [scale, setScale] = useState(1.15);
  const [dark, setDark] = useState(false);
  const [chrome, setChrome] = useState(true);
  /*
    스토리 순간 수.

    진행 바가 칸 수에 따라 어떻게 되는지는 기기에서 눈으로 봐야 안다 -- 390px 에서
    12칸이면 칸 하나가 27px 이고 40칸이면 6px 이다. 픽스처를 늘렸다 줄였다 하는 대신
    여기서 바꾼다. 0 이면 픽스처 그대로.
  */
  const [momentCount, setMomentCount] = useState(0);

  /*
    배율을 실제 토큰에 쓴다.

    프리뷰용 사본을 만들지 않는다 -- 슬라이더가 움직이는 값이 앱이 쓰는 바로 그 변수여야
    기기에서 읽은 숫자를 그대로 `index.css`에 옮길 수 있다.
  */
  useEffect(() => {
    document.documentElement.style.setProperty('--font-hand-scale', String(scale));
  }, [scale]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="min-h-screen bg-neutral-200 p-3 dark:bg-neutral-950">
      {chrome ? (
        <div className="mx-auto mb-3 max-w-[430px] space-y-2">
          <div className="flex items-baseline justify-between">
            <h1 className="text-[14px] font-bold text-neutral-900 dark:text-neutral-50">
              GOMSINLOG V4 · 노트에 그린 인스타그램
            </h1>
            <button
              type="button"
              onClick={() => setChrome(false)}
              className="min-h-11 px-2 text-[11px] text-neutral-600 underline dark:text-neutral-300"
            >
              도구 숨기기
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            프로덕션이 아니다. 정적 픽스처이며 사용자 데이터를 읽거나 쓰지 않는다.
            레이아웃은 인스타그램 그대로이고 표면만 공책이다.
          </p>

          <div className="flex gap-1" role="tablist" aria-label="화면">
            {SURFACES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={(overlay === 'story' ? 'story' : tab === 'us' ? 'memory' : 'home') === item.id}
                onClick={() => {
                  setOverlay(item.id === 'story' ? 'story' : null);
                  setTab(SURFACE_TO_TAB[item.id]);
                }}
                className={`min-h-11 flex-1 rounded-md text-[13px] font-semibold ${
                  (overlay === 'story' ? 'story' : tab === 'us' ? 'memory' : 'home') === item.id
                    ? 'bg-neutral-900 text-neutral-50 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'bg-neutral-300 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDark((value) => !value)}
            aria-pressed={dark}
            className="min-h-11 w-full rounded-md bg-neutral-300 text-[12px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            {dark ? '밤의 공책' : '낮의 공책'}
          </button>

          <DeviceReadout scale={scale} onScaleChange={setScale} />

          <div className="rounded-md bg-neutral-900 p-3 text-neutral-100">
            <label className="block space-y-1">
              <span className="text-[12px] font-semibold">
                스토리 순간 수{' '}
                <span className="tabular-nums">{momentCount || '픽스처'}</span>
              </span>
              <input
                type="range" min={0} max={40} step={1}
                value={momentCount}
                onChange={(event) => setMomentCount(Number(event.target.value))}
                className="w-full"
                aria-label="스토리 순간 수"
              />
              <span className="block text-[11px] leading-relaxed text-neutral-400">
                진행 바가 몇 칸까지 읽히는지 본다. 12칸을 넘으면 창이 밀리고 양 끝에
                남은 수가 붙는다.
              </span>
            </label>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setChrome(true)}
          className="mx-auto mb-2 block min-h-11 px-3 text-[11px] text-neutral-600 underline dark:text-neutral-300"
        >
          도구 보이기
        </button>
      )}

      {/*
        실제 기기 크기.

        데스크톱에서는 390x844 프레임 안에서 잘린다 -- 앱에서 잘릴 것이 여기서도 잘려야
        긴 창이 결함을 구해 주지 않는다. 폰에서는 프레임이 화면보다 크므로 화면에 맞춘다.
      */}
      <div
        className="mx-auto overflow-hidden rounded-[26px] shadow-lg"
        style={{
          width: DEVICE.width,
          height: DEVICE.height,
          maxWidth: '100vw',
          maxHeight: chrome ? 'calc(100dvh - 24px)' : 'calc(100dvh - 60px)',
          border: '1.5px solid rgb(0 0 0 / 20%)',
        }}
      >
        {/*
          덮개가 있으면 탭바가 사라진다.

          인스타에서 스토리를 열면 하단 탭이 사라진다. 전체화면이 전체화면이어야 몰입이
          되고, 그 몰입이 이 앱에서는 "상대의 하루를 만나는 순간"이다. 만들기와 통화 모드도
          같은 이유로 덮는다 -- 쓰는 동안과 통화하는 동안은 다른 데로 갈 이유가 없다.
        */}
        {overlay ? (
          <div className="h-full w-full">
            {overlay === 'story' ? <InstaStory onClose={() => setOverlay(null)} momentCount={momentCount || undefined} />
              : overlay === 'compose' ? <InstaCompose onClose={() => setOverlay(null)} />
                : overlay === 'saved' ? (
                  <InstaSaved onClose={() => setOverlay(null)} onCall={() => setOverlay('call')} />
                ) : <InstaCall onClose={() => setOverlay(null)} />}
          </div>
        ) : (
          <div className="flex h-full w-full flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'home' ? (
                <InstaHome
                  onOpenStory={() => setOverlay('story')}
                  onOpenSaved={() => setOverlay('saved')}
                  onOpenCall={() => setOverlay('call')}
                  onCompose={() => setOverlay('compose')}
                />
              ) : tab === 'search' ? <InstaSearch />
                : tab === 'plan' ? <InstaPlan />
                  : <InstaProfile />}
            </div>
            <InkTabBar
              active={tab}
              onChange={(next) => {
                /*
                  `남기기`는 탭이 아니라 덮개다. 인스타의 만들기 버튼도 탭을 바꾸지 않고
                  시트를 올린다 -- 쓰다 말고 다른 탭으로 가는 일이 없어야 30초가 지켜진다.
                */
                if (next === 'create') setOverlay('compose');
                else setTab(next);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
