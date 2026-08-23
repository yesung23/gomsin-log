import type { Highlight, HighlightSourceKind } from '@/lib/coupleHighlights';

export type HighlightEditRoute = '/settings' | '/schedule' | '/service';

const EDIT_ROUTE_BY_SOURCE: Record<HighlightSourceKind, HighlightEditRoute> = {
  anniversary: '/settings',
  event: '/schedule',
  discharge: '/service',
};

const SOURCE_LABEL_BY_KIND: Record<HighlightSourceKind, string> = {
  anniversary: '기념일',
  event: '일정',
  discharge: '복무 정보',
};

function getHighlightEditRoute(sourceKind: HighlightSourceKind): HighlightEditRoute {
  return EDIT_ROUTE_BY_SOURCE[sourceKind];
}

/**
 * 원본 편집의 진입점만 제공한다. 실제 라우트가 query로 편집 화면을 자동으로 열지는
 * 않으므로, 부모가 onEdit에서 기존 화면으로 이동하고 필요한 편집 상태를 결정한다.
 */
export function HighlightEditActions({
  highlight,
  onEdit,
}: {
  highlight: Highlight;
  onEdit?: (highlight: Highlight) => void;
}) {
  if (!onEdit) return null;

  const sourceLabel = SOURCE_LABEL_BY_KIND[highlight.sourceKind];
  const route = getHighlightEditRoute(highlight.sourceKind);

  return (
    <button
      type="button"
      disabled={!highlight.reached}
      onClick={() => onEdit(highlight)}
      data-testid="highlight-edit-action"
      data-edit-route={route}
      aria-label={`${highlight.label} ${sourceLabel} 원본 편집`}
      className="press-response min-h-11 rounded-control border border-border px-3 py-2 text-label text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {sourceLabel} 원본 편집
    </button>
  );
}
