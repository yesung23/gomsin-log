/**
 * 스티커 — 붙일 것과, 어디에 붙였는가.
 *
 * ## 스티커는 에셋이지 업로드가 아니다
 *
 * 앱이 들고 있는 그림이므로 저장 비용도 CSP의 `img-src`도 건드리지 않는다. 전부 인라인
 * SVG로 그려서 네트워크 요청조차 없다 -- 이미지 파일로 두면 12개의 요청이 지면마다
 * 생기고, 오프라인에서 지면이 반쯤 빈 채로 그려진다.
 *
 * 남는 것은 **어디에 붙였는가**이고 그것은 사용자 콘텐츠다.
 *
 * ## 왜 지금은 이 기기에만 남는가
 *
 * 붙인 자리는 CSK 도메인의 커플 콘텐츠이므로 제대로 하려면 테이블과 RLS가 필요하고,
 * 그것은 migration gate가 판정한다. 그때까지 이 기기에만 남긴다 -- `avatarImage.ts`가
 * 같은 이유로 같은 모양을 쓴다.
 *
 * 이 선택은 **정직하게 화면에 적힌다.** 상대에게도 보이는 줄 알고 꾸몄는데 안 보이는
 * 것은 이 제품이 만들면 안 되는 종류의 놀람이다.
 *
 * ## 기본 세트는 무료다
 *
 * 유료 스티커는 `BUSINESS_MEMORY_ROADMAP_V1` §9.5가 Memory Product의 지불가치 확인
 * 뒤로 미뤄 둔 쪽이다. 순서가 제품으로도 옳다 -- 무료로 꾸며야 애착이 생기고, 애착이
 * 생긴 것을 책으로 만들고 싶어진다. 스티커부터 팔면 그 루프가 돌기 전에 결제가 먼저 온다.
 */

export interface Sticker {
  id: string;
  /** 스티커를 고르는 목록에서 읽히는 이름. 스크린리더가 읽는 것도 이것이다. */
  label: string;
}

/**
 * 기본 세트.
 *
 * 열두 개다. 더 늘리면 고르는 데 시간이 들고, 다꾸는 고르는 재미가 아니라 붙이는
 * 재미다. 이 목록에 유료 표시가 없는 것은 실수가 아니라 §9.5의 순서다.
 */
export const STICKERS: readonly Sticker[] = [
  { id: 'heart', label: '하트' },
  { id: 'star', label: '별' },
  { id: 'flower', label: '꽃' },
  { id: 'cloud', label: '구름' },
  { id: 'moon', label: '달' },
  { id: 'sun', label: '해' },
  { id: 'leaf', label: '잎' },
  { id: 'ribbon', label: '리본' },
  { id: 'tape', label: '테이프' },
  { id: 'clip', label: '클립' },
  { id: 'stamp', label: '도장' },
  { id: 'note', label: '쪽지' },
] as const;

export interface Placement {
  /** 이 붙임 하나의 id. 지울 때 쓴다. */
  id: string;
  stickerId: string;
  /**
   * 지면 안의 상대 좌표, 0..1.
   *
   * 픽셀로 저장하면 폰을 바꾸거나 화면을 돌릴 때 스티커가 지면 밖으로 나간다. 비율로
   * 두면 어느 폭에서도 같은 자리에 있다.
   */
  x: number;
  y: number;
  /** 도 단위. 반듯하게 붙은 스티커는 인쇄물처럼 보이므로 조금씩 기울인다. */
  rotation: number;
}

const KEY_PREFIX = 'gomsin.diary.stickers.';

/** 한 지면에 붙일 수 있는 수의 상한. 넘으면 지면이 아니라 스티커 더미가 된다. */
export const PLACEMENT_LIMIT = 40;

function key(userId: string, monthKey: string): string {
  return `${KEY_PREFIX}${userId}.${monthKey}`;
}

/** 0..1 밖으로 나간 좌표를 되돌린다. 지면 밖의 스티커는 영영 지울 수 없다. */
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function isPlacement(value: unknown): value is Placement {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.stickerId === 'string'
    && typeof candidate.x === 'number'
    && typeof candidate.y === 'number'
    && typeof candidate.rotation === 'number';
}

/**
 * 그 지면에 붙어 있는 것.
 *
 * 손상된 값에서 아무것도 못 읽더라도 빈 배열을 준다. 여기서 던지면 지면 전체가 안
 * 그려지고, 사용자는 스티커가 아니라 **그 달의 일기를 통째로** 잃은 것으로 본다.
 */
export function loadPlacements(userId: string, monthKey: string): Placement[] {
  if (!userId || !monthKey || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key(userId, monthKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isPlacement)
      // 목록에서 사라진 스티커가 저장돼 있으면 그릴 그림이 없다. 조용히 버린다.
      .filter((placement) => STICKERS.some((sticker) => sticker.id === placement.stickerId))
      .map((placement) => ({ ...placement, x: clamp(placement.x), y: clamp(placement.y) }))
      .slice(0, PLACEMENT_LIMIT);
  } catch {
    return [];
  }
}

/** 저장은 실패해도 조용하다. 스티커 하나 때문에 일기를 쓰던 화면이 죽지 않는다. */
export function savePlacements(userId: string, monthKey: string, placements: Placement[]): void {
  if (!userId || !monthKey || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      key(userId, monthKey),
      JSON.stringify(placements.slice(0, PLACEMENT_LIMIT)),
    );
  } catch {
    /* 저장 공간이 없거나 막혀 있다. 화면의 스티커는 그대로 있다. */
  }
}

/**
 * 붙인다. 상한에 닿았으면 그대로 돌려준다.
 *
 * 상한을 조용히 넘기고 저장할 때만 자르면 화면에는 붙었는데 다시 열면 없어진다. 붙지
 * 않는 것이 붙었다 사라지는 것보다 낫다.
 */
export function place(
  placements: Placement[],
  stickerId: string,
  x: number,
  y: number,
  rotation: number,
  id: string,
): Placement[] {
  if (placements.length >= PLACEMENT_LIMIT) return placements;
  if (!STICKERS.some((sticker) => sticker.id === stickerId)) return placements;
  return [...placements, { id, stickerId, x: clamp(x), y: clamp(y), rotation }];
}

export function remove(placements: Placement[], id: string): Placement[] {
  return placements.filter((placement) => placement.id !== id);
}
