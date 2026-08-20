import { useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Lock } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer, isOwnRecord } from '@/lib/privacy';
import { generateDailySummary } from '@/lib/briefing';
import { isRecordContentAvailable } from '@/lib/recordAvailability';
import { basicEmotionOf } from '@/lib/basicEmotions';
import { EmotionCharacter } from '@/components/emotion/EmotionCharacter';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { formatLocalDate, toLocalDateString, localToday } from '@/lib/utils';
import type { DailyRecord } from '@/types';

/**
 * The home screen as a running exchange.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a SECOND PRESENTATION of records that already exist -- the same rows the
 * widget dashboard reads, through the same `visibleRecordsForViewer` filter. There
 * is no message table, no send path, no delivery or read state, and no composer
 * that produces anything other than an ordinary `DailyRecord`.
 *
 * That distinction is the whole reason this is allowed to exist. PRODUCT_V3 §12.1
 * freezes in-app chat for V1 and §16 lists a general messenger as a non-goal.
 * Drawing existing records in a shape people already know how to read is not
 * unfreezing either of those, and the moment something here starts to send, it is.
 *
 * The one thing a chat shape invites that this must never grow is a reply box. The
 * app already has the two replies it wants -- 반응 and 이따 이야기하기 -- and both
 * live on the record itself, one tap away through the bubble.
 *
 * ## Why a conversation at all
 *
 * The partner with the scarce phone window is not browsing; they are catching up
 * on a backlog, which is exactly what they already do in a messenger. Oldest first,
 * newest at the bottom, their own on the right. The dashboard asked them to
 * assemble that from cards; this hands it to them in the order it happened.
 *
 * ## The summary
 *
 * Pinned above the exchange, from `generateDailySummary` -- the same deterministic
 * function the dashboard uses. §6.2 requires the same input to produce the same
 * output and forbids a model here, so nothing on this screen waits on inference:
 * it is a pure function of records the device already holds. Every line still
 * carries its source record id and still moves to the exact original.
 */

/** A day's worth of records, with the label the separator shows. */
interface DayGroup {
  date: string;
  label: string;
  records: DailyRecord[];
}

function groupByDay(records: DailyRecord[], todayStr: string): DayGroup[] {
  const byDate = new Map<string, DailyRecord[]>();
  for (const record of records) {
    const list = byDate.get(record.date);
    if (list) list.push(record);
    else byDate.set(record.date, [record]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({
      date,
      label: date === todayStr ? '오늘' : formatLocalDate(date),
      records: group.sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    }));
}

export function ConversationHome() {
  const navigate = useNavigate();
  const { state, setHighlightedRecordId } = useStore();
  const { records, profile } = state;
  const partnerName = profile.couple.partnerName || '상대방';
  const todayStr = toLocalDateString(localToday());

  const viewer = useMemo(
    () => ({ userId: profile.id, role: profile.role }),
    [profile.id, profile.role],
  );

  /**
   * Exactly what the dashboard would show, in time order.
   *
   * `visibleRecordsForViewer` is not re-implemented here and must not be: it is
   * the function that keeps a private record and an author-only feeling out of a
   * partner's client, and a second copy of that rule is a second place for it to
   * be wrong.
   */
  const visible = useMemo(
    () => visibleRecordsForViewer(records, viewer).filter(isRecordContentAvailable),
    [records, viewer],
  );

  const days = useMemo(() => groupByDay(visible, todayStr), [visible, todayStr]);

  /** The partner's shared records only -- what the summary is allowed to describe. */
  const partnerToday = useMemo(
    () => visible.filter(
      (record) => !isOwnRecord(record, viewer) && record.date === todayStr,
    ),
    [visible, viewer, todayStr],
  );

  const summary = useMemo(
    () => generateDailySummary(partnerToday, partnerName),
    [partnerToday, partnerName],
  );

  /**
   * Open at the newest, the way a messenger does.
   *
   * `auto` rather than `smooth`: this is the arrival position, not a movement the
   * user asked for, and animating a scroll on open reads as the screen having
   * moved on its own.
   */
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Optional call, not a guard for tests: landing at the newest entry is a
    // nicety, and a runtime without `scrollIntoView` -- jsdom, an old WebView --
    // should still get a working screen rather than a blank one from a thrown
    // effect. The app defends `ResizeObserver` the same way in `MobileShell`.
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [days.length]);

  const openRecord = (record: DailyRecord) => {
    // The exact original, never an approximation. PRODUCT_V3 §4.2.
    setHighlightedRecordId(record.id);
    navigate(`/record?date=${record.date}`);
  };

  return (
    <div className="pb-6">
      <header className="px-4 pt-3 pb-3 flex items-baseline gap-1.5 sticky top-0 bg-background/90 backdrop-blur-xl z-40">
        <span className="text-label font-semibold text-coral-strong">곰신로그</span>
        {profile.myName ? (
          <span className="text-caption text-muted-foreground truncate">{profile.myName}</span>
        ) : null}
      </header>

      <div className="px-4">
        <CoupleStatusBanner />
      </div>

      {/*
        The catch-up line, above the exchange rather than inside it.

        It is a reading OF the conversation, so putting it in the stream as another
        bubble would make it look like something one of them said.
      */}
      {summary.items.length > 0 && (
        <section
          data-testid="conversation-summary"
          aria-label={`${partnerName}의 오늘 요약`}
          className="mx-4 mt-3 rounded-surface border border-border bg-card p-3.5 space-y-2"
        >
          <h2 className="text-label font-bold text-foreground">{partnerName}의 오늘</h2>
          <ul className="space-y-1.5">
            {summary.items.map((item) => {
              // Per LINE, not per summary: `summaryTargetRecordId` answers "where
              // does this whole summary point", which is the right question for a
              // widget with one headline and the wrong one for a list where every
              // line is its own claim about its own record. §6.2 requires each line
              // to carry its exact source.
              const targetId = item.recordIds[0];
              const target = targetId ? visible.find((r) => r.id === targetId) : undefined;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!target}
                    onClick={() => target && openRecord(target)}
                    className="press-response-row w-full min-h-11 text-left flex items-center gap-2 rounded-control px-2 -mx-2 disabled:opacity-60"
                  >
                    <span className="flex-1 text-body text-foreground break-keep">{item.text}</span>
                    {target && (
                      <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-caption text-muted-foreground leading-tight">
            기록에서 그대로 정리한 거예요. 눌러서 원본을 볼 수 있어요.
          </p>
        </section>
      )}

      <div className="px-4 pt-4 space-y-4">
        {days.length === 0 ? (
          /*
            An empty screen is an invitation to act, not a mood. It names the one
            thing to do next rather than describing the absence.
          */
          <div className="py-12 text-center space-y-1">
            <p className="text-label font-bold text-foreground">아직 주고받은 기록이 없어요.</p>
            <p className="text-caption text-muted-foreground">
              아래 + 를 눌러 오늘 있었던 일을 남겨보세요.
            </p>
          </div>
        ) : (
          days.map((day) => (
            <section key={day.date} aria-label={day.label} className="space-y-2">
              <div className="flex justify-center">
                <span className="text-caption text-muted-foreground bg-muted/60 rounded-full px-3 py-1">
                  {day.label}
                </span>
              </div>

              {day.records.map((record) => {
                const mine = isOwnRecord(record, viewer);
                const confirmed = (record.emotionFlow ?? []).filter(
                  (item) => item.source === 'user_confirmed',
                );
                return (
                  /*
                    An <article>, not a <button>.

                    Wrapping the whole bubble would have put the media gallery
                    inside a button ancestor, which breaks its player and its zoom
                    control -- `RecordMediaGallery.test.tsx` asserts exactly that
                    ("keeps every photo of a carousel out of any button ancestor").
                    So the text is one tap target, the gallery owns its own, and
                    the footer carries a chevron that is always present -- which is
                    also what keeps a media-only record openable.
                  */
                  <article
                    key={record.id}
                    data-testid="conversation-bubble"
                    data-mine={mine ? 'true' : 'false'}
                    className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[82%] rounded-surface px-3 py-2.5 space-y-1.5 border ${
                        mine ? 'bg-coral/10 border-coral/25' : 'bg-card border-border'
                      }`}
                    >
                      {record.log ? (
                        <button
                          type="button"
                          onClick={() => openRecord(record)}
                          className="press-response-row w-full text-left text-body text-foreground break-keep whitespace-pre-wrap"
                        >
                          {record.log}
                        </button>
                      ) : null}

                      {/* The same gallery the record screen uses, so media never
                          becomes a second, differently-shaped thing here. */}
                      {record.attachments && record.attachments.length > 0 && (
                        <RecordMediaGallery
                          attachments={record.attachments}
                          recordId={record.id}
                          coupleId={profile.couple.coupleId}
                        />
                      )}

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {confirmed.map((item, index) => (
                          <span key={item.id ?? index} className="flex items-center gap-0.5">
                            <EmotionCharacter emotion={basicEmotionOf(item)} selected size={18} />
                            <span className="text-caption text-muted-foreground">
                              {item.displayLabel}
                            </span>
                          </span>
                        ))}
                        {record.isPrivate && (
                          <span className="flex items-center gap-0.5 text-caption text-muted-foreground">
                            <Lock size={11} aria-hidden="true" /> 나만 보기
                          </span>
                        )}
                        <span className="text-caption text-muted-foreground tabular-nums ml-auto">
                          {record.time}
                        </span>
                        <button
                          type="button"
                          onClick={() => openRecord(record)}
                          aria-label={`${day.label} ${record.time} 기록 원본 열기`}
                          className="press-response min-h-11 min-w-11 -my-2 flex items-center justify-center text-muted-foreground"
                        >
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
