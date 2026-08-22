import { useState, useMemo } from 'react';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { buildMonthTexture, monthsMissingBetween, monthsWithContent } from '@/features/us/monthTexture';
import { MonthGrid } from '@/features/us/MonthGrid';
import { MobileShell } from '@/components/MobileShell';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { AvatarPicker } from '@/components/AvatarPicker';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { CoupleStatsRow } from '@/components/CoupleStatsRow';
import { CoupleHighlights } from '@/components/CoupleHighlights';
import { AppBar } from '@/components/ui/AppBar';
import { Heart, CalendarDays, Plane, ChevronRight, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toLocalDateString, localToday, daysBetweenLocal } from '@/lib/utils';

/*
  `buildCalendarGrid` and `WEEKDAYS` used to live here.

  우리 rendered a weekday-aligned month calendar that showed events and trips and
  nothing else -- so the screen meant to hold everything this couple has built
  showed neither their records nor their photographs, and duplicated the calendar
  `SchedulePage` already owns.

  일정 owns the future and therefore the calendar. 우리 owns the past, and its grid
  is a texture (`features/us/monthTexture.ts`): one cell per day, packed in date
  order, never weekday-aligned.
*/

export function UsPage() {
  const { state, coupleLifecycle } = useStore();
  const navigate = useNavigate();
  const { myName } = state.profile;
  const partnerName = state.profile.couple.partnerName || '상대방';
  const connected = state.profile.couple.connected;
  /**
   * M-1: no invented anniversary. This used to fall back to a fixed literal and
   * then render a confident `함께한 지 +N일째` for a couple that never entered a
   * date (`sync.ts` maps a null column to `''`). `DDayWidget` already renders
   * `기념일 미설정` in that case; this surface now agrees with it.
   */
  const anniversaryDate = state.profile.couple.anniversaryDate || undefined;
  /*
    Memoised because they feed `useMemo` dependency lists below. `state.trips || []`
    allocates a fresh array on every render, so the texture for every visible month
    was being rebuilt on each one -- lint caught it, and at three months of cells
    that is real work.
  */
  const trips = useMemo(() => state.trips || [], [state.trips]);
  const events = useMemo(() => state.events || [], [state.events]);

  const today = localToday();
  const todayStr = toLocalDateString(today);

  const diffDays = anniversaryDate
    ? daysBetweenLocal(anniversaryDate, todayStr) + 1
    : null;

  /**
   * What this viewer may see. Not re-implemented here and never to be: this is
   * the function that keeps a private record and an author-only feeling out of a
   * partner's client, and a second copy of that rule is a second place for it to
   * go wrong.
   */
  const viewer = useMemo(
    () => ({ userId: state.profile.id, role: state.profile.role }),
    [state.profile.id, state.profile.role],
  );
  const visibleRecords = useMemo(
    () => visibleRecordsForViewer(state.records || [], viewer),
    [state.records, viewer],
  );

  const months = useMemo(
    () => monthsWithContent({
      records: visibleRecords,
      events,
      trips,
      today: todayStr,
      anniversary: anniversaryDate,
    }),
    [visibleRecords, events, trips, todayStr, anniversaryDate],
  );

  /**
   * How many months are drawn.
   *
   * Three to start, because a phone shows about that much before the fold and a
   * relationship two years old would otherwise mount seven hundred cells to
   * render the twenty a person is about to look at.
   */
  const [visibleMonthCount, setVisibleMonthCount] = useState(3);
  const shownMonths = useMemo(
    () => months.slice(0, visibleMonthCount).map((m) => buildMonthTexture({
      year: m.year,
      month: m.month,
      records: visibleRecords,
      events,
      trips,
      today: todayStr,
      anniversary: anniversaryDate,
    })),
    [months, visibleMonthCount, visibleRecords, events, trips, todayStr, anniversaryDate],
  );

  /**
   * 칸 하나가 그날의 보관 스토리로.
   *
   * 전에는 `/record?date=`로 갔다. 정확한 날짜였지만 다른 탭의 다른 문법으로 떨어졌고,
   * 사진첩을 넘기던 손이 갑자기 목록을 읽게 됐다. 지금은 오늘 아침에 넘긴 그 봉투를
   * 석 달 뒤 같은 제스처로 다시 넘긴다 -- 그것이 "오늘의 스토리가 내일의 기억"이라는
   * 명제를 화면으로 증명하는 방식이다.
   *
   * "정확한 원본, 근사치 금지"(§4.2)는 그대로 지켜진다. 보관 스토리는 그 날짜의 기록만
   * 담고, 각 카드의 `원본 보기`가 정확히 그 기록으로 간다.
   */
  const openDay = (date: string) => navigate(`/story/day/${date}`);

  return (
    <MobileShell>
      <AppBar
        title="우리"
        actions={
          <div className="flex items-center gap-2">
            {/* /schedule had no entry point anywhere in the UI before this. */}
            {/*
              These two paint at 64x34 and stay that size. DESIGN_V2 §Visual
              footprint ≠ hit target asks for the compact look AND a 44px target, so
              the gap is closed by a `::before` overlay rather than by growing the
              chips -- the same idiom `Button` uses for its `sm` size.

              `-inset-y-1.5` alone would leave the horizontal edges short of 44px,
              but 64px wide already clears it, so only the vertical axis is extended.
            */}
            <button
              onClick={() => navigate('/schedule')}
              className="press-response text-label font-bold text-foreground bg-navy/10 px-3 py-2 rounded-control flex items-center gap-1 relative isolate before:absolute before:content-[''] before:-z-10 before:left-0 before:right-0 before:top-[-6px] before:bottom-[-6px]"
            >
              <CalendarDays size={14} />
              <span>일정</span>
            </button>
            <button
              onClick={() => navigate('/trips')}
              className="press-response text-label font-bold text-coral-strong bg-coral/10 px-3 py-2 rounded-control flex items-center gap-1 relative isolate before:absolute before:content-[''] before:-z-10 before:left-0 before:right-0 before:top-[-6px] before:bottom-[-6px]"
            >
              <Plane size={14} />
              <span>여행</span>
            </button>
          </div>
        }
      />
      <div className="pb-28 px-5 pt-4 space-y-5">
        {/* Profile */}
        <section className="flex flex-col items-center text-center py-3 space-y-2">
          {/*
            The couple illustration is a placeholder for two specific people, so it
            can be replaced with their photo. Stored per device (see
            `src/lib/avatarImage.ts`): the media bucket's policies are scoped to a
            record id, and widening them for a decoration is not a trade worth making.
          */}
          <AvatarPicker
            userId={state.authenticatedUser?.id || state.profile.id || ''}
            slot="couple"
            size={56}
            label="커플 사진"
          >
            <CoupleAvatar size={56} />
          </AvatarPicker>
          <div>
            <h2 className="text-heading text-foreground flex items-center justify-center gap-1.5">
              <span>{myName || '나'}</span>
              <Heart size={14} className="text-coral fill-coral" />
              <span>{partnerName}</span>
            </h2>
            <p className="text-caption text-muted-foreground mt-0.5 font-medium">
              {/*
                The trailing 💕 is gone. The heart between the two names above is
                already a filled `Heart` icon in the brand coral, so the emoji was a
                second heart in the same breath -- and an emoji renders as whatever
                the OS ships, which is the one glyph on screen the app cannot art
                direct. One heart, drawn by us.
              */}
              {connected
                ? diffDays !== null
                  ? `함께한 지 +${diffDays}일째`
                  : '기념일 미설정 · 설정에서 사귄 날짜를 추가해 보세요'
                : coupleLifecycle === 'pending'
                  ? '상대방이 초대 코드를 입력하면 연결돼요'
                  : coupleLifecycle === 'disconnected'
                    ? '커플 공간 연결이 해제되었어요'
                    : coupleLifecycle === 'unknown'
                      ? '커플 공간 상태를 확인하고 있어요'
                      : '우리 공간을 만들거나 초대 코드를 입력해 보세요'}
            </p>
          </div>
        </section>

        {/*
          통계 세 칸과 보호 표식.

          인스타 프로필의 `게시물 · 팔로워 · 팔로잉` 자리를 관계의 시간으로 바꾼다.
          자물쇠는 §14.5의 단계별 표현 계약을 따르는데, 그 문장을 여기에 복사하지 않고
          이미 정직하게 쓰여 있는 개인정보 처리방침으로 보낸다 -- 보안 표현이 두 곳에
          있으면 한쪽이 낡는 날이 오고, 낡는 쪽이 화면일 가능성이 높다.
        */}
        {connected ? (
          <CoupleStatsRow
            userId={state.authenticatedUser?.id || state.profile.id || ''}
            anniversaryDate={anniversaryDate}
            events={events}
            military={state.profile.military}
            todayStr={todayStr}
            onProtectionTap={() => navigate('/legal/privacy')}
          />
        ) : null}

        {/*
          하이라이트.

          인스타는 과거만 담지만 이 앱은 기다림이 제품이라 맨 뒤에 아직 오지 않은 것을
          하나 흐리게 놓는다. 도착하면 색이 들어오고 그날의 스토리가 담긴다.
        */}
        {connected ? (
          <CoupleHighlights
            anniversaryDate={anniversaryDate}
            events={events}
            military={state.profile.military}
            todayStr={todayStr}
          />
        ) : null}

        <CoupleStatusBanner />

        {/*
          The months, newest first.

          This replaced a weekday-aligned calendar that showed only events and
          trips -- so the screen holding everything this couple has built showed
          neither their records nor their photographs, and duplicated the calendar
          `SchedulePage` owns. 일정 owns the future and the calendar grammar with
          it; 우리 owns the past, and the past is a texture.
        */}
        <section className="space-y-5" aria-label="달마다 쌓인 기록">
          {shownMonths.map((month, index) => (
            <div key={month.key} className="space-y-2">
              {/*
                Months holding nothing are not drawn -- a grid of 31 identical
                empty squares says "this relationship had nothing in it". But
                dropping them silently makes the months that remain look adjacent,
                so a couple who wrote in March and again in August would see the
                five months between them vanish.

                우리 is the evidence of time spent apart, and time that passed
                quietly still passed. So it is stated, once, in the quietest
                grammar the surface has: one muted line, no card, no icon, no
                count of what was missed. It says a number of months went by, not
                that anyone failed to fill them -- §3.6, this app does not make
                anyone anxious, and a gap in the record is not a verdict on a
                relationship.
              */}
              {index > 0 && monthsMissingBetween(shownMonths[index - 1], month) > 0 && (
                <p
                  data-testid="us-month-gap"
                  className="px-1 pt-1 text-caption text-muted-foreground"
                >
                  조용히 지나간 {monthsMissingBetween(shownMonths[index - 1], month)}개월
                </p>
              )}
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3 className="text-heading text-foreground">
                  {month.year}년 {month.month}월
                </h3>
                {month.recordCount > 0 && (
                  <p className="text-caption text-muted-foreground tabular-nums">
                    기록 {month.recordCount}
                    {month.photoCount > 0 && ` · 사진 ${month.photoCount}`}
                    {/*
                      Days BOTH of them wrote. The most meaningful number this
                      relationship produces, and the one a count of records alone
                      cannot say.
                    */}
                    {month.togetherCount > 0 && ` · 함께 ${month.togetherCount}일`}
                  </p>
                )}
              </div>

              <MonthGrid
                data={month}
                coupleId={state.profile.couple.coupleId || undefined}
                onOpenDay={openDay}
              />
            </div>
          ))}

          {visibleMonthCount < months.length && (
            <button
              type="button"
              onClick={() => setVisibleMonthCount((count) => count + 6)}
              className="press-response-row w-full min-h-11 rounded-control border border-border bg-card text-label font-bold text-foreground"
            >
              이전 달 더 보기
            </button>
          )}
        </section>

        {/* Travel Planner & Events */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-heading text-foreground flex items-center gap-2">
              <Plane className="w-4 h-4 text-info" /> 다가오는 여행
            </h3>
            {/*
              Paints at 45x18 as a text link. `-inset-y-3.5` takes 18 to 46 and
              `-inset-x-1` takes 45 to 53, both clearing 44 without changing how the
              header reads (DESIGN_V2 §Visual footprint ≠ hit target).
            */}
            <button onClick={() => navigate('/trips')} className="text-label font-bold text-muted-foreground hover:text-foreground relative isolate before:absolute before:content-[''] before:-z-10 before:left-[-4px] before:right-[-4px] before:top-[-14px] before:bottom-[-14px]">
              전체보기
            </button>
          </div>
          
          {trips.length > 0 ? (
            <div className="space-y-2">
              {trips.map((trip) => (
                /*
                  A real <button>, not a clickable <div>: the trip list is the only
                  way into a trip from 우리, and as a div it was in no tab order and
                  answered no key, so the whole 여행 section was pointer-only.
                */
                <button
                  key={trip.id}
                  type="button"
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  aria-label={`${trip.title} 여행 상세 보기`}
                  className="press-response-row w-full text-left p-3 min-h-[44px] rounded-surface bg-card border border-border cursor-pointer flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-label font-bold text-foreground">
                      <MapPin size={14} className="text-info" aria-hidden="true" /> {trip.title}
                    </div>
                    <p className="text-caption text-muted-foreground font-medium">{trip.startDate} ~ {trip.endDate}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground/50" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/trips')}
              className="press-response-row w-full p-4 min-h-[44px] rounded-surface bg-muted/40 border border-dashed border-border/60 text-center cursor-pointer hover:bg-muted/60"
            >
              <p className="text-label font-bold text-muted-foreground mb-1">+ 새로운 여행 계획하기</p>
            </button>
          )}
        </section>

      </div>
    </MobileShell>
  );
}
