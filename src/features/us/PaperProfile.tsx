import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Grid3x3, Image as ImageIcon, Lock, Menu, Plane, Search, SquarePen, X } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { buildCoupleStats, togetherDays } from '@/lib/coupleStats';
import { buildHighlights } from '@/lib/coupleHighlights';
import { loadThirdSlot } from '@/lib/thirdSlotPreference';
import { PostGrid } from '@/features/us/PostGrid';
import { getPhotoAttachments, isTravelRecord } from '@/features/us/postTiles';
import { TRIP_PHASE_ORDER, TRIP_PHASE_PILL, groupTripsByPhase, type TripPhase } from '@/lib/tripPhase';
import { formatLocalDate } from '@/lib/utils';
import { recordAuthorPresentation } from '@/lib/recordAuthor';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import { cn } from '@/lib/utils';
import { InkCircle, PenFace } from '@/components/paper';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { localToday } from '@/lib/cycle';
import type { DailyRecord, Role, Trip } from '@/types';

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
 *     게시물 격자 → 여행 중 남긴 사진 게시물
 *     사진 탭 → 기존 기록 목록
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

type GridTab = 'post' | 'photo' | 'trip';

export function PaperProfile() {
  const navigate = useNavigate();
  const { state } = useStore();
  const { profile } = state;
  const todayStr = localToday();
  const [tab, setTab] = useState<GridTab>('post');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: profile.id,
      role: profile.role,
    }),
    [state.records, profile.id, profile.role],
  );

  const travelRecords = useMemo(
    () => records.filter((record) => isTravelRecord(record, state.trips, state.events)),
    [records, state.trips, state.events],
  );

  const selectedPost = useMemo(
    () => (selectedPostId ? travelRecords.find((record) => record.id === selectedPostId) ?? null : null),
    [selectedPostId, travelRecords],
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
              /*
                두 줄짜리 통계라 자연 높이가 42px 로 떨어진다 -- 44 에서 2px 모자란다.
                눌리는 칸이므로 `min-h-11` 로 바닥을 깐다(DESIGN_V2 §44px).
              */
              className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 disabled:cursor-default"
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
          className="ink-chip flex min-h-11 flex-1 items-center justify-center"
        >
          <span className="text-caption font-semibold" style={{ color: 'var(--ink)' }}>오늘 내 상태</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/diary')}
          className="ink-chip flex min-h-11 flex-1 items-center justify-center"
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
          { id: 'post', Icon: Grid3x3, label: '게시물' },
          { id: 'photo', Icon: ImageIcon, label: '사진' },
          { id: 'trip', Icon: Plane, label: '여행' },
        ] as const).map(({ id, Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className="profile-tab flex flex-1 items-center justify-center py-3"
            style={{
              borderBottom: `var(--stroke-bold) solid ${tab === id ? 'var(--ink)' : 'transparent'}`,
            }}
          >
            <Icon size={20} className="pen-icon" color={tab === id ? 'var(--ink)' : 'var(--ink-soft)'} aria-hidden="true" />
          </button>
        ))}
      </div>

      {tab === 'photo' ? (
        <ProfileRecordList
          records={records}
          coupleId={profile.couple.coupleId}
          viewer={{ userId: profile.id, role: profile.role }}
          partnerName={profile.couple.partnerName || '상대방'}
          onOpenRecord={(recordId) => navigate(`/record?record=${encodeURIComponent(recordId)}`)}
          onOpenDate={(date) => navigate(`/record?date=${encodeURIComponent(date)}`)}
          onOpenTimeline={() => navigate('/record')}
        />
      ) : tab === 'trip' ? (
        <ProfileTripList
          trips={state.trips}
          todayStr={todayStr}
          onOpenTrip={(tripId) => navigate(`/trips/${encodeURIComponent(tripId)}`)}
          onOpenAll={() => navigate('/trips')}
        />
      ) : (
        /*
          게시물 격자 (2026-08-23).

          일반 기록을 전부 게시물처럼 보여주지 않는다. 여행과 연결된 날짜의 기록만
          게시물로 제한하고, 여행 연결은 `postTiles.ts` 의 날짜 기반 판별이 소유한다.
          현재 `DailyRecord` 에 여행 외래키가 없으므로 임의의 데이터 필드를 만들지 않는다.
        */
        <PostGrid
          records={travelRecords}
          coupleId={profile.couple.coupleId}
          onOpen={setSelectedPostId}
        />
      )}

      {selectedPost ? (
        <PhotoPostViewer
          record={selectedPost}
          coupleId={profile.couple.coupleId}
          viewer={{ userId: profile.id, role: profile.role }}
          partnerName={profile.couple.partnerName || '상대방'}
          onClose={() => setSelectedPostId(null)}
          onOpenRecord={(recordId) => {
            setSelectedPostId(null);
            navigate(`/record?record=${encodeURIComponent(recordId)}`);
          }}
        />
      ) : null}

      {/*
        `더 보기` 가 없어졌다. 그것은 달 단위 격자가 세 달씩 늘려 가던 것이고, 게시물
        격자는 달로 나뉘지 않는다 -- 남겨 두면 눌러도 아무것도 늘지 않는 버튼이 된다.
      */}
    </div>
  );
}

function ProfileTripList({
  trips,
  todayStr,
  onOpenTrip,
  onOpenAll,
}: {
  trips: Trip[];
  todayStr: string;
  onOpenTrip: (tripId: string) => void;
  onOpenAll: () => void;
}) {
  const orderedTrips = useMemo(() => {
    const grouped = groupTripsByPhase(trips, todayStr);
    return TRIP_PHASE_ORDER.flatMap((phase) => grouped[phase].map((trip) => ({ trip, phase })));
  }, [todayStr, trips]);
  const visibleTrips = orderedTrips.slice(0, 3);

  return (
    <section className="space-y-2 px-4 pt-3" data-testid="profile-trips-list" aria-label="여행 요약">
      <div className="flex items-center justify-between">
        <span className="text-caption font-semibold" style={{ color: 'var(--ink-soft)' }}>
          여행 {trips.length > 0 ? trips.length : ''}
        </span>
        <button
          type="button"
          onClick={onOpenAll}
          className="text-caption font-semibold underline"
          style={{ color: 'var(--ink-soft)' }}
        >
          전체 보기
        </button>
      </div>

      {visibleTrips.length > 0 ? (
        <div className="space-y-2">
          {visibleTrips.map(({ trip, phase }) => (
            <ProfileTripRow key={trip.id} trip={trip} phase={phase} onOpen={onOpenTrip} />
          ))}
        </div>
      ) : (
        <div
          className="rounded-control px-4 py-5 text-center"
          style={{ background: 'var(--paper)', border: 'var(--stroke-thin) solid var(--ink-faint)' }}
        >
          <p className="text-label" style={{ color: 'var(--ink-soft)' }}>
            등록한 여행이 없어요.
            <br />
            여행을 만들면 여기서 바로 볼 수 있어요.
          </p>
          <button
            type="button"
            onClick={onOpenAll}
            className="ink-chip mt-3 min-h-11 px-4"
          >
            <span className="text-label" style={{ color: 'var(--ink)' }}>여행 만들기</span>
          </button>
        </div>
      )}

      {orderedTrips.length > visibleTrips.length ? (
        <button
          type="button"
          onClick={onOpenAll}
          className="min-h-11 w-full text-caption font-semibold underline"
          style={{ color: 'var(--ink-soft)' }}
        >
          여행 전체 보기 ({orderedTrips.length})
        </button>
      ) : null}
    </section>
  );
}

function ProfileTripRow({
  trip,
  phase,
  onOpen,
}: {
  trip: Trip;
  phase: TripPhase;
  onOpen: (tripId: string) => void;
}) {
  const dateLabel = trip.startDate === trip.endDate
    ? formatLocalDate(trip.startDate)
    : `${formatLocalDate(trip.startDate)} ~ ${formatLocalDate(trip.endDate)}`;

  return (
    <button
      type="button"
      data-testid={`profile-trip-${trip.id}`}
      aria-label={`${trip.title} 열기`}
      onClick={() => onOpen(trip.id)}
      className="press-response flex min-h-16 w-full items-center gap-3 rounded-control px-3 text-left"
      style={{ background: 'var(--paper)', border: 'var(--stroke-thin) solid var(--ink-faint)' }}
    >
      <CalendarDays size={18} className="shrink-0 pen-icon" color="var(--ink-soft)" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-label font-semibold" style={{ color: 'var(--ink)' }}>{trip.title}</span>
          <span className="shrink-0 text-caption" style={{ color: 'var(--ink-soft)' }}>{TRIP_PHASE_PILL[phase]}</span>
        </span>
        <span className="mt-0.5 block truncate text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>
          {dateLabel}
        </span>
      </span>
      <ChevronRight size={16} className="shrink-0 pen-icon" color="var(--ink-soft)" aria-hidden="true" />
    </button>
  );
}

/**
 * 사진/기록 탭 — 기존 기록 목록을 읽고 세부/타임라인으로 진입하는 화면.
 */
function ProfileRecordList({
  records,
  coupleId,
  viewer,
  partnerName,
  onOpenRecord,
  onOpenDate,
  onOpenTimeline,
}: {
  records: DailyRecord[];
  coupleId?: string;
  viewer: { userId?: string; role?: Role };
  partnerName: string;
  onOpenRecord: (recordId: string) => void;
  onOpenDate: (date: string) => void;
  onOpenTimeline: () => void;
}) {
  const sorted = useMemo(
    () => [...records].sort((a, b) => (a.date === b.date ? (b.time || '').localeCompare(a.time || '') : b.date.localeCompare(a.date))),
    [records],
  );

  if (sorted.length === 0) {
    return (
      <p className="px-8 pt-12 text-center text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
        아직 남긴 기록이 없어요.
        <br />
        오늘 있었던 일을 하나 남기면 여기 모여요.
      </p>
    );
  }

  return (
    <div className="space-y-4 px-4 pt-3" data-testid="profile-records-list">
      <div className="flex items-center justify-between">
        <span className="text-caption font-semibold" style={{ color: 'var(--ink-soft)' }}>
          총 {sorted.length}개의 기록
        </span>
        <button
          type="button"
          onClick={onOpenTimeline}
          className="text-caption font-semibold underline"
          style={{ color: 'var(--ink-soft)' }}
        >
          타임라인 전체 보기
        </button>
      </div>

      <div className="space-y-3">
        {sorted.map((record) => {
          const author = recordAuthorPresentation(record, viewer, partnerName);
          const [, month, day] = record.date.split('-');
          const dateLabel = `${Number(month)}월 ${Number(day)}일`;

          return (
            <article
              key={record.id}
              className="space-y-2 rounded-control p-3.5 text-left"
              style={{
                background: 'var(--paper)',
                border: 'var(--stroke-thin) solid var(--ink-faint)',
              }}
            >
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn('inline-block px-2 py-0.5 rounded-full font-semibold text-caption', author.chipClass)}
                  >
                    {author.attribution}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenDate(record.date)}
                    className="text-caption tabular-nums hover:underline"
                    style={{ color: 'var(--ink-soft)' }}
                    aria-label={`${record.date} 기록 타임라인 열기`}
                  >
                    {dateLabel} {record.time}
                  </button>
                </div>
                {record.isPrivate ? (
                  <span className="flex items-center gap-1 text-caption" style={{ color: 'var(--ink-soft)' }}>
                    <Lock size={12} aria-hidden="true" /> 나만 보기
                  </span>
                ) : null}
              </header>

              {record.attachments && record.attachments.length > 0 ? (
                <div className="pt-1">
                  <RecordMediaGallery
                    attachments={record.attachments}
                    coupleId={coupleId}
                    recordId={record.id}
                  />
                </div>
              ) : null}

              {record.contentUnavailable ? (
                <p className="text-body" style={{ color: 'var(--ink-soft)' }}>
                  이 기기에서 아직 이 기록을 열 수 없어요.
                </p>
              ) : record.log ? (
                <p className="hand-text text-body whitespace-pre-wrap break-keep" style={{ color: 'var(--ink)' }}>
                  {record.log}
                </p>
              ) : null}

              <div className="flex items-center justify-end pt-1">
                <button
                  type="button"
                  onClick={() => onOpenRecord(record.id)}
                  className="ink-chip min-h-9 px-3 text-caption font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  기록 자세히 보기
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 게시물 하나의 상세 보기.
 *
 * 격자는 사진을 고르는 표면이고, 이 화면은 고른 사진을 크게 읽는 표면이다. 원본 기록의
 * 글은 캡션처럼 사진 아래에만 두며, 글 목록을 다시 여기서 복제하지 않는다. 여러 장이면
 * `RecordMediaGallery`가 가진 스와이프·확대 동작을 그대로 사용한다.
 */
function PhotoPostViewer({
  record,
  coupleId,
  viewer,
  partnerName,
  onClose,
  onOpenRecord,
}: {
  record: DailyRecord;
  coupleId?: string;
  viewer: { userId?: string; role?: Role };
  partnerName: string;
  onClose: () => void;
  onOpenRecord: (recordId: string) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const photos = useMemo(() => getPhotoAttachments(record), [record]);
  const author = recordAuthorPresentation(record, viewer, partnerName);
  const [, month, day] = record.date.split('-');
  const dateLabel = `${Number(month)}월 ${Number(day)}일${record.time ? ` ${record.time}` : ''}`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (photos.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-post-viewer-title"
        data-testid="photo-post-viewer"
        className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-4 shadow-xl sm:rounded-surface"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-11 items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="photo-post-viewer-title" className="text-label font-semibold text-card-foreground">
              {dateLabel}
            </h2>
            <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-caption font-semibold', author.chipClass)}>
              {author.attribution}
            </span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="사진 게시물 닫기"
            className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="pt-3">
          <RecordMediaGallery
            attachments={photos}
            coupleId={coupleId}
            recordId={record.id}
          />
        </div>

        {record.contentUnavailable ? (
          <p className="pt-3 text-caption leading-relaxed text-muted-foreground">
            사진은 보이지만 이 기록의 글은 이 기기에서 아직 열 수 없어요.
          </p>
        ) : record.log.trim() ? (
          <p className="hand-text whitespace-pre-wrap break-keep pt-3 text-body text-card-foreground">
            {record.log}
          </p>
        ) : null}

        <div className="flex justify-end pt-3">
          <button
            type="button"
            onClick={() => onOpenRecord(record.id)}
            className="ink-chip min-h-9 px-3 text-caption font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            기록 자세히 보기
          </button>
        </div>
      </div>
    </div>
  );
}
