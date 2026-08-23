import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid3x3, Image as ImageIcon, Lock, Menu, Plane, Search, SquarePen } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { buildCoupleStats, togetherDays } from '@/lib/coupleStats';
import { buildHighlights } from '@/lib/coupleHighlights';
import { loadThirdSlot } from '@/lib/thirdSlotPreference';
import { buildMonthTexture, monthsWithContent } from '@/features/us/monthTexture';
import { MonthGrid } from '@/features/us/MonthGrid';
import { InkCircle, PenFace } from '@/components/paper';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { localToday } from '@/lib/cycle';

/**
 * 우리 — 인스타 프로필과 같은 구조.
 *
 *     ← 이름 🔒                    ☰
 *     아바타   N     N     N
 *            게시물 팔로워 팔로잉
 *     이름 / 소개
 *     [프로필 편집] [프로필 공유]
 *     ( ) ( ) ( ) 하이라이트
 *     ▦  ▶  👤  탭 줄
 *     3열 격자
 *
 * 자리는 그대로 두고 뜻만 바꾼다.
 *
 *     게시물 → 함께한 날      팔로워 → 만남까지      팔로잉 → 전역까지
 *     프로필 편집 → 우리 소개 편집                   프로필 공유 → 기억 만들기
 *     하이라이트 → 마일스톤 (**맨 뒤에 아직 오지 않은 것 하나**)
 *     격자 → 하루 격자 (사진 단위가 아니라 하루 단위)
 *
 * 인스타는 클수록 좋은 숫자만 있다. 여기는 첫 칸이 쌓이고 나머지 둘은 줄어든다 -- 두
 * 방향이 한 줄에 공존하는 것이 떨어져 있는 두 사람의 시간 감각이다. 셋 다 같은 크기·같은
 * 색이며, **줄어드는 숫자에 경고색을 쓰지 않는다.**
 *
 * ## 팔로워가 아니라 기다림이다
 *
 * §16 -- 팔로우·팔로워·팔로잉·친구 추천은 비목표다. 자리를 빌렸을 뿐 개념을 빌리지
 * 않았다. 여기 세 숫자는 전부 **두 사람 사이의 시간**이고 다른 사람이 등장하지 않는다.
 *
 * ## 군 복무 커플이 아닐 때
 *
 * §11 -- 군 관련 표면은 끄는 것이 아니라 **없다.** `buildCoupleStats` 와
 * `buildHighlights` 가 이미 그렇게 동작한다: 군 정보가 없으면 조용히 기념일로 바뀌고
 * 전역 하이라이트를 만들지 않는다. 이 화면은 그 동작을 따라갈 뿐 다시 판단하지 않는다.
 */

type GridTab = 'day' | 'photo' | 'trip';

export function PaperProfile() {
  const navigate = useNavigate();
  const { state } = useStore();
  const { profile } = state;
  const todayStr = localToday();
  const [tab, setTab] = useState<GridTab>('day');

  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: profile.id,
      role: profile.role,
    }),
    [state.records, profile.id, profile.role],
  );

  const hasMilitary = Boolean(profile.military?.expectedDischargeDate);
  const stats = useMemo(
    () => buildCoupleStats({
      anniversaryDate: profile.couple.anniversaryDate,
      events: state.events,
      military: profile.military,
      todayStr,
      thirdSlot: loadThirdSlot(profile.id || '', hasMilitary),
    }),
    [profile.couple.anniversaryDate, profile.military, profile.id, state.events, todayStr, hasMilitary],
  );

  const highlights = useMemo(
    () => buildHighlights({
      anniversaryDate: profile.couple.anniversaryDate,
      events: state.events,
      military: profile.military,
      todayStr,
    }),
    [profile.couple.anniversaryDate, profile.military, state.events, todayStr],
  );

  /*
    그려지는 달은 셋으로 시작한다.

    폰이 접히는 선까지 보이는 양이 그 정도이고, 두 해 된 관계는 그렇지 않으면 스무 칸을
    보려고 칠백 칸을 mount 한다. `UsPage` 가 같은 이유로 같은 수를 쓴다.
  */
  const [visibleMonthCount, setVisibleMonthCount] = useState(3);
  const monthList = useMemo(
    () => monthsWithContent({
      records,
      events: state.events,
      trips: state.trips,
      today: todayStr,
      anniversary: profile.couple.anniversaryDate,
    }),
    [records, state.events, state.trips, todayStr, profile.couple.anniversaryDate],
  );
  const months = useMemo(
    () => monthList.slice(0, visibleMonthCount).map((m) => buildMonthTexture({
      year: m.year,
      month: m.month,
      records,
      events: state.events,
      trips: state.trips,
      today: todayStr,
      anniversary: profile.couple.anniversaryDate,
    })),
    [monthList, visibleMonthCount, records, state.events, state.trips, todayStr, profile.couple.anniversaryDate],
  );
  const together = togetherDays(profile.couple.anniversaryDate, todayStr);

  const names = [profile.myName, profile.couple.partnerName].filter(Boolean);
  const title = names.length === 2 ? `${names[0]} ♥ ${names[1]}` : names[0] || '우리';

  return (
    <div className="min-h-full pb-8">
      <header
        className="flex h-14 items-center gap-2 px-4"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <span className="truncate text-body font-semibold" style={{ color: 'var(--ink)' }}>{title}</span>
        {/* 인스타의 비공개 계정 자물쇠 자리. 자랑이 아니라 고지다 -- 둘만 본다는 사실. */}
        <Lock size={13} className="pen-icon" color="var(--ink-soft)" aria-label="둘만 볼 수 있어요" />
        <span className="flex-1" />
        {/*
          §7.1 의 제거 불가 진입점. `우리` 가 기록을 보고 찾는 곳을 전부 가지므로 남기는
          곳도 여기여야 한다. 조건 없이 그린다 -- 이 버튼이 사라지는 상태는 없다.
        */}
        <button
          type="button"
          aria-label="기록 남기기"
          onClick={() => navigate('/compose')}
          className="flex h-11 w-11 items-center justify-center"
        >
          <SquarePen size={20} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="기록 찾기"
          onClick={() => navigate('/search')}
          className="flex h-11 w-11 items-center justify-center"
        >
          <Search size={21} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
        {/* 인스타의 ☰ 안에 설정이 있다. `마이` 가 탭을 잃고 여기로 들어왔다(§5.6). */}
        <button
          type="button"
          aria-label="설정"
          onClick={() => navigate('/my')}
          className="flex h-11 w-11 items-center justify-center"
        >
          <Menu size={22} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
      </header>

      {/*
        커플 lifecycle 안내.

        연결된 커플에게는 아무것도 그리지 않는다. 초대를 기다리는 사람에게는 **여기가
        그 코드를 보는 곳**이어야 한다 -- 프로필이 관계의 화면이므로 관계의 상태도 여기
        있어야 하고, 설정 안으로 숨기면 초대한 사람이 코드를 다시 찾지 못한다.
      */}
      <div className="px-4">
        <CoupleStatusBanner />
      </div>

      <div className="flex items-center gap-6 px-4 pt-1">
        <InkCircle size={82} ring="seen"><PenFace size={56} /></InkCircle>
        <div className="flex flex-1 items-stretch">
          {stats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              disabled={!stat.href}
              onClick={() => stat.href && navigate(stat.href)}
              className="flex flex-1 flex-col items-center gap-0.5 disabled:cursor-default"
            >
              <span className="text-heading font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                {stat.value}
              </span>
              <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>{stat.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-3">
        <p className="text-label font-semibold" style={{ color: 'var(--ink)' }}>
          {names.join(' · ') || '우리'}
        </p>
        {/*
          기념일이 없으면 **없다고 말한다.**

          날짜를 지어내 세지 않는 것은 당연하고(M-1), 아무 말도 안 하는 것 역시 답이
          아니다 -- 통계 첫 칸이 `—` 인 이유를 사용자가 알 수 없다. 어디서 정하는지까지
          말해야 그 칸이 채워질 수 있다.
        */}
        {together !== null ? (
          <p className="hand-text text-body" style={{ color: 'var(--ink)' }}>
            {together}일째 같은 하늘 아래
          </p>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="text-label"
            style={{ color: 'var(--ink-soft)' }}
          >
            기념일 미설정 · 정하러 가기
          </button>
        )}
      </div>

      {/*
        인스타의 `프로필 편집` · `프로필 공유` 자리.

        탭 다섯이 인스타 배치로 돌아가면서 `나` 와 `일기장` 이 칸을 잃었다. 화면이 사라진
        것이 아니라 **자리를 옮긴 것**이므로 여기서 닿아야 한다 -- 프로필이 관계의 화면이고,
        내 상태(복무·주기·컨디션)와 쌓인 것을 묶는 일(일기장)이 둘 다 관계의 일이다.
      */}
      <div className="flex gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={() => navigate('/me')}
          className="ink-chip flex-1 py-2"
        >
          <span className="text-caption font-semibold" style={{ color: 'var(--ink)' }}>오늘 내 상태</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/diary')}
          className="ink-chip flex-1 py-2"
        >
          <span className="text-caption font-semibold" style={{ color: 'var(--ink)' }}>일기장</span>
        </button>
      </div>

      {/*
        하이라이트 — 인스타는 과거만 담는다. 여기는 **맨 뒤 하나가 아직 오지 않은 것**이다.

        기다림이 이 제품이므로 미래 하나는 언제나 남는다. 아직인 것은 흐리게 그리고 누를
        수 없다 -- 도착하지 않은 날의 스토리는 없기 때문이다.
      */}
      {highlights.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto px-4 pb-1 pt-5">
          {highlights.map((item) => (
            <button
              key={`${item.label}:${item.date}`}
              type="button"
              disabled={!item.reached}
              onClick={() => navigate(`/story/day/${item.date}`)}
              className="flex w-[66px] shrink-0 flex-col items-center gap-1.5 disabled:opacity-45"
            >
              <InkCircle size={60} ring={item.reached ? 'seen' : 'none'}>
                <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>
                  {item.countdown ?? `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`}
                </span>
              </InkCircle>
              <span className="max-w-[66px] truncate text-caption" style={{ color: 'var(--ink)' }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 탭 줄 — 인스타의 격자/릴스/태그됨 자리 */}
      <div className="mt-4 flex" style={{ borderTop: 'var(--stroke) solid var(--ink-faint)' }}>
        {([
          { id: 'day', Icon: Grid3x3, label: '하루' },
          { id: 'photo', Icon: ImageIcon, label: '사진' },
          { id: 'trip', Icon: Plane, label: '여행' },
        ] as const).map(({ id, Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={tab === id}
            onClick={() => (id === 'trip' ? navigate('/trips') : setTab(id))}
            className="flex flex-1 items-center justify-center py-3"
            style={tab === id ? { borderBottom: 'var(--stroke-bold) solid var(--ink)' } : undefined}
          >
            <Icon size={20} className="pen-icon" color={tab === id ? 'var(--ink)' : 'var(--ink-soft)'} aria-hidden="true" />
          </button>
        ))}
      </div>

      {months.length === 0 ? (
        <p className="px-8 pt-12 text-center text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          아직 쌓인 하루가 없어요.
          <br />
          오늘 있었던 일을 하나 남기면 여기부터 채워져요.
        </p>
      ) : (
        months.map((month) => (
          <section key={month.key} className="pt-4">
            <p className="px-4 pb-2 text-caption" style={{ color: 'var(--ink-soft)' }}>
              {month.year}년 {month.month}월 · 기록 {month.recordCount} · 사진 {month.photoCount}
            </p>
            <div className="px-1">
              <MonthGrid
                data={month}
                coupleId={profile.couple.coupleId}
                onOpenDay={(date) => navigate(`/story/day/${date}`)}
              />
            </div>
          </section>
        ))
      )}

      {monthList.length > visibleMonthCount ? (
        <button
          type="button"
          onClick={() => setVisibleMonthCount((count) => count + 3)}
          className="ink-chip mx-4 mt-6 block w-[calc(100%-2rem)] py-3"
        >
          <span className="text-label" style={{ color: 'var(--ink)' }}>더 보기</span>
        </button>
      ) : null}
    </div>
  );
}
