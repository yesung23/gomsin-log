import { Lock, Menu, ChevronLeft, Grid3x3, Image as ImageIcon, Plane } from 'lucide-react';
import { InkCircle, PenFace } from './common';

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
 *   게시물 → 함께한 날      팔로워 → 만남까지      팔로잉 → 전역까지
 *   프로필 편집 → 우리 소개 편집                   프로필 공유 → 기억 만들기
 *   하이라이트 → 마일스톤 (**맨 뒤에 아직 오지 않은 것 하나**)
 *   격자 → 하루 격자 (사진 단위가 아니라 하루 단위)
 *
 * 인스타는 클수록 좋은 숫자만 있다. 여기는 첫 칸이 쌓이고 나머지 둘은 줄어든다 --
 * 두 방향이 한 줄에 공존하는 것이 떨어져 있는 두 사람의 시간 감각이다.
 */

const STATS = [
  { value: '412', label: '함께한 날' },
  { value: 'D-12', label: '만남까지' },
  { value: '101', label: '전역까지' },
];

const HIGHLIGHTS = [
  { label: '100일', when: '4/10', reached: true },
  { label: '첫 면회', when: '4/24', reached: true },
  { label: '첫 휴가', when: '6/23', reached: true },
  { label: '1주년', when: '8/26', reached: true },
  { label: '전역', when: 'D-101', reached: false },
];

/** 하루 격자. 한 달은 언제나 28~31칸이라 구멍이 나지 않는다. */
const DAYS = Array.from({ length: 31 }, (_, i) => i);

export function InstaProfile() {
  return (
    <div className="notebook min-h-full pb-8">
      <header className="flex h-14 items-center gap-2 px-4">
        <ChevronLeft size={22} className="pen-icon" color="var(--ink)" />
        <span className="print text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>춘향 ♥ 몽룡</span>
        {/* 인스타의 비공개 계정 자물쇠 자리. 자랑이 아니라 고지다. */}
        <Lock size={13} className="pen-icon" color="var(--ink-soft)" />
        <span className="flex-1" />
        <button type="button" aria-label="설정" className="tap flex h-11 w-11 items-center justify-center">
          <Menu size={22} className="pen-icon" color="var(--ink)" />
        </button>
      </header>

      {/* 아바타 + 3통계 — 인스타와 같은 배치 */}
      <div className="flex items-center gap-6 px-4 pt-1">
        <InkCircle size={82} ring="seen"><PenFace size={56} /></InkCircle>
        <div className="flex flex-1 items-stretch">
          {STATS.map((stat) => (
            <button key={stat.label} type="button" className="tap flex flex-1 flex-col items-center gap-0.5">
              {/* 셋 다 같은 크기·같은 색. 줄어드는 숫자에 경고색을 쓰지 않는다. */}
              <span className="print text-[17px] font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                {stat.value}
              </span>
              <span className="print text-[11px]" style={{ color: 'var(--ink-soft)' }}>{stat.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-3">
        <p className="print text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>춘향 · 몽룡</p>
        <p className="hand text-[15px]" style={{ color: 'var(--ink)' }}>같은 하늘 아래, 조금 떨어져서</p>
      </div>

      {/* 인스타의 프로필 편집 / 공유 자리 */}
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" className="tap ink-chip flex-1 py-2">
          <span className="print text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>우리 소개 편집</span>
        </button>
        <button type="button" className="tap ink-chip flex-1 py-2">
          <span className="print text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>기억 만들기</span>
        </button>
      </div>

      {/* 하이라이트 — 인스타는 과거만 담는다. 맨 뒤 하나가 아직 오지 않은 것이다. */}
      <div className="flex gap-4 overflow-x-auto px-4 pt-5 pb-1">
        {HIGHLIGHTS.map((item) => (
          <button key={item.label} type="button" disabled={!item.reached}
            className="tap flex w-[66px] shrink-0 flex-col items-center gap-1.5 disabled:opacity-45">
            <InkCircle size={60} ring={item.reached ? 'seen' : 'none'}>
              <span className="print text-[10px]" style={{ color: 'var(--ink-soft)' }}>{item.when}</span>
            </InkCircle>
            <span className="print text-[11px]" style={{ color: 'var(--ink)' }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* 탭 줄 — 인스타의 격자/릴스/태그됨 자리 */}
      <div className="mt-4 flex" style={{ borderTop: 'var(--stroke) solid var(--ink-faint)' }}>
        {[
          { Icon: Grid3x3, label: '하루', on: true },
          { Icon: ImageIcon, label: '사진', on: false },
          { Icon: Plane, label: '여행', on: false },
        ].map(({ Icon, label, on }) => (
          <button key={label} type="button" aria-label={label}
            className="tap flex flex-1 items-center justify-center py-3"
            style={on ? { borderBottom: 'var(--stroke-bold) solid var(--ink)' } : undefined}>
            <Icon size={20} className="pen-icon" color={on ? 'var(--ink)' : 'var(--ink-soft)'} />
          </button>
        ))}
      </div>

      <p className="print px-4 pt-4 text-[12px]" style={{ color: 'var(--ink-soft)' }}>
        2026년 8월 · 기록 42 · 사진 18
      </p>

      {/*
        3열 격자 — 인스타 프로필과 같다. 단위만 사진이 아니라 **하루**다.

        사진 단위면 사진을 잘 안 올리는 커플에게 구멍 난 격자가 된다. 하루 단위면
        한 달이 언제나 28~31칸이라 비지 않는다.
      */}
      <div className="mt-2 grid grid-cols-3 gap-[3px] px-1">
        {DAYS.map((day) => {
          const kind = day % 7 === 3 ? 'star' : day % 3 === 0 ? 'photo' : day % 3 === 1 ? 'dot' : 'quiet';
          return (
            <button key={day} type="button"
              className="tap flex items-center justify-center"
              style={{
                aspectRatio: '1 / 1',
                border: 'var(--stroke-thin) solid var(--ink-faint)',
                borderRadius: day % 2 ? '6px 2px 8px 2px / 2px 8px 2px 6px' : '2px 8px 2px 6px / 8px 2px 6px 2px',
              }}>
              <span className="print text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                {kind === 'star' ? '★' : kind === 'photo' ? '▣' : kind === 'dot' ? '·' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
