import { Images, Lock } from 'lucide-react';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import { buildPostTiles, type PostTile } from '@/features/us/postTiles';
import type { DailyRecord } from '@/types';

/**
 * 프로필의 여행 게시물 격자 — 인스타와 같은 3열, 같은 정사각형.
 *
 * 앞의 판은 한 달의 모든 날을 7열로 그렸다. "달력이 아니라 질감" 이라고 적혀 있었지만
 * 날짜가 적혀 있고 빈 칸이 있으면 **쓰는 사람에게는 달력으로 읽힌다.**
 *
 * 여기서 칸은 하루가 아니라 **여행 기간 안의 기록 하나**다. 일반 기록은 사진 탭의
 * 기존 기록 목록이 맡으므로, 모든 기록을 게시물처럼 노출하지 않는다.
 *
 * 달력은 `일정` 이 갖는다. 그쪽은 **앞으로 올 날**을 다루므로 날짜 칸이 맞고, 여기는
 * 이미 지난 것이라 순서만 있으면 된다.
 */
interface PostGridProps {
  records: DailyRecord[];
  coupleId?: string;
  onOpen: (recordId: string) => void;
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
  const { url, reportLoadFailure } = useMediaAttachment(tile.photo!, coupleId, tile.recordId);
  return (
    <button
      type="button"
      onClick={() => onOpen(tile.recordId)}
      data-testid={`post-tile-${tile.recordId}`}
      data-kind="photo"
      aria-label={`${tile.date} 기록 열기`}
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

/**
 * 글만 있는 칸.
 *
 * 인스타에는 없는 종류지만 이 앱에는 이것이 대부분이다. 사진 있는 것만 칸으로 만들면
 * 격자가 이 커플이 남긴 것의 일부만 말하게 되고, 사진을 안 올리는 커플의 프로필은
 * 영영 비어 있다.
 */
function TextTile({ tile, onOpen }: { tile: PostTile; onOpen: (recordId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(tile.recordId)}
      data-testid={`post-tile-${tile.recordId}`}
      data-kind="text"
      aria-label={`${tile.date} 기록 열기`}
      className="press-response relative flex aspect-square w-full items-center justify-center overflow-hidden px-2"
      style={{ background: 'var(--paper)', border: 'var(--stroke-thin) solid var(--ink-faint)' }}
    >
      {tile.unavailable ? (
        /*
          못 여는 기록. **없는 것이 아니라 못 여는 것**이므로 칸은 남는다 -- 빼 버리면
          기기를 바꿀 때마다 게시물 수가 줄어든 것처럼 보인다.
        */
        <Lock size={16} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
      ) : (
        <span
          className="hand-text line-clamp-4 text-center text-caption leading-snug"
          style={{ color: 'var(--ink)' }}
        >
          {tile.text}
        </span>
      )}
    </button>
  );
}

export function PostGrid({ records, coupleId, onOpen }: PostGridProps) {
  const tiles = buildPostTiles(records);

  if (tiles.length === 0) {
    return (
      <p className="px-8 pt-12 text-center text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
        아직 여행 기록이 없어요.
        <br />
        여행을 떠나고 남긴 추억이 여기 모여요.
      </p>
    );
  }

  return (
    <div
      data-testid="post-grid"
      className="grid grid-cols-3 gap-0.5 px-0.5"
      role="group"
      aria-label="게시물"
    >
      {tiles.map((tile) => (tile.photo ? (
        <PhotoTile key={tile.recordId} tile={tile} coupleId={coupleId} onOpen={onOpen} />
      ) : (
        <TextTile key={tile.recordId} tile={tile} onOpen={onOpen} />
      )))}
    </div>
  );
}
