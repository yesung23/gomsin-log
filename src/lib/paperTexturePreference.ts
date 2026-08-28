export type PaperTexture = 'ruled' | 'plain';

const KEY_PREFIX = 'gomsin.display.paper.';

export const PAPER_TEXTURE_DEFAULT: PaperTexture = 'ruled';

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadPaperTexture(userId: string): PaperTexture {
  if (!userId || typeof localStorage === 'undefined') return PAPER_TEXTURE_DEFAULT;
  try {
    return localStorage.getItem(key(userId)) === 'plain' ? 'plain' : PAPER_TEXTURE_DEFAULT;
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
  if (texture === 'plain') root.setAttribute('data-paper', 'plain');
  else root.removeAttribute('data-paper');
}
