import type { ScreenState } from './fixtures';
import {
  AppBar,
  Card,
  EmptyState,
  ErrorNote,
  GhostButton,
  PrimaryButton,
  Skeleton,
  TabBar,
} from './ui';

type Props = { state: ScreenState; compact: boolean };

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Shared vs personal is a TEXT label first; the tint only reinforces it. */
function ScopeTag({ shared }: { shared: boolean }) {
  return shared ? (
    <span className="shrink-0 rounded-sm bg-info-surface px-1.5 py-0.5 text-[11px] font-medium text-info-foreground">
      공유
    </span>
  ) : (
    <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      나만
    </span>
  );
}

function PlanSectionNav({ active }: { active: '일정' | '여행' }) {
  return (
    <div role="tablist" aria-label="계획" className="flex gap-1">
      {(['일정', '여행'] as const).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={t === active}
          type="button"
          className={`min-h-11 rounded-md px-3 text-[14px] font-semibold ${
            t === active ? 'bg-foreground text-background' : 'text-muted-foreground'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== */
/* 일정 — a timetable, not a mood board                                */
/* ================================================================== */

type Ev = { time: string; title: string; kind: string; shared: boolean; mustTalk?: boolean };

const EVENTS: Ev[] = [
  { time: '14:00 – 17:00', title: '면회', kind: '면회', shared: true, mustTalk: true },
  { time: '19:00', title: '숙소 예약 마감', kind: '기타', shared: true },
  { time: '종일', title: '토익 접수', kind: '기타', shared: false },
];

const EVENTS_LONG: Ev[] = [
  {
    time: '14:00 – 17:00',
    title: '면회 — 부대 앞에서 만나서 근처 식당까지 걸어가기로 함',
    kind: '면회',
    shared: true,
    mustTalk: true,
  },
  {
    time: '19:00',
    title: '제주도 숙소 예약 취소 마감 (두 곳 중 하나 골라야 함)',
    kind: '기타',
    shared: true,
  },
];

type Task = { title: string; who: string; done: boolean };
const TASKS: Task[] = [
  { title: '신분증 챙기기', who: '현우', done: false },
  { title: '숙소 예약', who: '함께', done: true },
];

export function Schedule({ state, compact }: Props) {
  const events = state === 'long' ? EVENTS_LONG : EVENTS;
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="shrink-0 flex items-center justify-between border-b border-border px-3 py-2">
        <PlanSectionNav active="일정" />
        <button
          type="button"
          aria-label="일정 추가"
          className="min-h-11 min-w-11 rounded-md bg-info text-[18px] font-semibold text-background"
        >
          +
        </button>
      </header>

      <div className="shrink-0 border-b border-border px-1 py-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="이전 달" className="min-h-11 min-w-11 text-muted-foreground">
            ‹
          </button>
          <span className="flex-1 text-center text-[14px] font-semibold text-foreground">
            2026년 8월
          </span>
          <button type="button" aria-label="다음 달" className="min-h-11 min-w-11 text-muted-foreground">
            ›
          </button>
        </div>
        <div className="mt-1 grid grid-cols-7 gap-0.5">
          {DAYS.map((d) => (
            <span key={d} className="text-center text-[11px] text-muted-foreground">
              {d}
            </span>
          ))}
          {[5, 6, 7, 8, 9, 10, 11].map((n) => {
            const on = n === 8;
            return (
              <button
                key={n}
                type="button"
                aria-current={on ? 'date' : undefined}
                className={`min-h-11 rounded-md text-[13px] tabular-nums ${
                  on ? 'bg-info font-semibold text-background' : 'text-foreground'
                }`}
              >
                {n}
                <span
                  aria-hidden="true"
                  className={`mx-auto mt-0.5 block rounded-sm ${
                    [8, 9].includes(n) ? 'bg-info' : 'bg-transparent'
                  }`}
                  style={{ width: 8, height: 3 }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {state === 'loading' ? (
          <Card title="8월 8일 금요일">
            <Skeleton label="일정을 불러오는 중이에요" lines={3} />
          </Card>
        ) : state === 'empty' ? (
          <Card title="8월 8일 금요일">
            <EmptyState
              title="이 날은 비어 있어요"
              description="면회나 데이트를 함께 정해 보세요."
              action="일정 추가"
            />
          </Card>
        ) : (
          <Card title="8월 8일 금요일">
            <ul className="border-t border-border">
              {events.map((e, i) => (
                <li key={i} className="border-b border-border last:border-b-0">
                  <button type="button" className="w-full min-h-16 px-4 py-2.5 text-left">
                    {/* Time above the title: on this screen people scan for "when". */}
                    <span className="block text-[12px] tabular-nums text-muted-foreground">
                      {e.time}
                    </span>
                    <span className="mt-0.5 flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
                        {e.title}
                      </span>
                      <ScopeTag shared={e.shared} />
                    </span>
                    {e.mustTalk ? (
                      <span className="mt-1 inline-block rounded-sm bg-coral-strong px-1.5 py-0.5 text-[11px] font-medium text-coral-strong-foreground">
                        꼭 얘기
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {state === 'error' ? (
          <ErrorNote
            message="오프라인이라 지금은 읽기만 가능해요"
            kept="마지막으로 동기화된 계획을 보고 있어요."
            retry="연결 다시 확인"
          />
        ) : null}

        <Card title="같이 할 일" action={<GhostButton label="+ 추가" />}>
          <ul className="border-t border-border">
            {TASKS.map((t) => (
              <li
                key={t.title}
                className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={t.done}
                  className="min-h-11 min-w-11 shrink-0 text-[16px] text-foreground"
                >
                  {t.done ? '☑' : '☐'}
                </button>
                <span
                  className={`min-w-0 flex-1 text-[14px] ${
                    t.done ? 'text-muted-foreground line-through' : 'text-foreground'
                  }`}
                >
                  {t.title}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">{t.who}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-2">
            <p className="text-[13px] text-muted-foreground">할 일 빠르게 추가…</p>
          </div>
        </Card>
        {compact ? null : <div className="h-2" />}
      </div>
      <TabBar active="일정" />
    </div>
  );
}

/* ================================================================== */
/* 일정 상세                                                           */
/* ================================================================== */

export function ScheduleDetail({ state }: Props) {
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="일정" right="8월 8일" />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <Card>
          <div className="px-4 py-3">
            <p className="text-[12px] tabular-nums text-muted-foreground">
              2026년 8월 8일 금요일 · 14:00 – 17:00
            </p>
            <h2 className="mt-0.5 text-[20px] font-bold text-foreground">면회</h2>
            <p className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                면회
              </span>
              <ScopeTag shared />
              <span className="rounded-sm bg-coral-strong px-1.5 py-0.5 text-[11px] font-medium text-coral-strong-foreground">
                꼭 얘기
              </span>
            </p>
            <p className="mt-3 text-[14px] text-foreground">
              {state === 'long'
                ? '부대 앞에서 만나서 근처 식당까지 걸어가기로 했어. 면회 신청은 내가 미리 해 둘게. 혹시 시간 바뀌면 바로 알려줘.'
                : '부대 앞에서 만나기로 했어.'}
            </p>
          </div>
        </Card>

        <Card title="이 일정">
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md border border-border px-3 text-[13px] font-medium text-foreground"
            >
              수정
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md px-3 text-[13px] font-semibold text-destructive"
            >
              삭제
            </button>
          </div>
          <p className="px-4 pb-3 text-[12px] text-muted-foreground">
            만든 사람만 수정하거나 지울 수 있어요.
          </p>
        </Card>
        <GhostButton label="‹ 일정으로 돌아가기" />
      </div>
      <TabBar active="일정" />
    </div>
  );
}

/* ================================================================== */
/* 여행 목록                                                           */
/* ================================================================== */

const TRIPS = [
  { title: '제주도', range: '8/20 – 8/22', phase: '계획 중' },
  { title: '부산', range: '9/14 – 9/15', phase: '계획 중' },
  { title: '강릉', range: '6/1 – 6/2', phase: '완료' },
];

export function Trips({ state }: Props) {
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="shrink-0 flex items-center justify-between border-b border-border px-3 py-2">
        <PlanSectionNav active="여행" />
        <button
          type="button"
          aria-label="여행 추가"
          className="min-h-11 min-w-11 rounded-md bg-info text-[18px] font-semibold text-background"
        >
          +
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {state === 'loading' ? (
          <Card title="다가오는 여행">
            <Skeleton label="여행을 불러오는 중이에요" lines={3} />
          </Card>
        ) : state === 'empty' ? (
          <Card title="다가오는 여행">
            <EmptyState
              title="아직 계획한 여행이 없어요"
              description="휴가나 면회에 맞춰 하나 만들어 보세요."
              action="여행 만들기"
            />
          </Card>
        ) : (
          <Card title="다가오는 여행">
            <ul className="border-t border-border">
              {TRIPS.map((t) => (
                <li key={t.title} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    className="flex w-full min-h-16 items-center gap-3 px-4 py-2.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-foreground">
                        {t.title}
                      </span>
                      <span className="block text-[12px] tabular-nums text-muted-foreground">
                        {t.range}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${
                        t.phase === '완료'
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-info-surface text-info-foreground'
                      }`}
                    >
                      {t.phase}
                    </span>
                    <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <TabBar active="일정" />
    </div>
  );
}

/* ================================================================== */
/* 여행 상세 — dates, times and ORDER, not a gallery                   */
/* ================================================================== */

type Place = {
  time: string | null;
  name: string;
  kind: string;
  hours?: string;
  needsCheck?: boolean;
  mustTalk?: boolean;
};

const PLACES: Place[] = [
  { time: '10:00', name: '성산일출봉', kind: '활동', hours: '07:30–20:00' },
  { time: '12:30', name: '해녀의 집', kind: '맛집', hours: '11:00–19:00', mustTalk: true },
  { time: null, name: '오션뷰 카페', kind: '맛집', needsCheck: true },
  { time: null, name: '숙소 체크인', kind: '숙소' },
];

export function TripDetail({ state, compact }: Props) {
  const timed = PLACES.filter((p) => p.time);
  const untimed = PLACES.filter((p) => !p.time);
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="shrink-0 flex items-center gap-2 border-b border-border px-2 py-2">
        <button type="button" aria-label="뒤로" className="min-h-11 min-w-11 text-muted-foreground">
          ‹
        </button>
        <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-foreground">
          제주도 여행
        </span>
        <button
          type="button"
          className="min-h-11 rounded-md px-3 text-[13px] font-medium text-muted-foreground"
        >
          편집
        </button>
      </header>

      <div role="tablist" aria-label="여행 날짜" className="shrink-0 flex gap-1 border-b border-border px-2 py-2">
        {['8/20 수', '8/21 목', '8/22 금'].map((d, i) => (
          <button
            key={d}
            role="tab"
            aria-selected={i === 1}
            type="button"
            className={`min-h-11 flex-1 rounded-md text-[13px] font-medium tabular-nums ${
              i === 1 ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {state === 'loading' ? (
          <Card title="8월 21일">
            <Skeleton label="장소를 불러오는 중이에요" lines={4} />
          </Card>
        ) : state === 'empty' ? (
          <Card title="8월 21일">
            <EmptyState
              title="이 날은 아직 장소가 없어요"
              description="가고 싶은 곳을 하나만 적어도 순서가 잡혀요."
              action="장소 추가"
            />
          </Card>
        ) : (
          <>
            {/* Places WITH a time sort themselves chronologically. */}
            <Card title="8월 21일 목요일">
              <ul className="border-t border-border">
                {timed.map((p) => (
                  <li key={p.name} className="flex gap-3 border-b border-border px-4 py-2.5">
                    <span className="w-12 shrink-0 pt-0.5 text-[13px] font-semibold tabular-nums text-foreground">
                      {p.time}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
                          {p.name}
                        </span>
                        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {p.kind}
                        </span>
                      </span>
                      {p.hours ? (
                        <span className="block text-[12px] tabular-nums text-muted-foreground">
                          {p.hours}
                        </span>
                      ) : null}
                      {p.mustTalk ? (
                        <span className="mt-1 inline-block rounded-sm bg-coral-strong px-1.5 py-0.5 text-[11px] font-medium text-coral-strong-foreground">
                          꼭 얘기 · 예약 필요
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Places WITHOUT a time are grouped below and ordered by hand.
                  Mixing them into the timed list would destroy the reason the
                  order is what it is. */}
              <p className="px-4 pt-2 text-[12px] text-muted-foreground">
                시각 미정 · 순서를 직접 정해요
              </p>
              <ul>
                {untimed.map((p, i) => (
                  <li key={p.name} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="w-12 shrink-0 pt-0.5 text-[12px] text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
                          {p.name}
                        </span>
                        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {p.kind}
                        </span>
                      </span>
                      {/* OCR-filled fields keep a persistent 확인 필요 badge until a
                          human edits them: a wrong address is only discovered at the
                          destination, where recovery is expensive. */}
                      {p.needsCheck ? (
                        <span className="mt-1 inline-block rounded-sm bg-warning-surface px-1.5 py-0.5 text-[11px] font-medium text-warning-foreground">
                          지도 캡처로 입력 · 확인 필요
                        </span>
                      ) : null}
                    </span>
                    {/* Side by side rather than stacked: two 44px targets in a
                        column made every untimed row 88px tall and pushed the
                        checklist off a 320px screen. */}
                    <span className="flex shrink-0 items-start">
                      <button
                        type="button"
                        aria-label={`${p.name} 위로`}
                        className="min-h-11 min-w-11 text-muted-foreground"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`${p.name} 아래로`}
                        className="min-h-11 min-w-11 text-muted-foreground"
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {state === 'error' ? (
              <ErrorNote
                message="순서를 저장하지 못했어요"
                kept="화면의 순서는 저장 전 상태예요."
                retry="다시 시도"
              />
            ) : null}

            <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <button
                type="button"
                className="min-h-11 rounded-md border border-border bg-card text-[13px] font-medium text-foreground"
              >
                + 직접 추가
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md border border-border bg-card text-[13px] font-medium text-foreground"
              >
                지도 캡처로 추가
              </button>
            </div>
            <p className="px-1 text-[11px] text-muted-foreground">
              캡처는 기기에서만 읽고 서버에 올리지 않아요.
            </p>

            <Card title="같이 준비" action={<GhostButton label="+ 추가" />}>
              <ul className="border-t border-border">
                {[
                  { t: '렌터카 예약', d: true },
                  { t: '우산 챙기기', d: false },
                ].map((c) => (
                  <li
                    key={c.t}
                    className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={c.d}
                      className="min-h-11 min-w-11 shrink-0 text-[16px] text-foreground"
                    >
                      {c.d ? '☑' : '☐'}
                    </button>
                    <span
                      className={`flex-1 text-[14px] ${
                        c.d ? 'text-muted-foreground line-through' : 'text-foreground'
                      }`}
                    >
                      {c.t}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <PrimaryButton label="여행 기간 추억 보기" full />
          </>
        )}
      </div>
      <TabBar active="일정" />
    </div>
  );
}
