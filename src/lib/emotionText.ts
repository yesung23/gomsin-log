/**
 * Text normalisation for on-device emotion reading.
 *
 * Extracted from the retired `emotionRuleEngine.ts`. That module held TWO things:
 * this normaliser, which the live pipeline needs, and `recommendEmotionFlow`, a
 * second, competing emotion engine with a nineteen-value vocabulary that nothing
 * but its own test still called. Keeping the normaliser inside a file named after
 * the dead engine is what made the duplication survive review, so it lives here
 * instead.
 *
 * Masking happens BEFORE any matching, which is why it belongs in front of the
 * pipeline rather than inside it: a URL, an email address or a phone number in the
 * diary body must never end up inside an `evidence` phrase, and the only way to
 * guarantee that structurally is to remove it before a lexeme can ever match it.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    // NFC first: 한글 typed on macOS arrives decomposed (NFD), and a decomposed
    // `짜증` does not match a composed pattern.
    .normalize('NFC')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/01[016789]-?\d{3,4}-?\d{4}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
