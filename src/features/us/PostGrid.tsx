import { ImageOff, Images, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import { buildPostTiles, type PostTile } from '@/features/us/postTiles';
import type { DailyRecord } from '@/types';

/**
 * 프로필의 공유 사진 게시물 격자 — 인스타와 같은 3열, 같은 정사각형.
 *
 * 앞의 판은 한 달의 모든 날을 7열로 그렸다. "달력이 아니라 질감" 이라고 적혀 있었지만
 * 날짜가 적혀 있고 빈 칸이 있으면 **쓰는 사람에게는 달력으로 읽힌다.**
 *
 * 여기서 칸은 하루가 아니라 **공유 사진 기록 하나**다. 글만 있는 일반 기록은 사진 탭의
 * 기존 기록 목록이 맡으므로, 모든 기록을 게시물처럼 노출하지 않는다.
 *
 * 달력은 `일정` 이 갖는다. 그쪽은 **앞으로 올 날**을 다루므로 날짜 칸이 맞고, 여기는
 * 이미 지난 것이라 순서만 있으면 된다.
 */
interface PostGridProps {
  records: DailyRecord[];
  coupleId?: string;
  onOpen: (recordId: string) => void;
  emptyMessage?: string;
  emptyActionLabel?: string;
  onEmptyAction?: (trigger: HTMLButtonElement) => void;
  ariaLabel?: string;
}

/** 사진이 있는 칸. 훅은 반복문 안에서 부를 수 없으므로 따로 뗀다. */
function PhotoTile({
  tile,
  coupleId,
  onOpen,
}: {
  tile: PostTile;
  coupleId?: string;
  onOpen: (recordId: string) => void;
}) {
  const { url, reportLoadFailure, unavailable } = useMediaAttachment(
    tile.photo,
    coupleId,
    tile.recordId,
    'thumbnail',
  );
  return (
    <button
      type="button"
      onClick={() => onOpen(tile.recordId)}
      data-testid={`post-tile-${tile.recordId}`}
      data-kind="photo"
      aria-label={`${tile.date} 사진 게시물 열기`}
      className="press-response relative aspect-square w-full overflow-hidden"
      style={{ background: 'var(--ink-faint)' }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={reportLoadFailure}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {!url ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          {unavailable || tile.unavailable ? <Lock size={22} color="var(--ink-soft)" /> : <ImageOff size={22} color="var(--ink-soft)" />}
        </span>
      ) : null}
      {/*
        겹친 장 표시. 인스타가 여러 장짜리 게시물에 다는 것과 같은 자리이고, 누르기
        전에 **더 있다는 사실**을 알려 주는 것이 전부다.
      */}
      {tile.multiple ? (
        <Images
          size={14}
          className="absolute right-1.5 top-1.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

export function PostGrid({
  records,
  coupleId,
  onOpen,
  emptyMessage = '아직 사진이 없어요.',
  emptyActionLabel,
  onEmptyAction,
  ariaLabel = '사진 게시물',
}: PostGridProps) {
  const tiles = buildPostTiles(records);

  if (tiles.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-8 pt-8 text-center">
        <p className="text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          {emptyMessage}
        </p>
        {emptyActionLabel && onEmptyAction ? (
          <Button
            variant="primary"
            size="sm"
            onClick={(event) => onEmptyAction(event.currentTarget)}
          >
            {emptyActionLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-testid="post-grid"
      className="grid grid-cols-3 gap-0.5 px-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      {tiles.map((tile) => (
        <PhotoTile key={tile.recordId} tile={tile} coupleId={coupleId} onOpen={onOpen} />
      ))}
    </div>
  );
}
