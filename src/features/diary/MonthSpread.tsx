import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Lock,
  Pencil,
  Sticker as StickerIcon,
  X,
} from 'lucide-react';
import type { DailyRecord } from '@/types';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import {
  DIARY_PAPERS,
  diaryPaperStyle,
  loadDefaultDiaryPaper,
} from './papers';
import {
  loadDiaryPagePlan,
  moveDiaryRecord,
  resolveDiaryPageRecords,
  saveDiaryPagePlan,
  setRecordIncluded,
  type DiaryPageLayout,
  type DiaryPagePlan,
} from './diaryPagePlan';
import {
  STICKERS,
  loadPlacements,
  savePlacements,
  place,
  remove,
  PLACEMENT_LIMIT,
  type Placement,
} from './stickers';
import { StickerArt } from './StickerArt';
import type { DiaryMonth } from './diaryMonths';

const TILT = 14;
const NUDGE = 0.02;

const LAYOUTS: readonly { id: DiaryPageLayout; label: string; description: string }[] = [
  { id: 'journal', label: '기록 중심', description: '글과 사진을 시간순으로 차분히 읽어요.' },
  { id: 'photo-first', label: '사진 먼저', description: '사진을 먼저 보고 그날의 글을 이어 읽어요.' },
  { id: 'compact', label: '간결하게', description: '여백을 줄여 여러 순간을 빠르게 훑어요.' },
] as const;

function recordLabel(record: DailyRecord): string {
  const firstLine = (record.log ?? '').split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine || `${record.time || '시간 없는'} 기록`;
}

function dayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

function recordsByDay(records: readonly DailyRecord[]): Map<string, DailyRecord[]> {
  const grouped = new Map<string, DailyRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.date);
    if (list) list.push(record);
    else grouped.set(record.date, [record]);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      const byTime = (a.time || '').localeCompare(b.time || '');
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
  }
  return grouped;
}

export function MonthSpread({
  month,
  userId,
  coupleId,
  onClose,
}: {
  month: DiaryMonth;
  userId: string;
  coupleId?: string;
  onClose: () => void;
}) {
  const grouped = useMemo(() => recordsByDay(month.records), [month.records]);
  const dates = useMemo(() => [...grouped.keys()].sort(), [grouped]);
  const firstDate = dates[0] ?? '';
  const [activeDate, setActiveDate] = useState(firstDate);
  const [plan, setPlan] = useState<DiaryPagePlan>(() => (
    loadDiaryPagePlan(userId, firstDate, loadDefaultDiaryPaper(userId))
  ));
  const [editing, setEditing] = useState(false);
  const [legacyDecorating, setLegacyDecorating] = useState(false);

  const dayRecords = useMemo(() => grouped.get(activeDate) ?? [], [grouped, activeDate]);
  const pageRecords = useMemo(() => resolveDiaryPageRecords(dayRecords, plan), [dayRecords, plan]);

  useEffect(() => {
    if (dates.includes(activeDate)) return;
    const nextDate = dates[0] ?? '';
    setActiveDate(nextDate);
    setPlan(loadDiaryPagePlan(userId, nextDate, loadDefaultDiaryPaper(userId)));
  }, [dates, activeDate, userId]);

  const commitPlan = useCallback((next: DiaryPagePlan) => {
    setPlan(next);
    if (activeDate) saveDiaryPagePlan(userId, activeDate, next);
  }, [activeDate, userId]);

  const switchDate = (date: string) => {
    if (date === activeDate) return;
    // Load the next page BEFORE the batched render. A passive effect here causes
    // one paint where the new date uses the previous date's paper/layout.
    const nextPlan = loadDiaryPagePlan(userId, date, loadDefaultDiaryPaper(userId));
    setPlan(nextPlan);
    setActiveDate(date);
    // Keep edit mode open: moving through several days should not require the
    // user to re-enter page editing after every date tap.
  };

  const toggleRecord = (recordId: string, included: boolean) => {
    commitPlan(setRecordIncluded(plan, recordId, included));
  };

  const moveRecord = (recordId: string, delta: -1 | 1) => {
    commitPlan(moveDiaryRecord(plan, pageRecords, recordId, delta));
  };

  if (legacyDecorating) {
    return (
      <LegacyStickerBoard
        month={month}
        userId={userId}
        onDone={() => setLegacyDecorating(false)}
      />
    );
  }

  return (
    <div className="notebook flex min-h-screen min-h-[100dvh] flex-col pb-24">
      <header className="flex h-14 shrink-0 items-center gap-1 px-3">
        <button
          type="button"
          aria-label="일기장으로 돌아가기"
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center"
        >
          <X size={22} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1 truncate text-heading" style={{ color: 'var(--ink)' }}>
          {month.label}
        </span>
        <button
          type="button"
          aria-label={editing ? '편집 완료' : '페이지 편집'}
          aria-pressed={editing}
          onClick={() => setEditing((value) => !value)}
          className="ink-chip flex min-h-11 items-center gap-1.5 px-3"
          style={editing ? { background: 'var(--ink)', color: 'var(--paper)' } : { color: 'var(--ink)' }}
        >
          {editing ? <Check size={15} aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />}
          <span className="text-label">{editing ? '편집 완료' : '페이지 편집'}</span>
        </button>
      </header>

      {dates.length > 0 ? (
        <nav aria-label={`${month.label} 날짜 페이지`} className="flex gap-2 overflow-x-auto px-3 pb-3">
          {dates.map((date) => (
            <button
              key={date}
              type="button"
              aria-label={`${dayLabel(date)} 페이지`}
              aria-pressed={activeDate === date}
              onClick={() => switchDate(date)}
              className="ink-chip min-h-11 shrink-0 px-3 text-label"
              style={activeDate === date
                ? { background: 'var(--ink)', color: 'var(--paper)' }
                : { color: 'var(--ink)' }}
            >
              {Number(date.slice(-2))}일
            </button>
          ))}
        </nav>
      ) : null}

      {editing ? (
        <PageEditor
          records={dayRecords}
          visibleRecords={pageRecords}
          plan={plan}
          onPlan={commitPlan}
          onToggleRecord={toggleRecord}
          onMoveRecord={moveRecord}
        />
      ) : null}

      <article
        data-testid="diary-paper"
        data-paper={plan.paperId}
        data-layout={plan.layout}
        className="mx-3 min-h-[360px] rounded-surface border px-4 py-5"
        style={{ ...diaryPaperStyle(plan.paperId), borderColor: 'var(--ink-faint)' }}
      >
        <header className="mb-5">
          <p className="text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>
            {activeDate || month.key}
          </p>
          <h2 className="mt-1 text-heading" style={{ color: 'var(--ink)' }}>
            {activeDate ? dayLabel(activeDate) : month.label}
          </h2>
        </header>

        {pageRecords.length === 0 ? (
          <p className="py-12 text-center text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            이 페이지에 넣은 기록이 없어요.
            <br />페이지 편집에서 다시 넣을 수 있어요.
          </p>
        ) : (
          <ol
            data-testid="diary-page-records"
            className={plan.layout === 'compact' ? 'space-y-3' : 'space-y-6'}
          >
            {pageRecords.map((record) => (
              <DiaryRecord key={record.id} record={record} coupleId={coupleId} layout={plan.layout} />
            ))}
          </ol>
        )}
      </article>

      <p className="mx-4 mt-3 text-caption leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
        페이지 구성과 종이는 지금은 이 기기에만 남아요. 원래 기록과 사진은 기존 저장·공유 규칙을 그대로 따라요.
      </p>

      <div className="mx-3 mt-4 border-t pt-4" style={{ borderColor: 'var(--ink-faint)' }}>
        <button
          type="button"
          onClick={() => setLegacyDecorating(true)}
          className="ink-chip flex min-h-11 items-center gap-2 px-3 text-label"
          style={{ color: 'var(--ink)' }}
        >
          <StickerIcon size={15} aria-hidden="true" />
          기존 월 꾸미기
        </button>
        <p className="mt-2 text-caption leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          예전에 붙인 무료 스티커는 별도 월 꾸미기 화면에서 그대로 보존돼요.
        </p>
      </div>
    </div>
  );
}

function DiaryRecord({ record, coupleId, layout }: {
  record: DailyRecord;
  coupleId?: string;
  layout: DiaryPageLayout;
}) {
  const body = (record.log ?? '').trim();
  const hasMedia = (record.attachments?.length ?? 0) > 0;
  const media = hasMedia ? (
    <RecordMediaGallery
      attachments={record.attachments ?? []}
      recordId={record.id}
      coupleId={coupleId}
      fit={layout === 'photo-first' ? 'cover' : 'contain'}
    />
  ) : null;
  const text = record.contentUnavailable ? (
    <p className="flex items-center gap-1.5 text-caption" style={{ color: 'var(--ink-soft)' }}>
      <Lock size={12} className="pen-icon" aria-hidden="true" />
      {record.contentUnavailable === 'key_unavailable'
        ? '이 기기에서 아직 열 수 없어요'
        : '이 기기의 열쇠로는 읽을 수 없어요'}
    </p>
  ) : body ? (
    <p className="hand-text whitespace-pre-wrap break-keep text-body" style={{ color: 'var(--ink)' }}>
      {body}
    </p>
  ) : null;

  return (
    <li
      data-testid="diary-page-record"
      className={layout === 'compact' ? 'border-b pb-3 last:border-0' : ''}
      style={{ borderColor: 'var(--ink-faint)' }}
    >
      <Link
        to={`/record?record=${encodeURIComponent(record.id)}`}
        aria-label={`${dayLabel(record.date)}${record.time ? ` ${record.time.slice(0, 5)}` : ''} 기록 열기`}
        className="press-response inline-flex min-h-11 min-w-11 items-center gap-1 text-caption tabular-nums"
        style={{ color: 'var(--ink-soft)' }}
      >
        {record.time?.slice(0, 5) || dayLabel(record.date)}
        <ChevronRight size={12} aria-hidden="true" />
      </Link>
      <div className="space-y-3">
        {layout === 'photo-first' ? <>{media}{text}</> : <>{text}{media}</>}
      </div>
    </li>
  );
}

function PageEditor({
  records,
  visibleRecords,
  plan,
  onPlan,
  onToggleRecord,
  onMoveRecord,
}: {
  records: readonly DailyRecord[];
  visibleRecords: readonly DailyRecord[];
  plan: DiaryPagePlan;
  onPlan: (plan: DiaryPagePlan) => void;
  onToggleRecord: (recordId: string, included: boolean) => void;
  onMoveRecord: (recordId: string, delta: -1 | 1) => void;
}) {
  const visibleIds = new Set(visibleRecords.map((record) => record.id));

  return (
    <section className="mx-3 mb-4 space-y-5 rounded-surface border p-4" style={{ borderColor: 'var(--ink-faint)', background: 'var(--paper)' }}>
      <div>
        <h3 className="text-label font-semibold" style={{ color: 'var(--ink)' }}>오늘 넣을 기록</h3>
        <p className="mt-1 text-caption leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          원본은 그대로 두고 이 페이지에서 보일 것과 순서만 정해요.
        </p>
        <ul className="mt-3 space-y-2">
          {records.map((record) => {
            const label = recordLabel(record);
            const included = visibleIds.has(record.id);
            const visibleIndex = visibleRecords.findIndex((item) => item.id === record.id);
            return (
              <li key={record.id} className="flex min-h-11 items-center gap-2">
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={included}
                    aria-label={`${label} 포함`}
                    onChange={(event) => onToggleRecord(record.id, event.target.checked)}
                    className="h-5 w-5 shrink-0 accent-coral"
                  />
                  <span className="min-w-0 flex-1 truncate text-label" style={{ color: 'var(--ink)' }}>{label}</span>
                </label>
                {included ? (
                  <div className="flex shrink-0">
                    <button
                      type="button"
                      aria-label={`${label} 위로`}
                      disabled={visibleIndex <= 0}
                      onClick={() => onMoveRecord(record.id, -1)}
                      className="flex h-11 w-11 items-center justify-center disabled:opacity-30"
                    >
                      <ChevronUp size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${label} 아래로`}
                      disabled={visibleIndex < 0 || visibleIndex >= visibleRecords.length - 1}
                      onClick={() => onMoveRecord(record.id, 1)}
                      className="flex h-11 w-11 items-center justify-center disabled:opacity-30"
                    >
                      <ChevronDown size={18} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="text-label font-semibold" style={{ color: 'var(--ink)' }}>종이 바탕</h3>
        <div role="radiogroup" aria-label="종이 바탕" className="mt-2 grid grid-cols-2 gap-2">
          {DIARY_PAPERS.map((paper) => (
            <button
              key={paper.id}
              type="button"
              role="radio"
              aria-checked={plan.paperId === paper.id}
              aria-label={paper.label}
              onClick={() => onPlan({ ...plan, paperId: paper.id })}
              className="min-h-12 rounded-control border px-3 text-left text-label"
              style={{
                ...diaryPaperStyle(paper.id),
                color: 'var(--ink)',
                borderColor: plan.paperId === paper.id ? 'var(--ink)' : 'var(--ink-faint)',
              }}
            >
              {paper.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-label font-semibold" style={{ color: 'var(--ink)' }}>페이지 레이아웃</h3>
        <div role="radiogroup" aria-label="페이지 레이아웃" className="mt-2 grid gap-2">
          {LAYOUTS.map((layout) => (
            <button
              key={layout.id}
              type="button"
              role="radio"
              aria-checked={plan.layout === layout.id}
              aria-label={layout.label}
              onClick={() => onPlan({ ...plan, layout: layout.id })}
              className="min-h-12 rounded-control border px-3 py-2 text-left"
              style={{ borderColor: plan.layout === layout.id ? 'var(--ink)' : 'var(--ink-faint)' }}
            >
              <span className="block text-label font-semibold" style={{ color: 'var(--ink)' }}>{layout.label}</span>
              <span className="block text-caption" style={{ color: 'var(--ink-soft)' }}>{layout.description}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function LegacyStickerBoard({ month, userId, onDone }: {
  month: DiaryMonth;
  userId: string;
  onDone: () => void;
}) {
  const sheet = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [placements, setPlacements] = useState<Placement[]>(() => loadPlacements(userId, month.key));

  useEffect(() => {
    setPlacements(loadPlacements(userId, month.key));
  }, [userId, month.key]);

  const commit = useCallback((next: Placement[]) => {
    setPlacements(next);
    savePlacements(userId, month.key, next);
  }, [userId, month.key]);

  const put = useCallback((x: number, y: number) => {
    if (!picked) return;
    const rotation = ((placements.length * 37) % (TILT * 2)) - TILT;
    const id = `${month.key}-${placements.length}-${Math.round(x * 1000)}-${Math.round(y * 1000)}`;
    commit(place(placements, picked, x, y, rotation, id));
  }, [commit, month.key, picked, placements]);

  const onSheetClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!picked) return;
    const box = sheet.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    put((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  };

  const onSheetKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!picked || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    put(0.5, 0.5);
  };

  const onStickerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, target: Placement) => {
    const delta = {
      ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    commit(placements.map((placement) => (placement.id === target.id
      ? {
        ...placement,
        x: Math.min(1, Math.max(0, placement.x + delta[0])),
        y: Math.min(1, Math.max(0, placement.y + delta[1])),
      }
      : placement)));
  };

  const full = placements.length >= PLACEMENT_LIMIT;

  return (
    <div className="notebook flex min-h-screen min-h-[100dvh] flex-col pb-24">
      <header className="flex h-14 items-center gap-2 px-3">
        <button type="button" aria-label="날짜별 일기로 돌아가기" onClick={onDone} className="flex h-11 w-11 items-center justify-center">
          <X size={22} aria-hidden="true" />
        </button>
        <span className="flex-1 text-heading" style={{ color: 'var(--ink)' }}>{month.label} 월 꾸미기</span>
        <button type="button" onClick={onDone} className="ink-chip min-h-11 px-3 text-label" style={{ color: 'var(--ink)' }}>
          <Check size={15} className="mr-1 inline" aria-hidden="true" />완료
        </button>
      </header>

      <div ref={sheet} className="relative mx-3 flex-1 rounded-surface border p-3" style={{ borderColor: 'var(--ink-faint)' }}>
        {picked ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="지면 · 누르면 고른 스티커가 가운데에 붙어요"
            onClick={onSheetClick}
            onKeyDown={onSheetKeyDown}
            className="absolute inset-0 z-10"
            style={{ cursor: 'copy' }}
          />
        ) : null}
        <ol className="relative z-0 space-y-4 py-2">
          {month.records.map((record) => (
            <li key={record.id}>
              <div className="flex items-baseline gap-2">
                <span className="text-label font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{Number(record.date.slice(-2))}일</span>
                <span className="text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>{record.time}</span>
              </div>
              {record.contentUnavailable ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-caption" style={{ color: 'var(--ink-soft)' }}>
                  <Lock size={12} aria-hidden="true" />읽을 수 없는 기록
                </p>
              ) : (
                <p className="hand-text mt-0.5 whitespace-pre-wrap text-body" style={{ color: 'var(--ink)' }}>{record.log}</p>
              )}
            </li>
          ))}
        </ol>
        {placements.map((placement) => (
          <button
            key={placement.id}
            type="button"
            aria-label={`${STICKERS.find((item) => item.id === placement.stickerId)?.label ?? '스티커'} · 방향키로 옮기고 누르면 떼요`}
            onClick={(event) => { event.stopPropagation(); commit(remove(placements, placement.id)); }}
            onKeyDown={(event) => onStickerKeyDown(event, placement)}
            className="absolute z-20"
            style={{
              left: `${placement.x * 100}%`,
              top: `${placement.y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)`,
            }}
          >
            <StickerArt id={placement.stickerId} size={34} />
          </button>
        ))}
      </div>

      <div className="sticky bottom-0 space-y-2 px-3 pt-2" style={{ background: 'var(--paper)', borderTop: 'var(--stroke) solid var(--ink-faint)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}>
        <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="붙일 스티커">
          {STICKERS.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              role="radio"
              aria-checked={picked === sticker.id}
              aria-label={sticker.label}
              onClick={() => setPicked(picked === sticker.id ? null : sticker.id)}
              className="ink-chip flex h-12 w-12 shrink-0 items-center justify-center"
              style={picked === sticker.id ? { background: 'var(--ink)' } : undefined}
            >
              <StickerArt id={sticker.id} size={26} />
            </button>
          ))}
        </div>
        <p className="text-caption" style={{ color: 'var(--ink-soft)' }}>
          {full ? '이 지면은 더 붙일 자리가 없어요' : picked ? '지면을 누르면 붙어요 · 붙은 걸 누르면 떨어져요' : '스티커를 하나 고르세요'}
        </p>
      </div>
    </div>
  );
}
