import type { ReactionType } from '@/types';

/**
 * An unsaved composer draft, held IN MEMORY ONLY.
 *
 * The problem: the composer's text lived in component state, so switching tabs --
 * to check a date on 기록, or a plan on 일정 -- unmounted it and silently threw the
 * writing away. Adding a fifth tab made that more likely, not less, because tabs
 * invite exactly that kind of glance.
 *
 * Why memory and not storage: the diary body must never be written at rest. For an
 * authenticated user `saveState` persists a strict device-preference whitelist
 * (`widgetLayout`, `soldierWidgetLayout`, `hasSeenInstallPrompt`, `theme`) and a
 * test asserts that list exactly, because anything else would survive a purge and
 * outlive account deletion. A draft is the most sensitive text in the app, so it
 * gets the weaker guarantee on purpose: it survives navigation, and it does NOT
 * survive a reload or a process death.
 *
 * Keyed by user id so an account switch can never surface one person's unsent
 * words in the other's composer. `clearAll()` is wired into the store's purge.
 */
export interface ComposerDraft {
  log: string;
  isPrivate: boolean;
  reaction?: ReactionType;
}

const drafts = new Map<string, ComposerDraft>();

/** A draft is only worth keeping if it holds something a save could persist. */
function isMeaningful(draft: ComposerDraft): boolean {
  return draft.log.trim().length > 0 || !!draft.reaction;
}

export function readComposerDraft(userId: string | undefined): ComposerDraft | null {
  if (!userId) return null;
  return drafts.get(userId) ?? null;
}

export function writeComposerDraft(userId: string | undefined, draft: ComposerDraft): void {
  if (!userId) return;
  if (isMeaningful(draft)) drafts.set(userId, draft);
  else drafts.delete(userId);
}

export function clearComposerDraft(userId: string | undefined): void {
  if (!userId) return;
  drafts.delete(userId);
}

/**
 * Drop every draft. Called from the store whenever local account data is purged
 * (sign-out, account switch, deletion abort), so unsent text cannot outlive the
 * session that produced it.
 */
export function clearAllComposerDrafts(): void {
  drafts.clear();
}

/** Test-only visibility into the stash size. */
export function __composerDraftCountForTest(): number {
  return drafts.size;
}
