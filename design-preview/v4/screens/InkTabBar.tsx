import { Home, Search, PlusSquare, CalendarDays } from 'lucide-react';
import { InkCircle, PenFace } from './common';

/**
 * 하단 탭바 — 인스타그램의 5칸 그대로.
 *
 *     인스타      홈    검색    만들기(+)   릴스     프로필
 *     곰신로그    홈    찾기    남기기      일정     우리
 *
 * 자리와 개수가 같아야 손이 기억한다. 인스타를 쓰는 사람은 왼쪽 끝이 홈이고 가운데가
 * 만들기이며 오른쪽 끝이 자기 프로필이라는 것을 몸으로 안다. 그 기억을 그대로 쓰는 것이
 * 이 앱이 인스타 문법을 빌리는 이유다.
 *
 * 릴스 자리에 일정이 오는 것은 성격이 맞아서다. 다른 넷은 전부 과거와 현재인데 -- 기록·
 * 탐색·작성·축적 -- 일정만 미래다. 인스타에서도 그 칸은 "다른 종류의 것"을 보는 자리다.
 *
 * 가운데 `+`는 인스타와 달리 테두리가 있는 사각형이다. 인스타의 만들기 버튼도 그렇고,
 * 무엇보다 이 앱에서 **기록 진입점은 제거할 수 없는 계약**(§7.1)이라 눈에 띄어야 한다.
 */

export type Tab = 'home' | 'search' | 'create' | 'plan' | 'us';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: '홈' },
  { id: 'search', label: '찾기' },
  { id: 'create', label: '남기기' },
  { id: 'plan', label: '일정' },
  { id: 'us', label: '우리' },
];

export function InkTabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav
      aria-label="주요 메뉴"
      className="sticky bottom-0 flex h-[52px] items-center"
      style={{
        borderTop: '1.5px solid var(--ink-faint)',
        // 괘선 위에 떠 있으면 글과 겹쳐 읽힌다. 탭바만 종이를 덮는다.
        background: 'var(--paper)',
      }}
    >
      {TABS.map((tab) => {
        const on = tab.id === active;
        const color = on ? 'var(--ink)' : 'var(--ink-soft)';
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            aria-current={on ? 'page' : undefined}
            onClick={() => onChange(tab.id)}
            className="tap flex h-full flex-1 items-center justify-center"
          >
            {tab.id === 'home' ? (
              <Home size={23} className="pen-icon" color={color} fill={on ? color : 'none'} />
            ) : tab.id === 'search' ? (
              <Search size={23} className="pen-icon" color={color} />
            ) : tab.id === 'create' ? (
              <PlusSquare size={24} className="pen-icon" color={color} />
            ) : tab.id === 'plan' ? (
              <CalendarDays size={22} className="pen-icon" color={color} />
            ) : (
              /* 인스타의 프로필 탭은 자기 아바타다. 여기서는 커플 아바타. */
              <InkCircle size={26} ring={on ? 'seen' : 'none'}>
                <PenFace size={18} />
              </InkCircle>
            )}
          </button>
        );
      })}
    </nav>
  );
}
