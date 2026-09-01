export type PaperTexture = 'ruled' | 'plain' | 'grid' | 'dot' | 'cream';

const PAPER_TEXTURES: readonly PaperTexture[] = ['ruled', 'plain', 'grid', 'dot', 'cream'];

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

export function applyPaperTextureAttribute(texture: PaperTexture): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-paper', texture);
}
