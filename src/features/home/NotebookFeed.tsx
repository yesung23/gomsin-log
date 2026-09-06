import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, PanelsTopLeft, Rows3 } from 'lucide-react';
import type { DailyRecord } from '@/types';
import type { HomeReadingMode } from '@/features/home/useHomeReadingMode';

const SWIPE_THRESHOLD_PX = 52;
const EDGE_GUARD_PX = 24;
const SWIPE_EXCLUSION_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'video',
  'audio',
  '[contenteditable="true"]',
  '[data-record-media-region]',
].join(',');

type Selection = {
  identityKey: string;
  recordId: string | null;
};

type SwipeStart = {
  pointerId: number;
  x: number;
  y: number;
};

function hasTextSelection() {
  try {
    return window.getSelection()?.isCollapsed === false;
  } catch {
    return false;
  }
}

function isExcludedTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(SWIPE_EXCLUSION_SELECTOR));
}

export function NotebookReadingModeToggle({
  mode,
  onModeChange,
}: {
  mode: HomeReadingMode;
  onModeChange: (mode: HomeReadingMode) => void;
}) {
  return (
    <button
      type="button"
      aria-label={mode === 'horizontal' ? '세로로 읽기' : '가로로 읽기'}
      data-reading-mode={mode}
      onClick={() => onModeChange(mode === 'horizontal' ? 'vertical' : 'horizontal')}
      className="press-response notebook-feed__mode-toggle"
    >
      {mode === 'horizontal'
        ? <Rows3 size={20} aria-hidden="true" />
        : <PanelsTopLeft size={20} aria-hidden="true" />}
    </button>
  );
}

export function NotebookFeed({
  records,
  identityKey,
  mode,
  onModeChange,
  renderRecord,
  showModeToggle = true,
}: {
  records: DailyRecord[];
  /** In-memory only. It resets selection when the signed-in/current-partner identity changes. */
  identityKey: string;
  mode: HomeReadingMode;
  onModeChange: (mode: HomeReadingMode) => void;
  renderRecord: (record: DailyRecord, index: number) => ReactNode;
  showModeToggle?: boolean;
}) {
  const [selection, setSelection] = useState<Selection>(() => ({
    identityKey,
    recordId: records[0]?.id ?? null,
  }));
  const swipeStartRef = useRef<SwipeStart | null>(null);
  const activePointersRef = useRef(new Set<number>());
  const verticalReaderRef = useRef<HTMLDivElement>(null);

  const activeRecordId = selection.identityKey === identityKey
    && selection.recordId
    && records.some((record) => record.id === selection.recordId)
    ? selection.recordId
    : records[0]?.id ?? null;
  const activeIndex = Math.max(0, records.findIndex((record) => record.id === activeRecordId));
  const activeRecord = records[activeIndex];

  useEffect(() => {
    setSelection((current) => {
      const recordStillExists = current.identityKey === identityKey
        && current.recordId
        && records.some((record) => record.id === current.recordId);
      if (recordStillExists) return current;
      return { identityKey, recordId: records[0]?.id ?? null };
    });
  }, [identityKey, records]);

  useEffect(() => {
    const clearReleasedPointer = (event: globalThis.PointerEvent) => {
      activePointersRef.current.delete(event.pointerId);
      if (swipeStartRef.current?.pointerId === event.pointerId) swipeStartRef.current = null;
    };
    const clearAllPointers = () => {
      activePointersRef.current.clear();
      swipeStartRef.current = null;
    };
    window.addEventListener('pointerup', clearReleasedPointer);
    window.addEventListener('pointercancel', clearReleasedPointer);
    window.addEventListener('blur', clearAllPointers);
    return () => {
      window.removeEventListener('pointerup', clearReleasedPointer);
      window.removeEventListener('pointercancel', clearReleasedPointer);
      window.removeEventListener('blur', clearAllPointers);
    };
  }, []);

  useEffect(() => {
    const reader = verticalReaderRef.current;
    if (mode !== 'vertical' || !reader) return;

    const scrollRoot = reader.closest('main');
    const updateVisibleRecord = () => {
      const rootBounds = scrollRoot?.getBoundingClientRect() ?? {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
      };
      let mostVisibleId: string | null = null;
      let mostVisiblePixels = 0;
      reader.querySelectorAll<HTMLElement>('[data-notebook-record-id]').forEach((element) => {
        const bounds = element.getBoundingClientRect();
        const visibleWidth = Math.max(
          0,
          Math.min(bounds.right, rootBounds.right) - Math.max(bounds.left, rootBounds.left),
        );
        const visibleHeight = Math.max(
          0,
          Math.min(bounds.bottom, rootBounds.bottom) - Math.max(bounds.top, rootBounds.top),
        );
        const visiblePixels = visibleWidth * visibleHeight;
        if (visiblePixels > mostVisiblePixels) {
          mostVisibleId = element.dataset.notebookRecordId ?? null;
          mostVisiblePixels = visiblePixels;
        }
      });
      if (!mostVisibleId) return;
      setSelection((current) => (
        current.identityKey === identityKey && current.recordId === mostVisibleId
          ? current
          : { identityKey, recordId: mostVisibleId }
      ));
    };
    const scrollTarget = scrollRoot ?? window;
    updateVisibleRecord();
    scrollTarget.addEventListener('scroll', updateVisibleRecord, { passive: true });
    window.addEventListener('resize', updateVisibleRecord);
    return () => {
      scrollTarget.removeEventListener('scroll', updateVisibleRecord);
      window.removeEventListener('resize', updateVisibleRecord);
    };
  }, [identityKey, mode, records]);

  const goToIndex = (nextIndex: number) => {
    const nextRecord = records[nextIndex];
    if (!nextRecord) return;
    setSelection({ identityKey, recordId: nextRecord.id });
  };

  const previous = () => goToIndex(activeIndex - 1);
  const next = () => goToIndex(activeIndex + 1);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isExcludedTarget(event.target)) return;
    if (event.key === 'ArrowLeft' && activeIndex > 0) {
      event.preventDefault();
      previous();
    } else if (event.key === 'ArrowRight' && activeIndex < records.length - 1) {
      event.preventDefault();
      next();
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    activePointersRef.current.add(event.pointerId);
    if (
      event.isPrimary === false
      || activePointersRef.current.size > 1
      || isExcludedTarget(event.target)
      || hasTextSelection()
    ) {
      swipeStartRef.current = null;
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    if (localX <= EDGE_GUARD_PX || localX >= bounds.width - EDGE_GUARD_PX) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const clearPointer = (pointerId: number) => {
    activePointersRef.current.delete(pointerId);
    if (swipeStartRef.current?.pointerId === pointerId) swipeStartRef.current = null;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    const hadMultiplePointers = activePointersRef.current.size > 1;
    activePointersRef.current.delete(event.pointerId);
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId || hadMultiplePointers || hasTextSelection()) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
    if (deltaX > 0) previous();
    else next();
  };

  const renderedVerticalRecords = useMemo(
    () => records.map((record, index) => (
      <div
        key={record.id}
        data-testid={`notebook-record-${record.id}`}
        data-notebook-record-id={record.id}
        data-active-record={record.id === activeRecordId || undefined}
        className="notebook-feed__vertical-record"
      >
        {renderRecord(record, index)}
      </div>
    )),
    [activeRecordId, records, renderRecord],
  );

  return (
    <div className="notebook-feed" data-reading-mode={mode}>
      {showModeToggle ? (
        <div className="notebook-feed__toolbar">
          <NotebookReadingModeToggle mode={mode} onModeChange={onModeChange} />
        </div>
      ) : null}

      {mode === 'vertical' ? (
        <div
          ref={verticalReaderRef}
          data-testid="notebook-vertical-reader"
          className="notebook-feed__vertical"
        >
          {renderedVerticalRecords}
        </div>
      ) : activeRecord ? (
        <div
          role="group"
          aria-label="가로 기록 읽기"
          data-testid="notebook-horizontal-reader"
          className="notebook-feed__horizontal"
        >
          <div
            tabIndex={0}
            data-testid="record-swipe-region"
            className="notebook-feed__swipe-region"
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={(event) => clearPointer(event.pointerId)}
          >
            <div
              key={activeRecord.id}
              data-testid={`notebook-record-${activeRecord.id}`}
              data-active-record="true"
              className="notebook-feed__page"
            >
              {renderRecord(activeRecord, activeIndex)}
            </div>
          </div>

          <div className="notebook-feed__pagination" aria-label="기록 페이지 이동">
            <button
              type="button"
              aria-label="이전 기록"
              disabled={activeIndex === 0}
              onClick={previous}
              className="press-response notebook-feed__page-button"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <span className="notebook-feed__page-count" aria-live="polite" aria-atomic="true">
              {activeIndex + 1} / {records.length}
            </span>
            <button
              type="button"
              aria-label="다음 기록"
              disabled={activeIndex === records.length - 1}
              onClick={next}
              className="press-response notebook-feed__page-button"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
