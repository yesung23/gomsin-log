import type { ScreenState } from './fixtures';
import {
  AppBar,
  Card,
  EmptyState,
  ErrorNote,
  GhostButton,
  PrimaryButton,
  PrivateBadge,
  Skeleton,
  TabBar,
} from './ui';

type Props = { state: ScreenState; compact: boolean };

/* ================================================================== */
/* 기록 탭 — archive, not a management tool                            */
/* ================================================================== */

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const FILTERS = ['전체', '사진', '영상', '음성', '글'];

type Entry = {
  author: 'gomsin' | 'soldier';
  name: string;
  time: string;
  body: string;
  emotion?: string;
  mustTalk?: boolean;
  privateOnly?: boolean;
  media?: 'photo' | 'voice';
};

const ENTRIES: Entry[] = [
  {
    author: 'gomsin',
    name: '민지',
    time: '14:20',
    body: '팀 과제가 갑자기 바뀌었어',
    emotion: '힘들었어',
    mustTalk: true,
  },
  { author: 'soldier', name: '현우', time: '18:10', body: '오늘 훈련 끝!', emotion: '좋았어' },
  {
    author: 'gomsin',
    name: '민지',
    time: '20:05',
    body: '이건 나만 볼래',
    privateOnly: true,
    media: 'photo',
  },
];

const ENTRIES_LONG: Entry[] = [
  {
    author: 'gomsin',
    name: '민지',
    time: '14:20',
    body: '팀 과제가 갑자기 바뀌어서 처음부터 다시 써야 하는데 조교님이 내일 오전까지 초안을 달라고 하셔서 오늘 밤은 못 잘 것 같아. 아까 공지 보고 진짜 멍했어.',
    emotion: '힘들었어',
    mustTalk: true,
  },
  {
    author: 'soldier',
    name: '현우',
    time: '18:10',
    body: '오늘 훈련 생각보다 길어서 저녁 먹고 바로 뻗을 것 같은데 그래도 목소리 듣고 자고 싶어서 기다릴게.',
    emotion: '좋았어',
  },
];

/**
 * Author distinction is threefold: alignment, the author's name in text, and a
 * background tint. Colour alone never carries it, so the timeline still reads
 * correctly in greyscale and for a colour-blind reader.
 */
/*
 * Mirrors the shipped row in `src/pages/RecordPage.tsx`, which the 2026-08-08
 * revision rebuilt as an editorial timeline. This harness row previously still
 * drew the chat bubble it replaced (`justify-end` + `max-w-[85%]`), so every
 * captured PNG of the record tab showed a layout the app no longer renders --
 * a visual review against those captures would have judged the wrong screen.
 *
 * Column geometry is copied from the implementation, not re-invented:
 *   time = w-11 (44px) · gap = 8px · media = 68px (76px @360+)
 * Author distinction keeps the same two non-colour channels the app uses: a
 * role stripe on the left edge (hue) and an ownership marker whose SHAPE
 * differs -- filled dot for mine, hollow ring for the partner's. Colour is
 * never the only signal (WCAG 1.4.1).
 */
function EntryRow({ entry }: { entry: Entry }) {
  const mine = entry.author === 'gomsin';
  return (
    <li className="list-none relative border-b border-border/40 last:border-b-0">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-1 ${mine ? 'bg-coral' : 'bg-info'}`}
      />
      <div className="flex pl-2.5">
        <div className="flex-1 flex gap-2 py-3 text-left min-w-0">
          <span className="shrink-0 w-11 text-right text-[12px] text-muted-foreground tabular-nums pt-0.5 font-medium">
            {entry.time}
          </span>

          <span className="shrink-0 flex flex-col items-center pt-1.5" aria-hidden="true">
            <span
              className={
                mine
                  ? 'block w-1.5 h-1.5 rounded-full bg-foreground'
                  : 'block w-1.5 h-1.5 rounded-full border border-foreground'
              }
            />
            <span className="w-px flex-1 bg-border mt-1" />
          </span>

          {entry.media === 'photo' ? (
            <span
              aria-hidden="true"
              className="shrink-0 w-[68px] min-[360px]:w-[76px] aspect-square rounded-md bg-muted"
            />
          ) : null}

          <span className="min-w-0 flex-1 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`px-1.5 py-0.5 rounded-full font-semibold text-[12px] whitespace-nowrap ${
                  mine ? 'bg-coral/15 text-foreground' : 'bg-info/15 text-foreground'
                }`}
              >
                {mine ? `🌸 곰신 · ${entry.name}` : `🪖 군화 · ${entry.name}`}
              </span>
              {entry.privateOnly ? <PrivateBadge /> : null}
            </span>

            <span className="text-[15px] text-foreground break-keep leading-snug">{entry.body}</span>

            <span className="flex items-center gap-1.5 flex-wrap">
              {entry.emotion ? (
                <span className="text-[12px] text-muted-foreground">{entry.emotion}</span>
              ) : null}
              {entry.mustTalk ? (
                <span className="rounded-sm bg-coral-strong px-1.5 py-0.5 text-[11px] font-medium text-coral-strong-foreground">
                  꼭 얘기
                </span>
              ) : null}
            </span>
          </span>
        </div>
      </div>
    </li>
  );
}

export function RecordTimeline({ state, compact }: Props) {
  const entries = state === 'long' ? ENTRIES_LONG : ENTRIES;
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="기록" right="2026. 8" />

      <div className="shrink-0 border-b border-border px-1 py-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="이전 달" className="min-h-11 min-w-11 text-muted-foreground">
            ‹
          </button>
          <div className="flex-1 grid grid-cols-7 gap-0.5">
            {DAYS.map((d) => (
              <span key={d} className="text-center text-[11px] text-muted-foreground">
                {d}
              </span>
            ))}
            {[3, 4, 5, 6, 7, 8, 9].map((n) => {
              const on = n === 6;
              return (
                <button
                  key={n}
                  type="button"
                  aria-current={on ? 'date' : undefined}
                  className={`min-h-11 rounded-md text-[13px] tabular-nums ${
                    on
                      ? 'bg-coral-strong font-semibold text-coral-strong-foreground'
                      : 'text-foreground'
                  }`}
                >
                  {n}
                  <span
                    aria-hidden="true"
                    className={`mx-auto mt-0.5 block rounded-full ${
                      [4, 5, 6].includes(n) ? 'bg-coral' : 'bg-transparent'
                    }`}
                    style={{ width: 4, height: 4 }}
                  />
                </button>
              );
            })}
          </div>
          <button type="button" aria-label="다음 달" className="min-h-11 min-w-11 text-muted-foreground">
            ›
          </button>
        </div>
      </div>

      <div className="shrink-0 flex gap-1 overflow-x-auto px-3 py-2 scrollbar-hide">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={f === '전체'}
            className={`min-h-11 shrink-0 rounded-md px-3 text-[13px] font-medium ${
              f === '전체' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {state === 'loading' ? (
          <Skeleton label="8월 6일의 기록을 불러오는 중이에요" lines={4} />
        ) : state === 'empty' ? (
          <EmptyState
            title="이 날은 아직 기록이 없어요"
            description="사진 한 장만 남겨도 충분해요."
            action="오늘 기록하기"
          />
        ) : (
          <>
            {state === 'error' ? (
              <ErrorNote
                message="일부 첨부를 불러오지 못했어요"
                kept="글은 그대로 있어요."
                retry="다시 시도"
              />
            ) : null}
            <p className="px-3 pb-2 text-[12px] text-muted-foreground">8월 6일 화요일</p>
            {/* Rows are separated by their own bottom divider, not by a gap. */}
            <ul>
              {entries.map((e, i) => (
                <EntryRow key={i} entry={e} />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Floating CTA sits in the bottom stack as a sibling of the banner, never
          overlapping it (DESIGN_V2 §3.9 / AI_HANDOFF §4.1 item 3). */}
      {state === 'error' ? (
        <div className="shrink-0 border-t border-border bg-warning-surface px-3 py-2">
          <p className="text-[12px] font-medium text-warning-foreground">
            오프라인 · 기록은 저장 후 자동 전송
          </p>
        </div>
      ) : null}
      <div className="shrink-0 border-t border-border bg-card px-3 py-2">
        <PrimaryButton label="오늘 기록하기" full />
      </div>
      <TabBar active="기록" />
    </div>
  );
}

/* ================================================================== */
/* 기록 작성 — full-height sheet, a choice before a form               */
/* ================================================================== */

const EMOTIONS = ['좋았어', '이런 일이', '힘들었어', '네 생각났어'];

export function RecordComposer({ state, compact }: Props) {
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Sheet chrome: grabber + title + 44px close. */}
      <div className="shrink-0 border-b border-border">
        <div className="flex justify-center pt-2" aria-hidden="true">
          <span className="block rounded-full bg-border" style={{ width: 36, height: 4 }} />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[15px] font-semibold text-foreground">오늘의 기록</span>
          <button type="button" aria-label="닫기" className="min-h-11 min-w-11 text-muted-foreground">
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <div className="rounded-lg border border-border bg-card px-3 py-2">
          <label htmlFor="composer-body" className="text-[12px] text-muted-foreground">
            무슨 일이 있었어?
          </label>
          <p
            id="composer-body"
            className="mt-1 text-[15px] text-foreground"
            style={{ minHeight: compact ? 72 : 110 }}
          >
            {state === 'long'
              ? '팀 과제가 갑자기 바뀌어서 처음부터 다시 써야 하는데 조교님이 내일 오전까지 초안을 달라고 하셔서 오늘 밤은 못 잘 것 같아. 그래도 통화할 때 목소리 들으면 좀 나아질 것 같아.'
              : '팀 과제가 갑자기 바뀌었어'}
          </p>
        </div>

        <div className="flex gap-2">
          {['사진', '영상', '음성'].map((m) => (
            <button
              key={m}
              type="button"
              className="min-h-11 flex-1 rounded-md border border-border bg-card text-[13px] font-medium text-foreground"
            >
              {m}
            </button>
          ))}
        </div>

        {state === 'error' ? (
          <ErrorNote
            message="사진 1장을 올리지 못했어요"
            kept="글과 나머지 첨부는 그대로예요."
            retry="다시 올리기"
          />
        ) : null}

        <div>
          <p className="mb-1.5 text-[12px] text-muted-foreground">
            마음 <span className="text-muted-foreground">(선택)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EMOTIONS.map((e) => {
              const on = e === '힘들었어';
              return (
                <button
                  key={e}
                  type="button"
                  aria-pressed={on}
                  /* The chip itself stays 34px tall for density, but the row wraps
                     it in a 44px hit area (AI_HANDOFF §4.1 item 2). */
                  className={`min-h-11 rounded-full px-3 text-[13px] font-medium ${
                    on ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {e}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/*
        Visibility and 통화 때 꼭 얘기 sit in the SAME field of view as 기록하기.
        Both are hard to undo -- if something private is shared, the partner has
        already seen it -- so the decision and its confirmation must be visible at
        the same moment.
      */}
      <div className="shrink-0 border-t border-border bg-card px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="min-h-11 rounded-md border border-border px-3 text-[13px] font-medium text-foreground"
          >
            우리에게 공유 ▾
          </button>
          <button
            type="button"
            aria-pressed="true"
            className="min-h-11 rounded-md bg-coral-strong px-3 text-[13px] font-medium text-coral-strong-foreground"
          >
            ✓ 통화 때 꼭 얘기
          </button>
        </div>
        <PrimaryButton label={state === 'loading' ? '저장 중…' : '기록하기'} full />
      </div>
    </div>
  );
}

/* ================================================================== */
/* 기록 상세                                                           */
/* ================================================================== */

export function RecordDetail({ state }: Props) {
  const mine = true;
  return (
    <div className="flex flex-col h-full bg-background">
      <AppBar title="기록" right="8월 6일" />
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <Card>
          <div className="px-4 py-3">
            <p className="text-[12px] text-muted-foreground">민지 · 2026년 8월 6일 14:20</p>
            {state === 'loading' ? (
              <Skeleton label="첨부를 불러오는 중이에요" lines={3} />
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="mt-2 block w-full rounded-md bg-muted"
                  style={{ height: 180 }}
                />
                <p className="mt-1 text-[12px] text-muted-foreground">사진 · 1 / 2</p>
                <p className="mt-2 text-[15px] text-foreground">
                  {state === 'long'
                    ? '팀 과제가 갑자기 바뀌어서 처음부터 다시 써야 하는데 조교님이 내일 오전까지 초안을 달라고 하셔서 오늘 밤은 못 잘 것 같아. 그래도 통화할 때 목소리 들으면 좀 나아질 것 같아.'
                    : '팀 과제가 갑자기 바뀌었어. 내일까지 다시 써야 해.'}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] text-muted-foreground">
                    힘들었어
                  </span>
                  <span className="rounded-sm bg-coral-strong px-1.5 py-0.5 text-[11px] font-medium text-coral-strong-foreground">
                    꼭 얘기
                  </span>
                </p>
              </>
            )}
          </div>
        </Card>

        {state === 'error' ? (
          <ErrorNote
            message="이 기록을 볼 권한이 없어요"
            retry="기록 목록으로"
          />
        ) : null}

        {/* Edit and delete appear only on your own record. A partner's record is
            read-only, decided by privacy.ts rather than by role comparison. */}
        {mine ? (
          <Card title="이 기록">
            <div className="px-4 pb-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-[13px] font-medium text-foreground"
              >
                본문·마음 수정
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-[13px] font-medium text-foreground"
              >
                첨부 추가
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md px-3 text-[13px] font-semibold text-destructive"
              >
                기록 삭제
              </button>
            </div>
          </Card>
        ) : (
          <p className="px-1 text-[12px] text-muted-foreground">
            상대의 기록은 볼 수만 있어요.
          </p>
        )}
        <GhostButton label="‹ 기록으로 돌아가기" />
      </div>
      <TabBar active="기록" />
    </div>
  );
}
