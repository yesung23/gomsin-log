import { Camera, Image as ImageIcon, Mic, Pencil } from 'lucide-react';
import {
  BRIEFING_ITEMS,
  BRIEFING_ITEMS_LONG,
  FIRST_QUESTION,
  FIRST_QUESTION_LONG,
  GOMSIN_TODAY,
  LONG_NAME,
  MOMENTS,
  MOMENTS_LONG,
  MOOD_LINE,
  MOOD_LINE_LONG,
  SERVICE,
  type Moment,
  type ScreenState,
} from './fixtures';
import {
  AppBar,
  Card,
  EmptyState,
  ErrorNote,
  GhostButton,
  PrimaryButton,
  PrivateBadge,
  ReasonBadge,
  Skeleton,
  TabBar,
} from './ui';

type Props = { state: ScreenState; compact: boolean };

/* ------------------------------------------------------------------ */
/* 통화 전 60초 — the JUDGEMENT surface                                */
/* ------------------------------------------------------------------ */
/*
 * Deliberately carries NO media thumbnail and NO chronological rail. Those belong
 * to `상대방의 오늘` below. The only two app-written sentences in the whole home
 * live here, and both are smaller than the partner's own words.
 */
function CallBriefing({ state, compact }: Props) {
  const items = state === 'long' ? BRIEFING_ITEMS_LONG : BRIEFING_ITEMS;
  const mood = state === 'long' ? MOOD_LINE_LONG : MOOD_LINE;
  const question = state === 'long' ? FIRST_QUESTION_LONG : FIRST_QUESTION;

  if (state === 'loading') {
    return (
      <Card title="통화 전 60초" rail>
        <Skeleton label="새로 공유된 기록을 확인하는 중이에요" lines={4} />
      </Card>
    );
  }

  if (state === 'empty') {
    return (
      <Card title="통화 전 60초" rail>
        <EmptyState
          title="새로운 맥락이 없어요"
          description="어제 21:40 이후로 공유된 기록이 없습니다. 바로 안부를 물어도 좋아요."
        />
      </Card>
    );
  }

  return (
    <Card
      title="통화 전 60초"
      rail
      action={<span className="text-[12px] text-muted-foreground shrink-0">어제 21:40 이후</span>}
    >
      {state === 'error' ? (
        <ErrorNote
          message="확인 지점을 저장하지 못했어요"
          kept="목록은 그대로 남아 있어요."
          retry="다시 시도"
        />
      ) : null}

      {/* 먼저 살필 마음 — app-written, therefore body weight, never larger than the excerpts. */}
      <div className="px-4 pb-2">
        <p className="text-[12px] text-muted-foreground">먼저 살필 마음</p>
        <p className="text-[14px] text-foreground">{mood}</p>
      </div>

      <ul className="border-t border-border">
        {items.map((item, i) => (
          <li key={i} className="border-b border-border last:border-b-0">
            <button
              type="button"
              className="w-full text-left px-4 py-3 flex gap-3 items-start min-h-16"
            >
              <span className="shrink-0 pt-0.5">
                <ReasonBadge reason={item.reason} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-muted-foreground">{item.when}</span>
                <span
                  className="block text-[15px] font-semibold text-foreground overflow-hidden"
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                  }}
                >
                  {item.excerpt}
                </span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-muted-foreground text-[15px]">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="px-4 py-2 border-t border-border">
        <p className="text-[12px] text-muted-foreground">첫 질문</p>
        <p className="text-[14px] text-foreground">{question}</p>
      </div>

      {/*
        Action bar placement is size-dependent, and the reason is a real
        constraint rather than taste.

        At 390 the whole card fits above the fold, so the bar lives inside it and
        the card stays self-contained.

        At 320 the card is taller than the viewport. `position: sticky` cannot
        rescue it: `Card` sets `overflow-hidden` for its rounded corners, and an
        ancestor with `overflow: hidden` confines a sticky element to that
        ancestor's box -- so the bar stuck to the BOTTOM OF THE CARD, off-screen,
        and the preview caught `여기까지 확인` clipped behind the tab bar. The bar
        therefore leaves the card entirely and is pinned by `SoldierHome` above the
        tab bar, where it cannot be clipped by anything.
      */}
      {compact ? null : (
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border bg-card">
          <GhostButton label="더 보기 ⌄" />
          <PrimaryButton label="여기까지 확인" />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 상대방의 오늘 — the EVIDENCE surface                                */
/* ------------------------------------------------------------------ */
/*
 * Chronological, media-bearing, and containing nothing the app wrote. The left
 * column is a time rail rather than a reason badge, so scanning only the left edge
 * distinguishes "timetable" from "priority list".
 */
function MomentRow({ moment }: { moment: Moment }) {
  return (
    <li className="flex gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground pt-0.5 w-10">
        {moment.time}
      </span>
      <span className="min-w-0 flex-1">
        {moment.kind === 'photo' ? (
          <span className="mb-1 flex items-center gap-2">
            <span aria-hidden="true" className="block rounded-sm bg-muted" style={{ width: 44, height: 44 }} />
            <span className="text-[12px] text-muted-foreground">사진</span>
          </span>
        ) : null}
        {moment.kind === 'voice' ? (
          <span className="mb-1 inline-flex items-center gap-2 rounded-md bg-muted px-2 min-h-11">
            <span aria-hidden="true">▶</span>
            <span className="text-[12px] text-muted-foreground">음성 {moment.duration}</span>
          </span>
        ) : null}
        <span className="block text-[14px] text-foreground">{moment.body}</span>
        {moment.privateOnly ? (
          <span className="mt-1 block">
            <PrivateBadge />
          </span>
        ) : null}
      </span>
    </li>
  );
}

function PartnerDay({ state }: Props) {
  if (state === 'loading') {
    return (
      <Card title="상대방의 오늘">
        <Skeleton label="오늘 공유된 순간을 불러오는 중이에요" lines={3} />
      </Card>
    );
  }
  if (state === 'empty') {
    return (
      <Card title="상대방의 오늘">
        <EmptyState
          title="오늘은 아직 남긴 순간이 없어요"
          description="지난 기록은 기록 탭에서 볼 수 있어요."
        />
      </Card>
    );
  }
  const moments = state === 'long' ? MOMENTS_LONG : MOMENTS;
  return (
    <Card
      title="상대방의 오늘"
      action={<GhostButton label="전체 보기 ›" />}
    >
      <ul className="border-t border-border">
        {moments.map((m, i) => (
          <MomentRow key={i} moment={m} />
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 전역 D-Day — compact auxiliary strip, not a card                    */
/* ------------------------------------------------------------------ */
function DDayStrip() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
      <span className="text-[13px] text-muted-foreground shrink-0">전역까지</span>
      <span className="text-[17px] font-bold tabular-nums text-foreground shrink-0">
        D-{SERVICE.dday}
      </span>
      <span className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-coral"
          style={{ width: `${SERVICE.percent}%` }}
        />
      </span>
      <span className="text-[12px] tabular-nums text-muted-foreground shrink-0">
        {SERVICE.percent}%
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 군화 홈                                                             */
/* ------------------------------------------------------------------ */
export function SoldierHome({ state, compact }: Props) {
  /* The pinned bar is only meaningful while there is something to confirm. */
  const showPinnedAction = compact && state !== 'empty' && state !== 'loading';
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="곰신로그" right="21:10" />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <CallBriefing state={state} compact={compact} />
        <PartnerDay state={state} compact={compact} />
        <DDayStrip />
      </div>
      {showPinnedAction ? (
        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-border bg-card px-3 py-2">
          <GhostButton label="더 보기 ⌄" />
          <PrimaryButton label="여기까지 확인" />
        </div>
      ) : null}
      <TabBar active="홈" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 곰신 홈                                                             */
/* ------------------------------------------------------------------ */
/*
 * The shipped launcher (`TodayLogWidget`) is ONE row of 36px-tall type controls
 * with lucide glyphs; DESIGN_V2 §5.3 asked for the four big tiles to be replaced
 * by exactly that, and the app already was. This harness still drew the tiles
 * (`min-h-22`, four columns) with Unicode placeholders standing in for icons,
 * which is why the captured 곰신 홈 looked both taller and cruder than the app:
 * `▢` for photo and `◉` for voice read as a blank box and a target, not as a
 * camera and a microphone.
 *
 * `지금찍기` carries the coral tint because it is the one primary capture path;
 * the other three are neutral. Visual height is 36px, hit target stays 44px via
 * the `before:` overlay, exactly as in the implementation.
 */
const CAPTURE = [
  { label: '지금찍기', glyph: 'camera', primary: true },
  { label: '사진·영상', glyph: 'image' },
  { label: '음성', glyph: 'mic' },
  { label: '글', glyph: 'pen' },
];

/** Same lucide glyphs at the same 16px the launcher ships with. */
function CaptureGlyph({ name, primary }: { name: string; primary?: boolean }) {
  const cls = primary ? undefined : 'text-muted-foreground';
  if (name === 'camera') return <Camera size={16} aria-hidden="true" />;
  if (name === 'image') return <ImageIcon size={16} className={cls} aria-hidden="true" />;
  if (name === 'mic') return <Mic size={16} className={cls} aria-hidden="true" />;
  return <Pencil size={16} className={cls} aria-hidden="true" />;
}

export function GomsinHome({ state, compact }: Props) {
  const name = state === 'long' ? LONG_NAME : '민지';
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="곰신로그" right="알림" />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <div>
          <p className="px-1 text-[13px] text-muted-foreground">
            좋은 저녁이에요, <span className="font-medium text-foreground">{name}</span>님
          </p>
          <h2 className="px-1 mt-0.5 text-[17px] font-semibold text-foreground">
            오늘 어떤 순간이 있었나요?
          </h2>
        </div>

        {/* Capture launcher: a choice, not a form. An empty textarea on the home
            screen reads as an assignment; a single row of type controls does not. */}
        <div className={`flex items-center gap-2 ${compact ? 'flex-wrap' : ''}`}>
          {CAPTURE.map((c) => (
            <button
              key={c.label}
              type="button"
              className={[
                'relative flex items-center gap-1 px-3 h-9 rounded-control border',
                'text-[13px] font-semibold',
                "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
                c.primary
                  ? 'bg-coral/10 border-coral/20 text-coral-strong'
                  : 'bg-muted border-border text-foreground',
              ].join(' ')}
            >
              <CaptureGlyph name={c.glyph} primary={c.primary} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        {state === 'error' ? (
          <Card>
            <ErrorNote
              message="사진 1장을 올리지 못했어요"
              kept="글은 저장됐어요."
              retry="다시 올리기"
            />
          </Card>
        ) : null}

        {state !== 'empty' ? (
          <p className="px-1 text-[13px] text-muted-foreground">
            어제 이어 쓰던 글이 있어요{' '}
            <span className="font-semibold text-foreground underline">이어쓰기 ›</span>
          </p>
        ) : null}

        {state === 'loading' ? (
          <Card title="오늘의 브리핑">
            <Skeleton label="오늘 남긴 순간을 모으는 중이에요" lines={2} />
          </Card>
        ) : state === 'empty' ? (
          <Card title="오늘의 브리핑">
            <EmptyState
              title="아직 오늘의 순간이 없어요"
              description="사진 한 장만 남겨도 충분해요."
              action="오늘 기록하기"
            />
          </Card>
        ) : (
          <Card title="오늘의 타임라인">
            {/*
              Mirrors the shipped 오늘의 타임라인 block: time column, then the
              user's own sentence, then the confirmed emotion as quiet metadata.
              The row never prints a generated title for a record.
            */}
            <ul className="border-t border-border">
              {GOMSIN_TODAY.map((t) => (
                <li
                  key={t.time}
                  className="flex items-start gap-3 px-4 py-2.5 border-b border-border last:border-b-0"
                >
                  <span className="text-[12px] tabular-nums text-muted-foreground w-10 shrink-0 pt-0.5">
                    {t.time}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-foreground break-keep">{t.log}</span>
                    {t.emotion ? (
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        {t.emotion}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <DDayStrip />
      </div>
      <TabBar active="홈" />
    </div>
  );
}


/* ================================================================== */
/* 브리핑 `더 보기` 펼친 상태                                           */
/* ================================================================== */
/*
 * This is where the four widgets removed from the 군화 default home go. Nothing was
 * deleted -- 상대방 마음 흐름, 오늘의 요약, 다정한 한마디 are all here, one tap
 * away, and are still addable back to the home from 위젯 추가.
 *
 * They live BEHIND a disclosure because they are descriptions of the day. A
 * soldier with three minutes opens them; a soldier with forty seconds never has to
 * scroll past them to reach `여기까지 확인`.
 */
export function BriefingExpanded({ state, compact }: Props) {
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="통화 전 60초" right="어제 21:40 이후" />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <Card title="핵심 3" rail>
          <ul className="border-t border-border">
            {BRIEFING_ITEMS.map((item, i) => (
              <li key={i} className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="shrink-0 pt-0.5">
                  <ReasonBadge reason={item.reason} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-muted-foreground">{item.when}</span>
                  <span className="block text-[15px] font-semibold text-foreground">
                    {item.excerpt}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/*
          마음 흐름 as a CHIP SEQUENCE with no numeric axis. A line chart with ticks
          reads as a weekly score, which the product forbids: relationships are not
          quantified here.
        */}
        <Card title="상대방 마음 흐름">
          <div className="px-4 pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { t: '아침', e: '걱정' },
                { t: '점심', e: '그리움' },
                { t: '저녁', e: '지침' },
              ].map((s, i, arr) => (
                <span key={s.t} className="flex items-center gap-1.5">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[13px] text-foreground">
                    <span className="text-muted-foreground">{s.t} </span>
                    {s.e}
                  </span>
                  {i < arr.length - 1 ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              본인이 직접 확인한 마음만 표시해요. 점수나 등급은 매기지 않아요.
            </p>
          </div>
        </Card>

        <Card title="오늘의 요약">
          <p className="px-4 pb-3 text-[14px] text-foreground">
            {state === 'long'
              ? '과제가 갑자기 바뀌어 다시 쓰게 되었고, 점심때는 잠깐 울컥했다고 남겼어요. 저녁에는 숙소를 골라야 한다고 했어요.'
              : '과제가 바뀌어 다시 쓰게 되었다고 남겼어요.'}
          </p>
        </Card>

        <Card title="다정한 한마디">
          <div className="px-4 pb-3">
            <p className="text-[14px] text-foreground">
              “오늘 많이 바빴지? 나는 네 목소리 들으면 하루가 끝나는 느낌이야.”
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              실제 기록을 근거로 만든 제안이에요. 그대로 쓰지 않아도 괜찮아요.
            </p>
          </div>
        </Card>

        <p className="px-1 text-[12px] text-muted-foreground">
          이 카드들은 위젯 추가에서 홈으로 다시 올릴 수 있어요.
        </p>
      </div>
      <div className="shrink-0 border-t border-border bg-card px-3 py-2">
        <PrimaryButton label="여기까지 확인" full={compact} />
      </div>
      <TabBar active="홈" />
    </div>
  );
}

/* ================================================================== */
/* 상대방의 오늘 — 전체 보기                                            */
/* ================================================================== */
export function PartnerDayFull({ state }: Props) {
  const moments = state === 'long' ? MOMENTS_LONG : MOMENTS;
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="상대방의 오늘" right="8월 6일" />
      <div className="flex-1 overflow-y-auto py-2">
        {state === 'loading' ? (
          <Skeleton label="오늘 공유된 순간을 불러오는 중이에요" lines={5} />
        ) : state === 'empty' ? (
          <EmptyState
            title="오늘은 아직 남긴 순간이 없어요"
            description="지난 기록은 기록 탭에서 볼 수 있어요."
          />
        ) : (
          <>
            {state === 'error' ? (
              <ErrorNote
                message="일부 첨부를 불러오지 못했어요"
                kept="본문은 그대로 있어요."
                retry="다시 시도"
              />
            ) : null}
            {/* A continuous time rail: this screen is a timetable, and the left
                edge alone should say so. */}
            <ul className="px-3">
              {moments.map((m, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex w-12 shrink-0 flex-col items-center">
                    <span className="text-[12px] tabular-nums text-muted-foreground">{m.time}</span>
                    <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border" />
                  </span>
                  <span className="min-w-0 flex-1 pb-4">
                    {m.kind === 'photo' ? (
                      <span
                        aria-hidden="true"
                        className="mb-1 block w-full rounded-md bg-muted"
                        style={{ height: 140 }}
                      />
                    ) : null}
                    {m.kind === 'voice' ? (
                      <span className="mb-1 flex min-h-11 items-center gap-2 rounded-md bg-muted px-3">
                        <span aria-hidden="true">▶</span>
                        <span className="text-[13px] text-muted-foreground">
                          음성 {m.duration}
                        </span>
                      </span>
                    ) : null}
                    <span className="block text-[15px] text-foreground">{m.body}</span>
                    {m.privateOnly ? (
                      <span className="mt-1 block">
                        <PrivateBadge />
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <TabBar active="홈" />
    </div>
  );
}
