import type { EmotionFlowItem, EmotionVisibility } from '@/types';
import {
  BASIC_EMOTION_LABEL,
  GROUP_BY_BASIC,
  basicEmotionOf,
  type BasicEmotion,
} from '@/lib/basicEmotions';
import { normalizeText } from '@/lib/emotionRuleEngine';

/**
 * Pull the feelings out of a diary entry as REMOVABLE candidates.
 *
 * The old flow was opt-in: chips appeared and nothing was recorded unless the user
 * tapped them, so the common case -- write, save, move on -- stored no feeling at
 * all and the partner saw nothing. The requested flow is the inverse: the app
 * commits to a reading, shows it, and the user deletes what is wrong. That is a
 * much lower-effort agreement, and it is the only version where "빼는" makes sense.
 *
 * Two things make that safe rather than presumptuous:
 *
 *  1. Every candidate carries the `evidence` phrase it came from, so the user can
 *     see WHY the app said 분노 and judge it in one glance instead of trusting a
 *     bare label.
 *  2. Every candidate is correctable to any of the six basic emotions, so a wrong
 *     reading is a two-tap fix rather than an argument with the app.
 *
 * `evidence` is display-only and is stripped before persistence, exactly like
 * `matchedText` always was -- the diary body never reaches the database through
 * this path.
 */

export interface EmotionCandidate {
  /** Stable within one analysis of one text, so React keys and removals hold. */
  id: string;
  basic: BasicEmotion;
  /** The short phrase this reading came from, e.g. `ㅈ같음`. Never persisted. */
  evidence: string;
  /** 1-based position in the text, which is what makes it a *flow*. */
  sequence: number;
  position: number;
}

type Lexeme = {
  pattern: RegExp;
  basic: BasicEmotion;
  /** The phrase shown to the user. Short and in the user's own register. */
  evidence: string;
};

/**
 * Ordered lexicon. The FIRST match in a segment wins, so more specific and more
 * strongly-worded entries are listed above weaker ones.
 *
 * Profanity is included on purpose. People write "ㅈ같았는데" and an app that only
 * understands "짜증났는데" fails the exact entries that carry the most feeling --
 * which is the reported "마음을 똑바로 못 캐치하는 문제". These are matched, given a
 * readable evidence phrase, and never stored as raw text.
 */
const LEXICON: readonly Lexeme[] = [
  // --- anger -------------------------------------------------------------
  { pattern: /ㅈ같|좆같|존같|개같|줫같|개짜증|씨발|시발|ㅅㅂ|빡쳐|빡침|빡쳤|열받|짜증/, basic: 'anger', evidence: 'ㅈ같음' },
  // `화가 나` needs the particle: a bare `화\s*나` also matches "영화 나왔어".
  { pattern: /화가\s*나|화났|화나서|화나요|분노|열뻗|따졌|싸웠|싸움|어이없/, basic: 'anger', evidence: '화남' },
  // `서운했` not `서운`: 서운 is a substring of 무서운, so the bare stem read
  // "무서운 영화" as the writer feeling hurt.
  { pattern: /답답|억울|불만족|언짢|서운했|서운해|서운하|삐졌|삐침/, basic: 'anger', evidence: '답답함' },

  // --- happiness ---------------------------------------------------------
  { pattern: /기분(?:이|은|도)?\s*나아졌|나아졌|풀렸|괜찮아졌|좋아졌/, basic: 'happiness', evidence: '기분이 나아짐' },
  { pattern: /행복|기뻤|기쁨|신났|신남|설렜|설렘|뿌듯|감사|고마웠|힐링|즐거웠|즐거움|웃었|웃겨|재밌|재미있|맛있/, basic: 'happiness', evidence: '행복함' },
  { pattern: /사랑|보고\s*싶|보고싶|그리웠|그립|생각났|생각나/, basic: 'happiness', evidence: '보고 싶음' },

  // --- sadness -----------------------------------------------------------
  { pattern: /우울|슬펐|슬퍼|슬픔|눈물|울었|서러|먹먹|뭉클|울적|허전|공허/, basic: 'sadness', evidence: '슬픔' },
  { pattern: /속상|아쉬웠|아쉬움|씁쓸|외로|혼자\s*같|지쳤|지침|힘들었|힘듦|피곤|버겁/, basic: 'sadness', evidence: '속상함' },
  { pattern: /미안|후회|자책|안쓰러|죄송/, basic: 'sadness', evidence: '미안함' },

  // --- fear --------------------------------------------------------------
  { pattern: /불안|초조|조마조마|떨렸|떨림|긴장/, basic: 'fear', evidence: '불안함' },
  { pattern: /걱정|겁났|겁나|두려|무서웠|무서워|무서운|무섭/, basic: 'fear', evidence: '걱정됨' },

  // --- disgust -----------------------------------------------------------
  // `물렸` is deliberately absent: "모기에 물렸어" is a mosquito bite, not disgust.
  { pattern: /역겨|구역질|더럽|비위|혐오|끔찍|질렸/, basic: 'disgust', evidence: '역겨움' },
  { pattern: /불쾌|꺼림칙|거북|부담|싫었|싫어|싫음|불편/, basic: 'disgust', evidence: '불쾌함' },
  { pattern: /창피|부끄러|민망|쪽팔/, basic: 'disgust', evidence: '부끄러움' },

  // --- surprise ----------------------------------------------------------
  // `갑자기` is deliberately absent: "갑자기 비가 왔어" reports timing, not feeling.
  { pattern: /놀랐|놀람|깜짝|대박|믿기지\s*않|어리둥절|의외|뜻밖/, basic: 'surprise', evidence: '놀람' },
];

/** Words that flip a reading, checked immediately before the matched keyword. */
const NEGATION = /(?:안|못|별로|전혀|그다지|하나도|아니)\s*$/;

/** "무서운 영화 봤다" is not fear about the user's life. */
const ENTERTAINMENT = /(?:영화|드라마|웹툰|게임|놀이기구|공포\s*영화|ㅋㅋ|ㅎㅎ)/;

/**
 * Split into clauses so a text can yield an ordered FLOW rather than one verdict.
 *
 * `-는데` / `-지만` are included because they are the commonest Korean pivots and
 * the reported example turns on one of them: "일하느라 ㅈ같았는데, 손님이 먹을
 * 것을 줘서 기분이 나아졌어" has to become 분노 -> 행복, not a single emotion.
 */
function segment(normalized: string): { text: string; position: number }[] {
  const splitter = /(?:[.!?,;\n]+|(?:는데|은데|지만|하지만|그런데|근데|그래도|그러다가|그러고\s*나서|끝나고|이후에|나중에|결국|덕분에|그래서|그러니까))/g;
  const out: { text: string; position: number }[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = splitter.exec(normalized)) !== null) {
    // Every alternative consumes at least one character, so `lastIndex` always
    // advances and this cannot spin.
    const text = normalized.slice(last, match.index + match[0].length).trim();
    if (text) out.push({ text, position: last });
    last = match.index + match[0].length;
  }
  const tail = normalized.slice(last).trim();
  if (tail) out.push({ text: tail, position: last });
  return out;
}

function isNegated(segmentText: string, matched: string): boolean {
  const at = segmentText.indexOf(matched);
  if (at <= 0) return false;
  return NEGATION.test(segmentText.slice(Math.max(0, at - 10), at));
}

/**
 * Deterministic, on-device, and a pure function of the text.
 *
 * No clock, no randomness, no network, and no external model -- the same entry
 * always yields the same candidates, which is what lets a correction stick and
 * what keeps the diary body on the device.
 */
export function extractEmotionCandidates(logText: string): EmotionCandidate[] {
  const normalized = normalizeText(logText || '');
  if (!normalized) return [];

  const found: Omit<EmotionCandidate, 'id' | 'sequence'>[] = [];

  for (const seg of segment(normalized)) {
    for (const lexeme of LEXICON) {
      const match = lexeme.pattern.exec(seg.text);
      if (!match) continue;
      if (isNegated(seg.text, match[0])) break;
      if (lexeme.basic === 'fear' && ENTERTAINMENT.test(seg.text)) break;
      found.push({ basic: lexeme.basic, evidence: lexeme.evidence, position: seg.position });
      break; // one reading per clause: a clause is one beat of the flow
    }
  }

  // Collapse only *adjacent* repeats. Non-adjacent repeats are kept, because
  // 분노 -> 행복 -> 분노 is a real and meaningful shape.
  const collapsed = found.filter(
    (item, index) => index === 0 || item.basic !== found[index - 1].basic,
  );

  // Four beats is the most a phone-width flow line can show without becoming
  // unreadable, and past that the user is editing rather than confirming.
  return collapsed.slice(0, 4).map((item, index) => ({
    ...item,
    id: `cand-${index + 1}-${item.basic}`,
    sequence: index + 1,
  }));
}

/**
 * Turn the candidates the user LEFT IN PLACE into what gets stored.
 *
 * `evidence` is dropped here, which is the single point where the display-only
 * phrase is prevented from reaching the database. `source: 'user_confirmed'` is
 * correct under opt-out too: these are the items a person was shown and chose not
 * to remove, and `emotionFlowForStorage` still refuses anything else.
 */
export function candidatesToFlowItems(
  candidates: EmotionCandidate[],
  options: { isPrivate: boolean; editedIds?: ReadonlySet<string> },
): EmotionFlowItem[] {
  const visibility: EmotionVisibility = options.isPrivate ? 'author_only' : 'shared';
  return candidates.map((candidate, index) => ({
    id: candidate.id,
    sequence: index + 1,
    basic: candidate.basic,
    group: GROUP_BY_BASIC[candidate.basic],
    displayLabel: BASIC_EMOTION_LABEL[candidate.basic],
    source: 'user_confirmed' as const,
    visibility,
    userEdited: options.editedIds?.has(candidate.id) ?? false,
  }));
}

/** Read a stored flow back into editable candidates, for correcting later. */
export function flowItemsToCandidates(items: EmotionFlowItem[]): EmotionCandidate[] {
  return [...items]
    .sort((a, b) => a.sequence - b.sequence)
    .map((item, index) => ({
      id: item.id || `stored-${index + 1}`,
      // `basicEmotionOf` rather than `item.basic`, so a record stored before this
      // feature existed opens with its legacy group mapped forward instead of
      // silently defaulting every old feeling to 놀람.
      basic: basicEmotionOf(item),
      // A stored item has no evidence by design; the phrase was never saved.
      evidence: '',
      sequence: index + 1,
      position: index,
    }));
}
