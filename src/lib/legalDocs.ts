/**
 * Identity of the two legal documents, kept out of `LegalPage.tsx`.
 *
 * The document PROSE stays in `LegalPage.tsx` (one authoritative copy, rendered by both
 * the public `/legal/:doc` route and the in-app onboarding sheet). Only the key, the
 * titles and the route-parameter narrowing live here, because a page module that also
 * exports non-components loses React Fast Refresh.
 */
export type LegalDocKey = 'terms' | 'privacy';

export const LEGAL_DOC_TITLES: Readonly<Record<LegalDocKey, string>> = {
  terms: '서비스 이용약관',
  privacy: '개인정보 처리방침',
};

/** Narrows an untrusted route parameter; anything unrecognised reads as the terms. */
export function toLegalDocKey(doc: string | undefined): LegalDocKey {
  return doc === 'privacy' ? 'privacy' : 'terms';
}
