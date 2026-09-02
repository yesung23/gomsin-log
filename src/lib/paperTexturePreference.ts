export type PaperTexture = 'ruled' | 'plain' | 'grid' | 'dot' | 'cream';

export interface PaperTextureOption {
  id: PaperTexture;
  label: string;
  description: string;
}

/** Shared display copy for every app-wide paper texture. */
export const PAPER_TEXTURE_OPTIONS: readonly PaperTextureOption[] = [
  { id: 'plain', label: '따뜻한 무지', description: '기록과 사진에 집중하는 기본 종이' },
  { id: 'ruled', label: '줄 노트', description: '손글씨 일기처럼 차분한 가로줄' },
  { id: 'grid', label: '모눈 종이', description: '사진과 글을 정돈해 보이는 작은 격자' },
  { id: 'dot', label: '도트 종이', description: '꾸미기 여백을 남기는 옅은 점선' },
  { id: 'cream', label: '크림 편지지', description: '조금 더 따뜻한 편지 느낌의 종이' },
] as const;

const PAPER_TEXTURES: readonly PaperTexture[] = PAPER_TEXTURE_OPTIONS.map(({ id }) => id);

const KEY_PREFIX = 'gomsin.display.paper.';

export const PAPER_TEXTURE_DEFAULT: PaperTexture = 'ruled';

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadPaperTexture(userId: string): PaperTexture {
  if (!userId || typeof localStorage === 'undefined') return PAPER_TEXTURE_DEFAULT;
  try {
    const value = localStorage.getItem(key(userId));
    return typeof value === 'string' && PAPER_TEXTURES.includes(value as PaperTexture)
      ? value as PaperTexture
      : PAPER_TEXTURE_DEFAULT;
  } catch {
    return PAPER_TEXTURE_DEFAULT;
  }
}

export function savePaperTexture(userId: string, texture: PaperTexture): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(userId), texture);
  } catch {
    /* The current session still applies the choice if persistence is unavailable. */
  }
}

/** Keep the per-device selection inside the account's currently owned collection. */
export function reconcileOwnedPaperTexture(
  userId: string,
  ownedPapers: readonly PaperTexture[],
): PaperTexture {
  const selected = loadPaperTexture(userId);
  if (ownedPapers.includes(selected)) return selected;

  const fallback = ownedPapers.includes(PAPER_TEXTURE_DEFAULT)
    ? PAPER_TEXTURE_DEFAULT
    : PAPER_TEXTURES.find((texture) => ownedPapers.includes(texture)) ?? PAPER_TEXTURE_DEFAULT;
  savePaperTexture(userId, fallback);
  return fallback;
}

export function applyPaperTextureAttribute(texture: PaperTexture): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-paper', texture);
}
